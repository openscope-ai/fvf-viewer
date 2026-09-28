/**
 * Metadata inspector view-model builder (issue #11): pure transformation
 * from raw ParsedCapture and metadata fields into formatted display representations.
 *
 * Rules:
 * - timestamp14 (HHMMSSYYYYMMDD) -> 'YYYY-MM-DD HH:MM:SS', or 'Not recorded' when absent/invalid.
 * - timebase displayed verbatim as metadata.timebaseRaw.
 * - Physical channel count distinguishes active physical inputs from derived channels.
 * - Samples per channel: single value when uniform across physical channels,
 *   per-channel list when counts differ, derived channels itemized separately.
 * - Explicit trigger reference attribution ("Trigger: 0 s (stored axis)",
 *   issue #61 wording as revised by issue #105) with an explanatory
 *   tooltip.
 * - Per-channel vertical lines ("{label} · {perDiv} {unit}/Div", issue #103)
 *   when the capture carries unit metadata, else null.
 */

import {
  describeChannelMeta,
  formatCanonicalPerDiv,
  normalizeUnit,
} from "../../capture/channelUnits";
import type { ChannelInfo, ParsedCapture } from "../../types/capture";

export interface PhysicalChannelSummary {
  name: string;
  label: string;
  /** True when a per-file custom amendment is applied (issue #64). */
  custom: boolean;
  samples: number;
  formattedSamples: string;
  tooltip?: string;
  perDivText: string | null;
  /**
   * Canonical-SI vertical surfacing (issue #106, compact #121):
   * `{name}: {perDivText}` with the SI ladder picked from the base-SI magnitude,
   * or null when the capture predates unit metadata.
   */
  verticalLine: string | null;
}

export interface DerivedChannelSummary {
  name: string;
  label: string;
  recordLabel?: string;
  samples?: number;
  formattedSamples: string;
}

export interface MetadataBannerModel {
  fileName: string;
  captureDate: string;
  physicalChannelCount: number;
  physicalChannelsLabel: string;
  physicalChannels: PhysicalChannelSummary[];
  isUniformSamples: boolean;
  samplesPerChannelText: string | null;
  uniformSamplesCount: number | null;
  derivedChannels: DerivedChannelSummary[];
  timebaseRaw: string;
  triggerReferenceValue: "0 s";
  triggerReferenceLabel: "0 s";
  triggerReferenceTooltip: string;
}

export function formatCaptureTimestamp(timestamp14?: string | null): string {
  if (!timestamp14 || typeof timestamp14 !== "string") {
    return "Not recorded";
  }
  const trimmed = timestamp14.trim();
  if (!/^\d{14}$/.test(trimmed)) {
    return "Not recorded";
  }

  const hh = trimmed.slice(0, 2);
  const min = trimmed.slice(2, 4);
  const ss = trimmed.slice(4, 6);
  const yyyy = trimmed.slice(6, 10);
  const mm = trimmed.slice(10, 12);
  const dd = trimmed.slice(12, 14);

  const hour = Number(hh);
  const minute = Number(min);
  const second = Number(ss);
  const year = Number(yyyy);
  const month = Number(mm);
  const day = Number(dd);

  if (
    year < 1 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return "Not recorded";
  }

  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

/**
 * Canonical-SI per-division text (issue #106): `{perDiv} {unit}/Div`
 * with the SI ladder picked from the base-SI magnitude, or null when
 * unit metadata is absent.
 */
function perDivText(channel: ChannelInfo): string | null {
  if (channel.unit === undefined || channel.perDiv === undefined) return null;
  if (!Number.isFinite(channel.perDiv)) return null;
  return formatCanonicalPerDiv(channel.perDiv, normalizeUnit(channel.unit));
}

export function buildMetadataModel(
  capture: ParsedCapture,
  fileName?: string | null,
  customNames?: Record<string, string>,
): MetadataBannerModel {
  const metadata = capture.metadata;
  const captureDate = formatCaptureTimestamp(metadata.timestamp14);

  const physical = (metadata.channels || []).filter((c) => !c.derived);
  const physicalChannelCount = physical.length;
  const physicalChannelsLabel = `${physicalChannelCount} ${
    physicalChannelCount === 1 ? "channel" : "channels"
  }`;

  let isUniformSamples: boolean;
  let uniformSamplesCount: number | null;
  let samplesPerChannelText: string | null;

  if (physical.length === 0) {
    isUniformSamples = true;
    uniformSamplesCount = 0;
    samplesPerChannelText = "0 samples";
  } else {
    const firstCount = physical[0]?.samples ?? 0;
    const allSame = physical.every((c) => c.samples === firstCount);
    if (allSame) {
      isUniformSamples = true;
      uniformSamplesCount = firstCount;
      samplesPerChannelText = `${firstCount.toLocaleString("en-US")} samples`;
    } else {
      isUniformSamples = false;
      uniformSamplesCount = null;
      samplesPerChannelText = null;
    }
  }

  const physicalSummaries: PhysicalChannelSummary[] = physical.map(
    (c, index) => {
      const rawCustom = customNames?.[c.name]?.trim();
      const hasCustom = Boolean(rawCustom);
      const origIdx = capture.metadata.channels.findIndex(
        (info) => info.name === c.name,
      );
      const meta = describeChannelMeta(capture, origIdx >= 0 ? origIdx : index);

      const customWithSamples =
        hasCustom && !isUniformSamples
          ? `${rawCustom} (${c.samples.toLocaleString("en-US")} samples)`
          : hasCustom
            ? rawCustom
            : !isUniformSamples
              ? `${c.samples.toLocaleString("en-US")} samples`
              : null;

      const parts: string[] = [];
      if (customWithSamples) {
        parts.push(customWithSamples);
      }
      if (meta.perDivText !== null) {
        parts.push(meta.perDivText);
      }
      if (meta.windowText !== null) {
        parts.push(meta.windowText);
      }
      if (meta.saturated > 0) {
        parts.push(`${meta.saturated} saturated`);
      }
      const tooltip = parts.length > 0 ? parts.join(" · ") : undefined;

      const pDiv = perDivText(c);
      const vLine = pDiv !== null ? `${c.name}: ${pDiv}` : null;

      return {
        name: c.name,
        label: c.name,
        custom: hasCustom,
        samples: c.samples,
        formattedSamples: `${c.samples.toLocaleString("en-US")} samples`,
        tooltip,
        perDivText: pDiv,
        verticalLine: vLine,
      };
    },
  );

  const derivedList: DerivedChannelSummary[] = [];
  if (capture.derivedChannels && capture.derivedChannels.length > 0) {
    for (const d of capture.derivedChannels) {
      derivedList.push({
        name: d.label,
        label: d.label,
        recordLabel: d.recordLabel,
        samples: d.samples,
        formattedSamples:
          d.samples !== undefined
            ? `${d.samples.toLocaleString("en-US")} samples`
            : "unknown samples",
      });
    }
  } else {
    const derivedFromMeta = (metadata.channels || []).filter((c) => c.derived);
    for (const d of derivedFromMeta) {
      derivedList.push({
        name: d.name,
        label: d.label || d.name,
        samples: d.samples,
        formattedSamples: `${d.samples.toLocaleString("en-US")} samples`,
      });
    }
  }

  return {
    fileName: fileName || "Untitled capture",
    captureDate,
    physicalChannelCount,
    physicalChannelsLabel,
    physicalChannels: physicalSummaries,
    isUniformSamples,
    samplesPerChannelText,
    uniformSamplesCount,
    derivedChannels: derivedList,
    timebaseRaw: metadata.timebaseRaw || "",
    triggerReferenceValue: "0 s",
    triggerReferenceLabel: "0 s",
    triggerReferenceTooltip:
      "t = 0 marks the acquisition trigger reference; its window position is read from the file's stored time axis, not assumed at the display center.",
  };
}
