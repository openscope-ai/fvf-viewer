/**
 * Horizontal time slip math (issue #97): File 2's reference lanes are
 * Wasm-resampled onto File 1's trigger-relative time grid (issue #96),
 * index-aligned so lane[i] shows File 2 at grid time timestamps[i]. A
 * time slip of `s` grid samples shifts File 2 right by `s` samples:
 *
 *   slipped[i] = base[i - s]   (linear interpolation for fractional s,
 *                              NaN outside the record / through gaps)
 *
 * Slip lives in *grid sample units* (not seconds) so the keyboard nudge
 * ("1 sample index", Shift = 10) and the Align-at-Cursors snap are exact
 * integer index arithmetic with zero pixel guesswork. The slipped value
 * of a duration is derived from the grid only for readouts.
 *
 * Composition with the #224 display transforms stays display-only:
 * readouts keep reading the untouched capture buffers; the slip composes
 * with the per-key transform in one fused pass
 * (`slippedRefDisplayLane`) so a 60 FPS drag rewrites each lane once.
 */

import { findNearestSampleIndex } from "../cursors/cursorPlugin";
import {
  DEFAULT_OFFSET,
  DEFAULT_Y_SCALE_PERCENT,
  channelDisplayValue,
} from "./channelDisplay";

/**
 * Fused slip + #224 display transform for one reference lane
 * (single pass, `out` reusable across frames):
 *
 *   display = sign * slipped * (scalePercent / 100) + offset
 *
 * Returns the base lane itself when the slip is 0 and every transform
 * sits at its default (zero-copy), mirroring `transformDisplayLane`.
 */
export function slippedRefDisplayLane(
  base: Float32Array,
  slip: number,
  yScalePercent: number,
  offset: number,
  inverted: boolean,
  out?: Float32Array,
): Float32Array {
  const passthrough =
    slip === 0 &&
    yScalePercent === DEFAULT_Y_SCALE_PERCENT &&
    offset === DEFAULT_OFFSET &&
    !inverted;
  if (passthrough) return base;
  const len = base.length;
  // Defense-in-depth (review F3): never write into a stale buffer whose
  // length no longer matches — typed-array OOB stores are silently
  // dropped, which would truncate the lane tail.
  const target = out && out.length === len ? out : new Float32Array(len);
  for (let i = 0; i < len; i += 1) {
    const src = i - slip;
    const lo = Math.floor(src);
    const frac = src - lo;
    // An exact integer source index needs no upper neighbour, so the
    // boundary sample stays valid on integer slips.
    const hi = frac === 0 ? lo : lo + 1;
    let value: number;
    if (lo < 0 || hi >= len) {
      value = Number.NaN;
    } else {
      const a = base[lo]!;
      const b = frac === 0 ? a : base[hi]!;
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        value = Number.NaN;
      } else {
        value = a + (b - a) * frac;
      }
    }
    target[i] = channelDisplayValue(value, yScalePercent, offset, inverted);
  }
  return target;
}

/**
 * Grid time at a (possibly fractional) sample index, linearly
 * interpolated and clamped to the record ends.
 */
export function gridTimeAtIndex(
  timestamps: ArrayLike<number>,
  fractionalIndex: number,
): number {
  const len = timestamps.length;
  if (len === 0) return 0;
  if (fractionalIndex <= 0) return timestamps[0]!;
  if (fractionalIndex >= len - 1) return timestamps[len - 1]!;
  const lo = Math.floor(fractionalIndex);
  const hi = Math.min(lo + 1, len - 1);
  const a = timestamps[lo]!;
  const b = timestamps[hi]!;
  const frac = fractionalIndex - lo;
  return a + (b - a) * frac;
}

/**
 * The grid sample index carrying (nearest to) t = 0 — where File 2's
 * trigger sits at zero slip (both files align their trigger points at
 * grid time 0 by the #96 resampling).
 */
export function triggerAnchorIndex(timestamps: ArrayLike<number>): number {
  if (timestamps.length === 0) return 0;
  return findNearestSampleIndex(timestamps, 0);
}

/**
 * Grid time of File 2's trigger marker (T₂) after the current slip:
 * the anchor sample shifted by `slip` grid samples. This is the x the
 * T₂ glyph pins to.
 */
export function slippedTriggerTime(
  timestamps: ArrayLike<number>,
  slip: number,
): number {
  return gridTimeAtIndex(timestamps, triggerAnchorIndex(timestamps) + slip);
}

/**
 * The slip expressed as a signed duration on the grid (seconds).
 * In-record slips interpolate on the grid; slips beyond either record
 * end extrapolate with the boundary interval so readouts stay signed
 * (the glyph itself hides when out of view).
 */
export function slipSeconds(
  timestamps: ArrayLike<number>,
  slip: number,
): number {
  if (timestamps.length < 2 || slip === 0) return 0;
  const anchor = triggerAnchorIndex(timestamps);
  const anchorTime = timestamps[anchor]!;
  const idx = anchor + slip;
  if (idx >= 0 && idx <= timestamps.length - 1) {
    return gridTimeAtIndex(timestamps, idx) - anchorTime;
  }
  const next = Math.min(anchor + 1, timestamps.length - 1);
  const prev = Math.max(anchor - 1, 0);
  const interval =
    next !== anchor
      ? timestamps[next]! - anchorTime
      : anchorTime - timestamps[prev]!;
  return slip * interval;
}

/**
 * Align-at-Cursors delta (issue #97 AC2): the slip adjustment that
 * moves the File 2 feature currently under C2 exactly onto C1.
 *
 * With cursors at grid indices i₁/i₂ and current slip s, the feature
 * under C2 has File 2-native index i₂ − s; showing it at i₁ needs
 * slip s′ = s + (i₁ − i₂). The delta below is the (i₁ − i₂) part —
 * exact integer arithmetic, no pixel estimation.
 */
export function alignSlipDelta(c1Index: number, c2Index: number): number {
  return c1Index - c2Index;
}
