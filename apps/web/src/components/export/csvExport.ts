/**
 * CSV export core (issues #17, #99, overview §5.2-E): client-side `Blob` generation
 * of the complete capture — metadata header rows plus a
 * `sample,time_s,<channel names…>` table whose columns follow the actually
 * detected channel names. In compare mode (issue #99), supports composite
 * time-synchronized export aligning File 1 and File 2 on File 1's time grid with
 * horizontal time slip Δt and resampling metadata headers.
 * Generation is chunked and yields to the event loop between chunks, so large
 * exports never freeze the main thread. Supports comma and semicolon delimiters.
 */

import type { ParsedCapture, WaveformChannel } from "../../types/capture";
import { channelDisplayName } from "../../state/channelNamesStore";
import { formatCaptureTimestamp } from "../banner/metadataModel";
import {
  getDerivedChannelUnit,
  normalizeUnit,
  splitUnit,
} from "../../capture/channelUnits";
import { slipSeconds, slippedRefDisplayLane } from "../canvas/timeSlip";

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

export function csvEscape(value: string, delimiter: string = ","): string {
  const pattern = delimiter === ";" ? /[";\r\n]/ : /[",\r\n]/;
  if (pattern.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export { csvFileName, compositeCsvFileName } from "./exportFileName";

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
  fileLabel?: string,
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
  const fields: string[] = [];
  if (fileLabel) fields.push(`file=${csvEscape(fileLabel)}`);
  fields.push(`label=${csvEscape(rawLabel)}`);
  fields.push(`unit=${csvEscape(canonical)}`);
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
      .map((h) => csvEscape(h))
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

export function buildCompositeCsvHeaderLines(
  primaryCapture: ParsedCapture,
  primaryFileName: string | null,
  referenceCapture: ParsedCapture,
  referenceFileName: string | null,
  timeSlipSamples: number,
  primaryColumns: Array<{ header: string; channel: WaveformChannel }>,
  refColumns: Array<{ header: string; channel: WaveformChannel }>,
  delimiter: string = ",",
): string[] {
  const dtSeconds = slipSeconds(primaryCapture.timestamps, timeSlipSamples);
  const pDeltaT =
    primaryCapture.metadata.deltaT ||
    (primaryCapture.timestamps.length > 1
      ? primaryCapture.timestamps[1]! - primaryCapture.timestamps[0]!
      : 1);
  const rDeltaT =
    referenceCapture.metadata.deltaT ||
    (referenceCapture.timestamps.length > 1
      ? referenceCapture.timestamps[1]! - referenceCapture.timestamps[0]!
      : 1);
  const ratio = (pDeltaT / rDeltaT).toFixed(6);

  const lines: string[] = [
    "# FVF Viewer CSV export (composite time-aligned)",
    `# file: ${primaryFileName ?? "(memory)"}`,
    `# reference_file: ${referenceFileName ?? "(memory)"}`,
    `# captured: ${formatCaptureTimestamp(primaryCapture.metadata.timestamp14) || "(unknown)"}`,
    `# reference_captured: ${formatCaptureTimestamp(referenceCapture.metadata.timestamp14) || "(unknown)"}`,
    `# timebase: ${primaryCapture.metadata.timebaseRaw}`,
    `# reference_timebase: ${referenceCapture.metadata.timebaseRaw}`,
    `# trigger_alignment_dt_s: ${dtSeconds}`,
    `# time_slip_samples: ${timeSlipSamples}`,
    `# sample_rate_ratio: ${ratio}`,
    `# samples: ${primaryCapture.timestamps.length}`,
    `# channels: ${[...primaryColumns, ...refColumns].map((c) => csvEscape(c.header, delimiter)).join(delimiter === ";" ? "; " : ", ")}`,
    "# time_origin: stored time axis of File 1, t=0 at the trigger reference",
  ];

  let colIdx = 0;
  for (const entry of primaryColumns) {
    lines.push(
      channelTraceabilityLine(
        primaryCapture,
        colIdx,
        entry.channel.label,
        entry.channel.derived,
        entry.channel.data.length,
        "File 1",
      ),
    );
    colIdx += 1;
  }
  for (const entry of refColumns) {
    lines.push(
      channelTraceabilityLine(
        referenceCapture,
        colIdx,
        entry.channel.label,
        entry.channel.derived,
        primaryCapture.timestamps.length,
        "File 2",
      ),
    );
    colIdx += 1;
  }
  return lines;
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Streamed CSV generation for a single capture. Each yielded string is one bounded chunk
 * (metadata header plus up to `rowsPerChunk` data rows); the event loop
 * regains control between chunks.
 */
export async function* generateCsvChunks(
  capture: ParsedCapture,
  fileName: string | null = null,
  customNames?: Record<string, string>,
  rowsPerChunk: number = CSV_ROWS_PER_CHUNK,
  delimiter: string = ",",
): AsyncGenerator<string> {
  const columns = alignedChannels(capture, customNames);
  const axisLength = capture.timestamps.length;
  const header =
    [
      ...buildCsvHeaderLines(capture, fileName, customNames),
      ...columnHeaders(columns, delimiter),
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
      parts.push(fields.join(delimiter));
      parts.push("\r\n");
    }
    yield parts.join("");
    nextSample = end;
    if (nextSample < axisLength) {
      await yieldToMain();
    }
  }
}

/**
 * Streamed CSV generation for composite time-aligned comparison of two captures.
 * Aligns File 2 onto File 1's time grid using the Wasm-resampled reference lanes
 * and applies the current horizontal time slip Δt.
 */
export async function* generateCompositeCsvChunks(
  primaryCapture: ParsedCapture,
  primaryFileName: string | null = null,
  referenceCapture: ParsedCapture,
  referenceFileName: string | null = null,
  refLanes: Float32Array[] = [],
  timeSlipSamples: number = 0,
  customNames?: Record<string, string>,
  rowsPerChunk: number = CSV_ROWS_PER_CHUNK,
  delimiter: string = ",",
): AsyncGenerator<string> {
  const primaryCols = alignedChannels(primaryCapture, customNames).map(
    (entry) => ({
      ...entry,
      header: `[File 1] ${entry.header}`,
    }),
  );

  const refCols = referenceCapture.channels.map((channel, idx) => ({
    channel,
    header: `[File 2] ${channelDisplayName(channel.name, channel.label, undefined)}`,
    slippedLane: refLanes[idx]
      ? slippedRefDisplayLane(refLanes[idx]!, timeSlipSamples, 100, 0, false)
      : new Float32Array(primaryCapture.timestamps.length).fill(Number.NaN),
  }));

  const allColumns = [...primaryCols, ...refCols];
  const axisLength = primaryCapture.timestamps.length;
  const header =
    [
      ...buildCompositeCsvHeaderLines(
        primaryCapture,
        primaryFileName,
        referenceCapture,
        referenceFileName,
        timeSlipSamples,
        primaryCols,
        refCols,
        delimiter,
      ),
      ["sample", "time_s", ...allColumns.map((entry) => entry.header)]
        .map((h) => csvEscape(h, delimiter))
        .join(delimiter),
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
        formatSampleValue(primaryCapture.timestamps[sample]!),
        ...primaryCols.map((c) => formatSampleValue(c.channel.data[sample]!)),
        ...refCols.map((c) => formatSampleValue(c.slippedLane[sample]!)),
      ];
      parts.push(fields.join(delimiter));
      parts.push("\r\n");
    }
    yield parts.join("");
    nextSample = end;
    if (nextSample < axisLength) {
      await yieldToMain();
    }
  }
}

function columnHeaders(
  columns: Array<{ header: string }>,
  delimiter: string = ",",
): string[] {
  return [
    ["sample", "time_s", ...columns.map((entry) => entry.header)]
      .map((h) => csvEscape(h, delimiter))
      .join(delimiter),
  ];
}

/** Full export of a single capture as one Blob assembled from the streamed chunks. */
export async function exportCaptureCsv(
  capture: ParsedCapture,
  fileName: string | null = null,
  customNames?: Record<string, string>,
  delimiter: string = ",",
): Promise<Blob> {
  const parts: string[] = [];
  for await (const chunk of generateCsvChunks(
    capture,
    fileName,
    customNames,
    CSV_ROWS_PER_CHUNK,
    delimiter,
  )) {
    parts.push(chunk);
  }
  return new Blob(parts, { type: "text/csv" });
}

/** Full export of a composite time-aligned capture comparison as one Blob. */
export async function exportCompositeCsv(
  primaryCapture: ParsedCapture,
  primaryFileName: string | null = null,
  referenceCapture: ParsedCapture,
  referenceFileName: string | null = null,
  refLanes: Float32Array[] = [],
  timeSlipSamples: number = 0,
  customNames?: Record<string, string>,
  delimiter: string = ",",
): Promise<Blob> {
  const parts: string[] = [];
  for await (const chunk of generateCompositeCsvChunks(
    primaryCapture,
    primaryFileName,
    referenceCapture,
    referenceFileName,
    refLanes,
    timeSlipSamples,
    customNames,
    CSV_ROWS_PER_CHUNK,
    delimiter,
  )) {
    parts.push(chunk);
  }
  return new Blob(parts, { type: "text/csv" });
}
