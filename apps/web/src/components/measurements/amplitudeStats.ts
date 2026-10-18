/**
 * Amplitude measurements calculation core (issue #278):
 * Computes peak-to-peak (Vpp), maximum (Vmax), minimum (Vmin), mean, and AC+DC true RMS
 * over the visible time window for visible channels.
 *
 * Strict requirements:
 * 1. Zero server egress: 100% client-side execution in the browser.
 * 2. Saturated (Overload-NaN) samples are filtered and never distort statistics.
 * 3. Respects per-channel invert ±, Y-scale % display gain, and vertical offset.
 * 4. Units follow each channel's native unit (e.g. V, A, raw) with standard SI prefixes.
 */

import type { ParsedCapture } from "../../types/capture";
import {
  getDerivedChannelUnit,
  getPhysicalChannelUnit,
  formatChannelValue,
} from "../../capture/channelUnits";
import {
  displayKeyForChannel,
  effectiveInverted,
  effectiveOffset,
  effectiveYScale,
  type ChannelDisplayConfigs,
} from "../canvas/channelDisplay";
import {
  effectiveTraceColor,
  type ViewportTheme,
} from "../canvas/themePalette";
import { channelDisplayName } from "../../state/channelNamesStore";
import { slippedRefDisplayLane } from "../canvas/timeSlip";

export interface ChannelAmplitudeStats {
  channelKey: string;
  channelName: string;
  displayName: string;
  color: string;
  unit: string;
  count: number;
  vpp: number | null;
  vmax: number | null;
  vmin: number | null;
  mean: number | null;
  rms: number | null;
}

import { findNearestSampleIndex } from "../cursors/cursorPlugin";

/**
 * Finds the index range of samples within the visible horizontal time window [xMin, xMax].
 */
export function findVisibleIndexRange(
  timestamps: ArrayLike<number>,
  xMin: number | null,
  xMax: number | null,
): { startIndex: number; endIndex: number } {
  const len = timestamps.length;
  if (len === 0) {
    return { startIndex: 0, endIndex: -1 };
  }

  const tStart = timestamps[0]!;
  const tEnd = timestamps[len - 1]!;

  if (xMax !== null && xMax < tStart) {
    return { startIndex: 0, endIndex: -1 };
  }
  if (xMin !== null && xMin > tEnd) {
    return { startIndex: len, endIndex: len - 1 };
  }

  const startIndex =
    xMin !== null ? findNearestSampleIndex(timestamps, xMin) : 0;
  const endIndex =
    xMax !== null ? findNearestSampleIndex(timestamps, xMax) : len - 1;

  return { startIndex, endIndex: Math.max(startIndex - 1, endIndex) };
}

/**
 * Computes amplitude statistics over a slice [startIndex, endIndex] of a sample buffer.
 * Non-finite (saturated / NaN) samples are skipped completely.
 */
export function computeChannelStats(
  data: ArrayLike<number>,
  startIndex: number,
  endIndex: number,
  yScalePercent: number = 100,
  offset: number = 0,
  inverted: boolean = false,
): {
  count: number;
  vpp: number | null;
  vmax: number | null;
  vmin: number | null;
  mean: number | null;
  rms: number | null;
} {
  const len = data.length;
  const start = Math.max(0, startIndex);
  const end = Math.min(len - 1, endIndex);

  if (start > end || len === 0) {
    return {
      count: 0,
      vpp: null,
      vmax: null,
      vmin: null,
      mean: null,
      rms: null,
    };
  }

  const sign = inverted ? -1 : 1;
  const scale = yScalePercent / 100;

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let i = start; i <= end; i += 1) {
    const raw = data[i];
    if (raw === undefined || !Number.isFinite(raw)) continue;

    const val = sign * raw * scale + offset;
    if (val < min) min = val;
    if (val > max) max = val;
    sum += val;
    sumSq += val * val;
    count += 1;
  }

  if (count === 0) {
    return {
      count: 0,
      vpp: null,
      vmax: null,
      vmin: null,
      mean: null,
      rms: null,
    };
  }

  const mean = sum / count;
  const rms = Math.sqrt(Math.max(0, sumSq / count));
  const vpp = max - min;

  return { count, vpp, vmax: max, vmin: min, mean, rms };
}

export function computeAllVisibleChannelStats(
  capture: ParsedCapture | null | undefined,
  xMin: number | null,
  xMax: number | null,
  activeChannels: string[],
  displayConfigs: ChannelDisplayConfigs,
  customNames?: Record<string, string>,
  refCapture?: ParsedCapture | null,
  refLanes?: Float32Array[] | null,
  refActiveChannels?: string[],
  timeSlipSamples?: number,
  theme: ViewportTheme = "dark",
  customColors: Record<string, string> = {},
): ChannelAmplitudeStats[] {
  if (!capture || capture.channels.length === 0) {
    return [];
  }

  const { startIndex, endIndex } = findVisibleIndexRange(
    capture.timestamps,
    xMin,
    xMax,
  );

  const results: ChannelAmplitudeStats[] = [];

  // 1. Primary physical channels
  for (let index = 0; index < capture.channels.length; index += 1) {
    const channel = capture.channels[index]!;
    if (!activeChannels.includes(channel.name)) continue;

    const key = displayKeyForChannel(channel.name);
    const yScale = effectiveYScale(displayConfigs, key);
    const offset = effectiveOffset(displayConfigs, key);
    const inverted = effectiveInverted(displayConfigs, key);
    const unit = getPhysicalChannelUnit(capture, index);
    const color = effectiveTraceColor(theme, customColors, channel.name);
    const displayName = channelDisplayName(
      channel.name,
      channel.label,
      customNames?.[channel.name],
    );

    const stats = computeChannelStats(
      channel.data,
      startIndex,
      endIndex,
      yScale,
      offset,
      inverted,
    );

    results.push({
      channelKey: channel.name,
      channelName: channel.name,
      displayName,
      color,
      unit,
      ...stats,
    });
  }

  // 2. Primary derived channels
  for (
    let derivedIdx = 0;
    derivedIdx < capture.derivedChannels.length;
    derivedIdx += 1
  ) {
    const derived = capture.derivedChannels[derivedIdx]!;
    if (!activeChannels.includes(derived.label)) continue;

    const unit = getDerivedChannelUnit(capture, derivedIdx);
    const color = effectiveTraceColor(theme, customColors, derived.label);

    const stats = computeChannelStats(
      derived.data,
      startIndex,
      endIndex,
      100,
      0,
      false,
    );

    results.push({
      channelKey: derived.label,
      channelName: derived.label,
      displayName: derived.label,
      color,
      unit,
      ...stats,
    });
  }

  // 3. File 2 Reference channels (compare mode)
  if (refCapture && refLanes && refLanes.length > 0) {
    for (let refIdx = 0; refIdx < refCapture.channels.length; refIdx += 1) {
      const refChannel = refCapture.channels[refIdx]!;
      const refName = `Ref-${refChannel.name.replace(/^Input\s+/i, "")}`;
      if (!refActiveChannels?.includes(refName)) continue;

      const refKey = displayKeyForChannel(refName);
      const yScale = effectiveYScale(displayConfigs, refKey);
      const offset = effectiveOffset(displayConfigs, refKey);
      const inverted = effectiveInverted(displayConfigs, refKey);
      const unit = getPhysicalChannelUnit(refCapture, refIdx);
      const color = effectiveTraceColor(theme, customColors, refName);

      const baseLane = refLanes[refIdx];
      if (!baseLane) continue;

      const displayLane = slippedRefDisplayLane(
        baseLane,
        timeSlipSamples ?? 0,
        yScale,
        offset,
        inverted,
      );

      const stats = computeChannelStats(
        displayLane,
        startIndex,
        endIndex,
        100,
        0,
        false,
      );

      results.push({
        channelKey: refName,
        channelName: refName,
        displayName: refName,
        color,
        unit,
        ...stats,
      });
    }
  }

  return results;
}

export function formatMetricValue(
  value: number | null | undefined,
  unit: string | undefined | null,
): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  return formatChannelValue(value, unit);
}

export { formatChannelValue };
