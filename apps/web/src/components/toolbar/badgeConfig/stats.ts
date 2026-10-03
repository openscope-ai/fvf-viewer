/**
 * Badge-config stats lines (issue #204): read-only monospace lines in the
 * popover hero — channel sample counts and voltage extents from the
 * capture, cursor sample positions with SI-formatted timestamps.
 */

import { formatTime } from "../../cursors/siFormat";
import type { WaveformChannel } from "../../../types/capture";

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** Signed fixed(2) value: explicit + above zero, U+2212 minus below. */
function formatExtentValue(value: number): string {
  if (Object.is(value, -0) || value === 0) return "0.00";
  if (value < 0) return `\u2212${Math.abs(value).toFixed(2)}`;
  return `+${value.toFixed(2)}`;
}

function finiteExtent(data: Float32Array): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i];
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? { min, max } : null;
}

/**
 * Channel stats line: `<samples> samples · <min> <unit> … <max> <unit>`
 * derived from the capture's channel data (saturated NaN samples never
 * stretch the extent).
 */
export function channelStatsLine(
  channel: WaveformChannel | undefined,
  unit?: string,
): string {
  if (!channel) return "0 samples";
  const count = formatCount(channel.data.length);
  const extent = finiteExtent(channel.data);
  if (!extent) return `${count} samples`;
  const suffix = unit && unit.trim() ? ` ${unit.trim()}` : "";
  return `${count} samples · ${formatExtentValue(extent.min)}${suffix} \u2026 ${formatExtentValue(extent.max)}${suffix}`;
}

/**
 * Cursor stats line: `Sample <index> · <timestamp>` from the cursor store's
 * sample index and the capture's stored time axis.
 */
export function cursorPositionLine(
  sampleIndex: number,
  timestamps: ArrayLike<number> | undefined,
): string {
  if (!timestamps || timestamps.length === 0) {
    return `Sample ${formatCount(Math.max(0, sampleIndex))}`;
  }
  const clamped = Math.max(
    0,
    Math.min(Math.round(sampleIndex), timestamps.length - 1),
  );
  return `Sample ${formatCount(clamped)} · ${formatTime(timestamps[clamped]!)}`;
}
