/**
 * Feature search algorithms for oscilloscope waveform navigation (Issue #288).
 * Pure client-side mathematical analysis of sampled waveform vectors:
 * - Rising / Falling edge transitions with hysteresis thresholding
 * - Local peaks and valleys
 * - Saturated / overload samples (NaN / infinite values)
 */

export type FeatureType =
  "rising" | "falling" | "peak" | "valley" | "saturation";

export interface FeatureSearchResult {
  index: number;
  timestamp: number;
  value: number;
}

/**
 * Finds the next or previous feature index on the given samples vector.
 *
 * @param timestamps Array of monotonically increasing timestamps.
 * @param samples Array of signal sample values (may contain NaN for saturated samples).
 * @param startIndex Starting sample index to search from (exclusive).
 * @param direction "next" (forward in time) or "prev" (backward in time).
 * @param featureType Type of feature to find.
 * @returns Found feature details, or null if no further feature exists.
 */
export function findFeature(
  timestamps: ArrayLike<number>,
  samples: ArrayLike<number>,
  startIndex: number,
  direction: "next" | "prev",
  featureType: FeatureType,
): FeatureSearchResult | null {
  const len = samples.length;
  if (len === 0 || timestamps.length !== len) return null;

  // Clamped search bounds [0, len - 1]
  const clampedStart = Math.max(0, Math.min(len - 1, startIndex));

  if (featureType === "saturation") {
    return findSaturation(timestamps, samples, clampedStart, direction);
  }

  // Calculate global min/max over finite samples for threshold/hysteresis
  let vMin = Infinity;
  let vMax = -Infinity;
  for (let i = 0; i < len; i++) {
    const v = samples[i]!;
    if (Number.isFinite(v)) {
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
  }

  if (!Number.isFinite(vMin) || !Number.isFinite(vMax) || vMax <= vMin) {
    // All samples are NaN or completely flat signal
    return null;
  }

  if (featureType === "rising" || featureType === "falling") {
    return findEdge(
      timestamps,
      samples,
      clampedStart,
      direction,
      featureType,
      vMin,
      vMax,
    );
  }

  if (featureType === "peak" || featureType === "valley") {
    return findExtremum(
      timestamps,
      samples,
      clampedStart,
      direction,
      featureType,
      vMin,
      vMax,
    );
  }

  return null;
}

function findSaturation(
  timestamps: ArrayLike<number>,
  samples: ArrayLike<number>,
  start: number,
  direction: "next" | "prev",
): FeatureSearchResult | null {
  const len = samples.length;
  const step = direction === "next" ? 1 : -1;
  let i = start + step;

  while (i >= 0 && i < len) {
    const val = samples[i]!;
    if (!Number.isFinite(val)) {
      return {
        index: i,
        timestamp: timestamps[i]!,
        value: val,
      };
    }
    i += step;
  }
  return null;
}

function findEdge(
  timestamps: ArrayLike<number>,
  samples: ArrayLike<number>,
  start: number,
  direction: "next" | "prev",
  edgeType: "rising" | "falling",
  vMin: number,
  vMax: number,
): FeatureSearchResult | null {
  const len = samples.length;
  const vMid = (vMin + vMax) / 2;
  const span = vMax - vMin;
  const hysteresis = Math.max(span * 0.05, 1e-9);
  const lowThresh = vMid - hysteresis;
  const highThresh = vMid + hysteresis;

  const isForward = direction === "next";

  if (isForward) {
    // Looking forward from start + 1 to len - 1
    // Find the state of the last valid sample at or before start
    let prevVal: number | null = null;
    for (let k = start; k >= 0; k--) {
      const v = samples[k]!;
      if (Number.isFinite(v)) {
        prevVal = v;
        break;
      }
    }

    for (let i = start + 1; i < len; i++) {
      const val = samples[i]!;
      if (!Number.isFinite(val)) continue;

      if (prevVal !== null) {
        if (edgeType === "rising") {
          // Transition from below vMid to >= vMid
          if (prevVal < vMid && val >= vMid && val >= lowThresh) {
            return { index: i, timestamp: timestamps[i]!, value: val };
          }
        } else {
          // Falling: transition from above vMid to <= vMid
          if (prevVal > vMid && val <= vMid && val <= highThresh) {
            return { index: i, timestamp: timestamps[i]!, value: val };
          }
        }
      }
      prevVal = val;
    }
  } else {
    // Looking backward from start - 1 down to 0
    let nextVal: number | null = null;
    let nextIdx: number | null = null;
    for (let k = start; k < len; k++) {
      const v = samples[k]!;
      if (Number.isFinite(v)) {
        nextVal = v;
        nextIdx = k;
        break;
      }
    }

    for (let i = start - 1; i >= 0; i--) {
      const val = samples[i]!;
      if (!Number.isFinite(val)) continue;

      if (nextVal !== null && nextIdx !== null) {
        if (edgeType === "rising") {
          // In reverse traversal, moving backwards to an earlier rising edge:
          // A rising edge at nextIdx has val (at i) < vMid and nextVal (at nextIdx) >= vMid.
          if (val < vMid && nextVal >= vMid) {
            // Only accept if nextIdx is strictly before start
            if (nextIdx < start) {
              return {
                index: nextIdx,
                timestamp: timestamps[nextIdx]!,
                value: samples[nextIdx]!,
              };
            }
          }
        } else {
          // Falling edge: val > vMid and nextVal <= vMid
          if (val > vMid && nextVal <= vMid) {
            if (nextIdx < start) {
              return {
                index: nextIdx,
                timestamp: timestamps[nextIdx]!,
                value: samples[nextIdx]!,
              };
            }
          }
        }
      }
      nextVal = val;
      nextIdx = i;
    }
  }

  return null;
}

function findExtremum(
  timestamps: ArrayLike<number>,
  samples: ArrayLike<number>,
  start: number,
  direction: "next" | "prev",
  type: "peak" | "valley",
  vMin: number,
  vMax: number,
): FeatureSearchResult | null {
  const len = samples.length;
  const span = vMax - vMin;
  const step = direction === "next" ? 1 : -1;

  let i = start + step;
  while (i > 0 && i < len - 1) {
    const val = samples[i]!;
    if (Number.isFinite(val)) {
      // Find previous finite sample
      let prev = NaN;
      for (let p = i - 1; p >= 0; p--) {
        if (Number.isFinite(samples[p]!)) {
          prev = samples[p]!;
          break;
        }
      }
      // Find next finite sample
      let next = NaN;
      for (let n = i + 1; n < len; n++) {
        if (Number.isFinite(samples[n]!)) {
          next = samples[n]!;
          break;
        }
      }

      if (Number.isFinite(prev) && Number.isFinite(next)) {
        if (type === "peak") {
          if (val >= prev && val > next && val >= vMin + span * 0.2) {
            return { index: i, timestamp: timestamps[i]!, value: val };
          }
        } else {
          // valley
          if (val <= prev && val < next && val <= vMax - span * 0.2) {
            return { index: i, timestamp: timestamps[i]!, value: val };
          }
        }
      }
    }
    i += step;
  }

  return null;
}
