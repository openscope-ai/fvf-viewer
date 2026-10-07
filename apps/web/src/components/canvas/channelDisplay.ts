/**
 * Per-channel display transforms (issue #224): the Y-scale % display
 * gain, the vertical offset (the shared store #98's Ctrl+drag and
 * ground-marker interactions will write), and the invert ± polarity
 * correction. All three are *display-only* transforms on the shared
 * overlay Y axis:
 *
 * - Scale and offset NEVER alter tooltips, the HUD readout card, or
 *   cursor delta measurements — those always report true physical
 *   samples straight from the capture buffers.
 * - Invert is a polarity correction (reversed differential wiring), so
 *   it flips the displayed waveform AND every derived readout of that
 *   channel consistently.
 *
 * Composition (single source of truth for the popover, the live lanes,
 * the print PNG re-plot, and #98's future canvas interactions):
 *
 *   display = sign * physical * (scalePercent / 100) + offset
 *   readout = sign * physical
 *
 * where sign is −1 exactly when the channel is inverted. The offset is
 * expressed in the channel's own display (post-scale) axis units.
 */

import { formatCanonicalPerDiv } from "../../capture/channelUnits";
import { paletteKeyForChannel } from "./themePalette";

/**
 * Channel palette keys (cursors never take display transforms). Issue
 * #96 extends the per-key display transforms to File 2 reference
 * channels (`Ref-A`…`Ref-D`), so reference badges fully participate in
 * the #224 display controls.
 */
export type ChannelKey =
  "A" | "B" | "C" | "D" | "Ref-A" | "Ref-B" | "Ref-C" | "Ref-D";

export const CHANNEL_DISPLAY_KEYS: readonly ChannelKey[] = [
  "A",
  "B",
  "C",
  "D",
  "Ref-A",
  "Ref-B",
  "Ref-C",
  "Ref-D",
];

/** True for the File 2 reference channel keys (issue #96). */
export function isRefChannelKey(key: ChannelKey): boolean {
  return key.startsWith("Ref-");
}

/** Persisted per-channel display record (absent field = default). */
export interface ChannelDisplayConfig {
  /** Display gain percent 10–500; absent/100 = exactly as recorded. */
  yScalePercent?: number;
  /** Vertical display offset in the channel's axis unit; absent/0 = none. */
  offset?: number;
  /** Invert ±: multiplies displayed trace and readouts by −1. */
  inverted?: boolean;
}

export type ChannelDisplayConfigs = Partial<
  Record<ChannelKey, ChannelDisplayConfig>
>;

export const MIN_Y_SCALE_PERCENT = 10;
export const MAX_Y_SCALE_PERCENT = 500;
export const DEFAULT_Y_SCALE_PERCENT = 100;
export const DEFAULT_OFFSET = 0;

/** Percent-per-4px horizontal scrub rate for the Y-scale field. */
export const Y_SCALE_PX_PER_PERCENT = 8;
/** Axis-unit-per-8px horizontal scrub rate for the offset field. */
export const OFFSET_PX_PER_UNIT = 8;

export function isChannelKey(value: unknown): value is ChannelKey {
  return (CHANNEL_DISPLAY_KEYS as readonly string[]).includes(value as string);
}

/** Clamps/rounds a raw percent to the storable 10–500 integer range. */
export function normalizeYScalePercent(value: number): number {
  return Math.max(
    MIN_Y_SCALE_PERCENT,
    Math.min(MAX_Y_SCALE_PERCENT, Math.round(value)),
  );
}

/** Rounds a raw offset to a finite storable value (default 0). */
export function normalizeOffset(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OFFSET;
  return Math.round(value * 1000) / 1000;
}

/** Resolves a channel name ("Input A"/"A") to a display key, or null. */
export function displayKeyForChannel(channelName: string): ChannelKey | null {
  const key = paletteKeyForChannel(channelName);
  return isChannelKey(key) ? key : null;
}

/** Effective Y-scale percent for a channel key (10–500; 100 default). */
export function effectiveYScale(
  configs: ChannelDisplayConfigs,
  key: ChannelKey | null,
): number {
  const pct = key !== null ? configs[key]?.yScalePercent : undefined;
  if (typeof pct !== "number" || !Number.isFinite(pct)) {
    return DEFAULT_Y_SCALE_PERCENT;
  }
  return normalizeYScalePercent(pct);
}

/** Effective vertical offset for a channel key (0 default). */
export function effectiveOffset(
  configs: ChannelDisplayConfigs,
  key: ChannelKey | null,
): number {
  const offset = key !== null ? configs[key]?.offset : undefined;
  if (typeof offset !== "number" || !Number.isFinite(offset)) {
    return DEFAULT_OFFSET;
  }
  return offset;
}

/** Effective invert state for a channel key (false default). */
export function effectiveInverted(
  configs: ChannelDisplayConfigs,
  key: ChannelKey | null,
): boolean {
  return key !== null ? configs[key]?.inverted === true : false;
}

/** Readout sign for a channel: −1 exactly when inverted (issue #224). */
export function invertSign(
  configs: ChannelDisplayConfigs,
  channelName: string,
): 1 | -1 {
  return effectiveInverted(configs, displayKeyForChannel(channelName)) ? -1 : 1;
}

/** True when every transform part of a record sits at its default. */
export function isDefaultConfig(config: ChannelDisplayConfig): boolean {
  return (
    config.yScalePercent === undefined &&
    config.offset === undefined &&
    config.inverted === undefined
  );
}

/** Transforms one physical sample into display space (NaN passes through). */
export function channelDisplayValue(
  physical: number,
  yScalePercent: number,
  offset: number,
  inverted: boolean,
): number {
  if (!Number.isFinite(physical)) return physical;
  const sign = inverted ? -1 : 1;
  return sign * physical * (yScalePercent / 100) + offset;
}

/**
 * Builds a channel's transformed display lane from its physical
 * rail-clipped lane (issue #106 `buildDisplayData` output). Returns the
 * input array unchanged when every transform is at its default, so the
 * 100% / 0 / non-inverted state stays zero-copy and byte-identical.
 *
 * Issue #238: an optional `out` buffer lets high-frequency callers
 * (scrub drags at pointer cadence) reuse one allocation per series
 * instead of churning the GC with a fresh lane per commit.
 */
export function transformDisplayLane(
  lane: Float32Array,
  yScalePercent: number,
  offset: number,
  inverted: boolean,
  out?: Float32Array,
): Float32Array {
  if (
    yScalePercent === DEFAULT_Y_SCALE_PERCENT &&
    offset === DEFAULT_OFFSET &&
    !inverted
  ) {
    if (out && out !== lane && out.length === lane.length) {
      out.set(lane);
      return out;
    }
    return lane;
  }
  const target =
    out && out.length === lane.length ? out : new Float32Array(lane.length);
  for (let i = 0; i < lane.length; i += 1) {
    target[i] = channelDisplayValue(
      lane[i] ?? Number.NaN,
      yScalePercent,
      offset,
      inverted,
    );
  }
  return target;
}

/** Transforms a [min, max] bounds pair into display space (affine). */
export function transformBounds(
  bounds: { min: number; max: number },
  yScalePercent: number,
  offset: number,
  inverted: boolean,
): { min: number; max: number } {
  const a = channelDisplayValue(bounds.min, yScalePercent, offset, inverted);
  const b = channelDisplayValue(bounds.max, yScalePercent, offset, inverted);
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** Vertical graticule divisions of the plot area (classic 10×8 scope). */
export const Y_DIVISIONS = 10;

/**
 * The derived read-only "≈ unit/Div" readout (issue #224): current
 * viewport geometry ÷ scale. `(max − min) / 10` is the display-space
 * per-division the axis currently shows; dividing by the scale factor
 * yields the effective physical per-division being observed — at 100%
 * both are identical.
 */
export function effectivePerDiv(
  scaleMin: number,
  scaleMax: number,
  plotHeightCss: number,
  yScalePercent: number,
): number {
  if (
    !Number.isFinite(scaleMin) ||
    !Number.isFinite(scaleMax) ||
    !Number.isFinite(plotHeightCss) ||
    plotHeightCss <= 0
  ) {
    return Number.NaN;
  }
  const displayPerDiv = (scaleMax - scaleMin) / Y_DIVISIONS;
  const factor = yScalePercent / 100;
  return factor > 0 ? displayPerDiv / factor : Number.NaN;
}

/** Formats the per-division readout with the channel's canonical unit. */
export function formatPerDiv(
  perDiv: number,
  unit: string | undefined | null,
): string {
  return formatCanonicalPerDiv(perDiv, unit);
}
