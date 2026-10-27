/**
 * Running measurement statistics core (Issue #280):
 * Tracks online Count, Min, Max, Mean, and Sample Standard Deviation
 * for automatic measurements using Welford's numerically stable algorithm.
 *
 * Requirements:
 * - 100% client-side in-browser execution with zero server egress.
 * - Numerically stable single-pass update (Welford's algorithm).
 * - Finite number checking (filters NaN and Infinity).
 * - Reset/Clear action resets accumulator state.
 */

export interface MeasurementAccumulator {
  count: number;
  min: number;
  max: number;
  mean: number;
  m2: number;
  stdDev: number;
  current: number;
  unit: string;
}

/**
 * Updates or initializes a running statistic accumulator with a new sample value.
 * Non-finite values (NaN, Infinity, -Infinity) are ignored and do not mutate state.
 */
export function updateAccumulator(
  prev: MeasurementAccumulator | undefined,
  value: number,
  unit: string = "",
): MeasurementAccumulator {
  if (!Number.isFinite(value)) {
    return (
      prev ?? {
        count: 0,
        min: 0,
        max: 0,
        mean: 0,
        m2: 0,
        stdDev: 0,
        current: 0,
        unit,
      }
    );
  }

  if (!prev || prev.count === 0) {
    return {
      count: 1,
      min: value,
      max: value,
      mean: value,
      m2: 0,
      stdDev: 0,
      current: value,
      unit,
    };
  }

  const count = prev.count + 1;
  const delta = value - prev.mean;
  const mean = prev.mean + delta / count;
  const delta2 = value - mean;
  const m2 = prev.m2 + delta * delta2;
  const stdDev = count > 1 ? Math.sqrt(Math.max(0, m2 / (count - 1))) : 0;
  const min = Math.min(prev.min, value);
  const max = Math.max(prev.max, value);

  return {
    count,
    min,
    max,
    mean,
    m2,
    stdDev,
    current: value,
    unit: unit || prev.unit,
  };
}
