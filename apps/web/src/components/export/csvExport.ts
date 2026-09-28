/**
 * CSV export core (issue #17, overview §5.2-E): client-side `Blob` generation
 * of the complete capture — metadata header rows plus a
 * `sample,time_s,<channel names…>` table whose columns follow the actually
 * detected channel names. Generation is chunked and yields to the event loop
 * between chunks, so a 250,000-point export never freezes the main thread.
 */

import type { ParsedCapture, WaveformChannel } from "../../types/capture";
import { channelDisplayName } from "../../state/channelNamesStore";
import { formatCaptureTimestamp } from "../banner/metadataModel";
import {
  getDerivedChannelUnit,
  normalizeUnit,
  splitUnit,
} from "../../capture/channelUnits";

/** Rows materialized per synchronous chunk; bounded to keep the main thread responsive. */
export const CSV_ROWS_PER_CHUNK = 5000;

/**
 * Shortest string that round-trips to the exact f32 sample value.
 * Saturated (Overload-NaN) samples export as empty cells (issue #106);
 * the stored time axis never carries NaN, so the time column is unaffected.
 */
export function formatSampleValue(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(value);
}

export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export { csvFileName } from "./exportFileName";

/**
 * Columns aligned to the capture time axis: every physical channel plus any
 * derived channel whose extent matches. Returns the aligned channel and its
 * header name (the detected descriptor label, e.g. `Input A`).
 */
export function alignedChannels(
  capture: ParsedCapture,
  customNames?: Record<string, string>,
): Array<{
  channel: WaveformChannel;
  header: string;
}> {
  const axisLength = capture.timestamps.length;
  const aligned: Array<{ channel: WaveformChannel; header: string }> = [];
  for (const channel of capture.channels) {
    if (channel.data.length === axisLength) {
      aligned.push({
        channel,
        header: channelDisplayName(
          channel.name,
          channel.label,
          customNames?.[channel.name],
        ),
      });
    }
  }
  for (const derived of capture.derivedChannels) {
    if (derived.data.length === axisLength) {
      aligned.push({
        channel: {
          name: derived.label,
          label: derived.label,
          derived: true,
          data: derived.data,
          rawCounts: derived.rawCounts,
        },
        header: derived.label,
      });
    }
  }
  return aligned;
}

/**
 * Per-column traceability line (issue #106): the verbatim descriptor
 * label, the canonical base-SI unit the column values are stored in, the
 * verbatim file unit when it carries a display prefix (`mA` → `A`), and
 * the column's sample count. Data headers stay verbatim labels — units
 * live here, never affixed to a column name.
 */
export function channelTraceabilityLine(
  capture: ParsedCapture,
  columnIndex: number,
  rawLabel: string,
  derived: boolean,
  samples: number,
): string {
  let canonical: string;
  let fileUnit: string | null = null;
  if (derived) {
    const derivedIndex = capture.derivedChannels.findIndex(
      (entry) => entry.label === rawLabel,
    );
    canonical = splitUnit(getDerivedChannelUnit(capture, derivedIndex)).base;
  } else {
    const physicalIndex = capture.channels.findIndex(
      (entry) => entry.label === rawLabel,
    );
    const verbatim = normalizeUnit(
      physicalIndex >= 0
        ? capture.metadata.channels[physicalIndex]?.unit
        : undefined,
    );
    canonical = splitUnit(verbatim).base;
    if (verbatim !== "" && verbatim !== canonical) fileUnit = verbatim;
  }
  const fields = [
    `label=${csvEscape(rawLabel)}`,
    `unit=${csvEscape(canonical)}`,
  ];
  if (fileUnit !== null) fields.push(`file_unit=${csvEscape(fileUnit)}`);
  fields.push(`samples=${samples}`);
  return `# channel[${columnIndex}]: ${fields.join("; ")}`;
}

export function buildCsvHeaderLines(
  capture: ParsedCapture,
  fileName: string | null,
  customNames?: Record<string, string>,
): string[] {
  const metadata = capture.metadata;
  const columns = alignedChannels(capture, customNames);
  const lines: string[] = [
    "# FVF Viewer CSV export",
    `# file: ${fileName ?? "(memory)"}`,
    `# captured: ${formatCaptureTimestamp(metadata.timestamp14) || "(unknown)"}`,
    `# timebase: ${metadata.timebaseRaw}`,
    `# samples: ${capture.timestamps.length}`,
    `# channels: ${columns
      .map((entry) => entry.header)
      .map(csvEscape)
      .join(", ")}`,
    "# time_origin: stored time axis, t=0 at the trigger reference",
  ];
  columns.forEach((entry, columnIndex) => {
    lines.push(
      channelTraceabilityLine(
        capture,
        columnIndex,
        entry.channel.label,
        entry.channel.derived,
        entry.channel.data.length,
      ),
    );
  });
  const misaligned = [
    ...capture.channels,
    ...capture.derivedChannels.map((derived) => ({
      name: derived.label,
      label: derived.label,
      derived: true,
      data: derived.data,
      rawCounts: derived.rawCounts,
    })),
  ].filter((channel) => channel.data.length !== capture.timestamps.length);
  for (const channel of misaligned) {
    lines.push(
      `# note: ${channel.label || channel.name} omitted (${channel.data.length} samples, axis has ${capture.timestamps.length})`,
    );
  }
  return lines;
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Streamed CSV generation. Each yielded string is one bounded chunk
 * (metadata header plus up to `rowsPerChunk` data rows); the event loop
 * regains control between chunks.
 */
export async function* generateCsvChunks(
  capture: ParsedCapture,
  fileName: string | null = null,
  customNames?: Record<string, string>,
  rowsPerChunk: number = CSV_ROWS_PER_CHUNK,
): AsyncGenerator<string> {
  const columns = alignedChannels(capture, customNames);
  const axisLength = capture.timestamps.length;
  const header =
    [
      ...buildCsvHeaderLines(capture, fileName, customNames),
      ...columnHeaders(columns),
    ].join("\r\n") + "\r\n";

  let nextSample = 0;
  let first = true;
  while (nextSample < axisLength || first) {
    const end = Math.min(nextSample + rowsPerChunk, axisLength);
    const parts: string[] = [];
    if (first) {
      parts.push(header);
      first = false;
    }
    for (let sample = nextSample; sample < end; sample += 1) {
      const fields = [
        String(sample),
        formatSampleValue(capture.timestamps[sample]!),
        ...columns.map((entry) =>
          formatSampleValue(entry.channel.data[sample]!),
        ),
      ];
      parts.push(fields.join(","));
      parts.push("\r\n");
    }
    yield parts.join("");
    nextSample = end;
    if (nextSample < axisLength) {
      await yieldToMain();
    }
  }
}

function columnHeaders(columns: Array<{ header: string }>): string[] {
  return [
    ["sample", "time_s", ...columns.map((entry) => entry.header)]
      .map(csvEscape)
      .join(","),
  ];
}

/** Full export as one Blob assembled from the streamed chunks. */
export async function exportCaptureCsv(
  capture: ParsedCapture,
  fileName: string | null = null,
  customNames?: Record<string, string>,
): Promise<Blob> {
  const parts: string[] = [];
  for await (const chunk of generateCsvChunks(capture, fileName, customNames)) {
    parts.push(chunk);
  }
  return new Blob(parts, { type: "text/csv" });
}
