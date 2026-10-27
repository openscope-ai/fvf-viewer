/**
 * Timing measurements calculation core (Issue #279):
 * Computes automatic timing statistics on the selected channel:
 * - Period (T)
 * - Frequency (1 / T)
 * - Positive Pulse Width (+PW)
 * - Negative Pulse Width (-PW)
 * - Duty Cycle (+PW / Period * 100%)
 * - Rise Time (10% to 90%)
 * - Fall Time (90% to 10%)
 *
 * Gating semantics:
 * - Gated between cursors C1 and C2 when both cursors are active: [min(t_C1, t_C2), max(t_C1, t_C2)]
 * - Falls back to active viewport window [xMin, xMax] when either cursor is inactive.
 * - Zero server egress: 100% client-side in-browser calculation.
 */

import { findNearestSampleIndex } from "../cursors/cursorPlugin";
import { formatTime, formatFrequency } from "../cursors/siFormat";

export interface TimingStats {
  period: number | null;
  frequency: number | null;
  positivePulseWidth: number | null;
  negativePulseWidth: number | null;
  dutyCycle: number | null;
  riseTime: number | null;
  fallTime: number | null;
}

export const EMPTY_TIMING_STATS: TimingStats = {
  period: null,
  frequency: null,
  positivePulseWidth: null,
  negativePulseWidth: null,
  dutyCycle: null,
  riseTime: null,
  fallTime: null,
};

interface MidCrossing {
  time: number;
  type: "rising" | "falling";
  index: number;
}

/**
 * Finds index range for timing gate:
 * - If both C1 and C2 are active, gates between min(t_C1, t_C2) and max(t_C1, t_C2).
 * - Otherwise, gates to the visible viewport [xMin, xMax].
 */
export function resolveTimingGateRange(
  timestamps: ArrayLike<number>,
  c1Active: boolean,
  c2Active: boolean,
  c1Index: number,
  c2Index: number,
  xMin: number | null,
  xMax: number | null,
): { startIndex: number; endIndex: number; isCursorGated: boolean } {
  const len = timestamps.length;
  if (len === 0) {
    return { startIndex: 0, endIndex: -1, isCursorGated: false };
  }

  if (c1Active && c2Active) {
    const idx1 = Math.max(0, Math.min(c1Index, len - 1));
    const idx2 = Math.max(0, Math.min(c2Index, len - 1));
    const startIndex = Math.min(idx1, idx2);
    const endIndex = Math.max(idx1, idx2);
    return { startIndex, endIndex, isCursorGated: true };
  }

  const tStart = timestamps[0]!;
  const tEnd = timestamps[len - 1]!;

  if (xMax !== null && xMax < tStart) {
    return { startIndex: 0, endIndex: -1, isCursorGated: false };
  }
  if (xMin !== null && xMin > tEnd) {
    return { startIndex: len, endIndex: len - 1, isCursorGated: false };
  }

  const startIndex =
    xMin !== null ? findNearestSampleIndex(timestamps, xMin) : 0;
  const endIndex =
    xMax !== null ? findNearestSampleIndex(timestamps, xMax) : len - 1;

  return {
    startIndex: Math.max(0, startIndex),
    endIndex: Math.min(len - 1, Math.max(startIndex - 1, endIndex)),
    isCursorGated: false,
  };
}

/**
 * Computes automatic timing statistics over a slice [startIndex, endIndex]
 * of timestamps and channel data.
 */
export function computeTimingStats(
  timestamps: ArrayLike<number>,
  data: ArrayLike<number>,
  startIndex: number,
  endIndex: number,
  inverted: boolean = false,
): TimingStats {
  const start = Math.max(0, startIndex);
  const end = Math.min(data.length - 1, endIndex);
  if (end - start < 4) {
    return EMPTY_TIMING_STATS;
  }

  // 1. Collect finite samples and find extremes
  let vMin = Number.POSITIVE_INFINITY;
  let vMax = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;

  for (let i = start; i <= end; i++) {
    const raw = data[i]!;
    if (Number.isFinite(raw)) {
      const v = inverted ? -raw : raw;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
      finiteCount++;
    }
  }

  if (finiteCount < 5 || !Number.isFinite(vMin) || !Number.isFinite(vMax)) {
    return EMPTY_TIMING_STATS;
  }

  const vpp = vMax - vMin;
  if (vpp <= 1e-9) {
    // Constant DC signal or zero dynamic range
    return EMPTY_TIMING_STATS;
  }

  // Reference thresholds
  const vHigh = vMin + 0.9 * vpp;
  const vMid = vMin + 0.5 * vpp;
  const vLow = vMin + 0.1 * vpp;

  // Hysteresis band (2% of Vpp) around vMid to suppress noise chatter
  const hyst = 0.02 * vpp;
  const vMidHigh = vMid + hyst;
  const vMidLow = vMid - hyst;

  // 2. Identify mid-level crossings with hysteresis
  type DetectorState = "low" | "rising_pending" | "high" | "falling_pending";
  let state: DetectorState = "low";

  // Determine initial state from first finite sample
  for (let i = start; i <= end; i++) {
    const raw = data[i]!;
    if (Number.isFinite(raw)) {
      const v = inverted ? -raw : raw;
      if (v >= vMid) {
        state = "high";
      } else {
        state = "low";
      }
      break;
    }
  }

  const crossings: MidCrossing[] = [];
  let pendingCrossing: MidCrossing | null = null;

  for (let i = start; i < end; i++) {
    const r1 = data[i]!;
    const r2 = data[i + 1]!;
    const t1 = timestamps[i]!;
    const t2 = timestamps[i + 1]!;

    if (!Number.isFinite(r1) || !Number.isFinite(r2)) {
      continue;
    }

    const v1 = inverted ? -r1 : r1;
    const v2 = inverted ? -r2 : r2;

    if (state === "low") {
      if (v1 <= vMid && v2 > vMid) {
        const frac = (vMid - v1) / (v2 - v1);
        const tCross = t1 + Math.max(0, Math.min(1, frac)) * (t2 - t1);
        pendingCrossing = { time: tCross, type: "rising", index: i };
        if (v2 >= vMidHigh) {
          crossings.push(pendingCrossing);
          state = "high";
          pendingCrossing = null;
        } else {
          state = "rising_pending";
        }
      }
    } else if (state === "rising_pending") {
      if (v2 >= vMidHigh) {
        if (pendingCrossing) {
          crossings.push(pendingCrossing);
          pendingCrossing = null;
        }
        state = "high";
      } else if (v2 <= vMidLow) {
        // False trigger (noise), discard
        pendingCrossing = null;
        state = "low";
      }
    } else if (state === "high") {
      if (v1 >= vMid && v2 < vMid) {
        const frac = (vMid - v1) / (v2 - v1);
        const tCross = t1 + Math.max(0, Math.min(1, frac)) * (t2 - t1);
        pendingCrossing = { time: tCross, type: "falling", index: i };
        if (v2 <= vMidLow) {
          crossings.push(pendingCrossing);
          state = "low";
          pendingCrossing = null;
        } else {
          state = "falling_pending";
        }
      }
    } else if (state === "falling_pending") {
      if (v2 <= vMidLow) {
        if (pendingCrossing) {
          crossings.push(pendingCrossing);
          pendingCrossing = null;
        }
        state = "low";
      } else if (v2 >= vMidHigh) {
        // False trigger (noise), discard
        pendingCrossing = null;
        state = "high";
      }
    }
  }

  // 3. Period and Frequency with periodicity consistency check (AC4)
  const risingTimes: number[] = [];
  const fallingTimes: number[] = [];
  for (const c of crossings) {
    if (c.type === "rising") risingTimes.push(c.time);
    else fallingTimes.push(c.time);
  }

  let period: number | null = null;
  if (risingTimes.length >= 2) {
    const intervals: number[] = [];
    for (let i = 0; i < risingTimes.length - 1; i++) {
      intervals.push(risingTimes[i + 1]! - risingTimes[i]!);
    }
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    // Check periodicity: all intervals must be within 20% of the mean
    const isPeriodic = intervals.every((dt) => Math.abs(dt - avg) / avg <= 0.2);
    if (isPeriodic && avg > 0 && Number.isFinite(avg)) {
      period = avg;
    }
  } else if (fallingTimes.length >= 2) {
    const intervals: number[] = [];
    for (let i = 0; i < fallingTimes.length - 1; i++) {
      intervals.push(fallingTimes[i + 1]! - fallingTimes[i]!);
    }
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const isPeriodic = intervals.every((dt) => Math.abs(dt - avg) / avg <= 0.2);
    if (isPeriodic && avg > 0 && Number.isFinite(avg)) {
      period = avg;
    }
  }

  // AC4: If signal is aperiodic or has insufficient cycles (< 2 same-direction edges),
  // graceful null applies to all cyclic timing measurements.
  if (period === null || period <= 0 || !Number.isFinite(period)) {
    return EMPTY_TIMING_STATS;
  }

  const frequency = 1 / period;

  // 4. Positive and Negative Pulse Widths
  const positiveWidths: number[] = [];
  const negativeWidths: number[] = [];

  for (let i = 0; i < crossings.length - 1; i++) {
    const c1 = crossings[i]!;
    const c2 = crossings[i + 1]!;
    const dt = c2.time - c1.time;
    if (dt > 0) {
      if (c1.type === "rising" && c2.type === "falling") {
        positiveWidths.push(dt);
      } else if (c1.type === "falling" && c2.type === "rising") {
        negativeWidths.push(dt);
      }
    }
  }

  const positivePulseWidth =
    positiveWidths.length > 0
      ? positiveWidths.reduce((a, b) => a + b, 0) / positiveWidths.length
      : null;

  const negativePulseWidth =
    negativeWidths.length > 0
      ? negativeWidths.reduce((a, b) => a + b, 0) / negativeWidths.length
      : null;

  // 5. Duty Cycle
  let dutyCycle: number | null = null;
  if (positivePulseWidth !== null) {
    const rawDuty = (positivePulseWidth / period) * 100;
    dutyCycle = Math.max(0, Math.min(100, rawDuty));
  }

  // 6. Rise Time (10% -> 90%)
  const riseTimes: number[] = [];
  for (let k = 0; k < crossings.length; k++) {
    const c = crossings[k]!;
    if (c.type === "rising") {
      const prevLimit = k > 0 ? crossings[k - 1]!.index : start;
      const nextLimit =
        k < crossings.length - 1 ? crossings[k + 1]!.index : end;

      let t10: number | null = null;
      let t90: number | null = null;

      // Look back for vLow
      for (let j = c.index; j >= prevLimit; j--) {
        const r1 = data[j]!;
        const r2 = data[j + 1]!;
        if (Number.isFinite(r1) && Number.isFinite(r2)) {
          const v = inverted ? -r1 : r1;
          const vNext = inverted ? -r2 : r2;
          if (v <= vLow && vNext >= vLow && vNext > v) {
            const frac = (vLow - v) / (vNext - v);
            t10 =
              timestamps[j]! +
              Math.max(0, Math.min(1, frac)) *
                (timestamps[j + 1]! - timestamps[j]!);
            break;
          }
        }
      }

      // Look forward for vHigh
      for (let j = c.index; j <= nextLimit; j++) {
        const r1 = data[j]!;
        const r2 = data[j + 1]!;
        if (Number.isFinite(r1) && Number.isFinite(r2)) {
          const v = inverted ? -r1 : r1;
          const vNext = inverted ? -r2 : r2;
          if (v <= vHigh && vNext >= vHigh && vNext > v) {
            const frac = (vHigh - v) / (vNext - v);
            t90 =
              timestamps[j]! +
              Math.max(0, Math.min(1, frac)) *
                (timestamps[j + 1]! - timestamps[j]!);
            break;
          }
        }
      }

      if (t10 !== null && t90 !== null && t90 > t10) {
        riseTimes.push(t90 - t10);
      }
    }
  }

  const riseTime =
    riseTimes.length > 0
      ? riseTimes.reduce((a, b) => a + b, 0) / riseTimes.length
      : null;

  // 7. Fall Time (90% -> 10%)
  const fallTimes: number[] = [];
  for (let k = 0; k < crossings.length; k++) {
    const c = crossings[k]!;
    if (c.type === "falling") {
      const prevLimit = k > 0 ? crossings[k - 1]!.index : start;
      const nextLimit =
        k < crossings.length - 1 ? crossings[k + 1]!.index : end;

      let t90: number | null = null;
      let t10: number | null = null;

      // Look back for vHigh
      for (let j = c.index; j >= prevLimit; j--) {
        const r1 = data[j]!;
        const r2 = data[j + 1]!;
        if (Number.isFinite(r1) && Number.isFinite(r2)) {
          const v = inverted ? -r1 : r1;
          const vNext = inverted ? -r2 : r2;
          if (v >= vHigh && vNext <= vHigh && v > vNext) {
            const frac = (vHigh - v) / (vNext - v);
            t90 =
              timestamps[j]! +
              Math.max(0, Math.min(1, frac)) *
                (timestamps[j + 1]! - timestamps[j]!);
            break;
          }
        }
      }

      // Look forward for vLow
      for (let j = c.index; j <= nextLimit; j++) {
        const r1 = data[j]!;
        const r2 = data[j + 1]!;
        if (Number.isFinite(r1) && Number.isFinite(r2)) {
          const v = inverted ? -r1 : r1;
          const vNext = inverted ? -r2 : r2;
          if (v >= vLow && vNext <= vLow && v > vNext) {
            const frac = (vLow - v) / (vNext - v);
            t10 =
              timestamps[j]! +
              Math.max(0, Math.min(1, frac)) *
                (timestamps[j + 1]! - timestamps[j]!);
            break;
          }
        }
      }

      if (t90 !== null && t10 !== null && t10 > t90) {
        fallTimes.push(t10 - t90);
      }
    }
  }

  const fallTime =
    fallTimes.length > 0
      ? fallTimes.reduce((a, b) => a + b, 0) / fallTimes.length
      : null;

  return {
    period,
    frequency,
    positivePulseWidth,
    negativePulseWidth,
    dutyCycle,
    riseTime,
    fallTime,
  };
}

/** Formats a duration in seconds using SI units or returns '--'. */
export function formatTimingDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0)
    return "--";
  return formatTime(seconds);
}

/** Formats a frequency in Hertz using SI units or returns '--'. */
export function formatTimingFrequency(hz: number | null): string {
  if (hz === null || !Number.isFinite(hz) || hz <= 0) return "--";
  return formatFrequency(hz);
}

/** Formats a duty cycle percentage or returns '--'. */
export function formatTimingDutyCycle(duty: number | null): string {
  if (duty === null || !Number.isFinite(duty) || duty < 0) return "--";
  return `${duty.toFixed(1)} %`;
}
