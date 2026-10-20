/**
 * Feature search algorithms for oscilloscope waveform navigation (Issue #288, #314).
 * Pure client-side mathematical analysis of sampled waveform vectors:
 * - Rising / Falling edge transitions with hysteresis thresholding
 * - Local peaks and valleys with deterministic O(N) neighbor tracking across NaNs
 * - Saturated / overload samples (NaN / infinite values)
 * - Memoized amplitude bounds and directional lookahead
 */

export type FeatureType =
  "rising" | "falling" | "peak" | "valley" | "saturation";

export interface FeatureSearchResult {
  index: number;
  timestamp: number;
  value: number;
}

export interface LookaheadResult {
  prevResult: FeatureSearchResult | null;
  nextResult: FeatureSearchResult | null;
}

export interface ChannelBounds {
  vMin: number;
  vMax: number;
}

const boundsCache = new WeakMap<object, ChannelBounds | null>();
const finiteIndicesCache = new WeakMap<object, Int32Array>();
let lookaheadCache = new WeakMap<object, Map<string, LookaheadResult>>();
const fallbackLookaheadCache = new Map<string, LookaheadResult>();
const MAX_LOOKAHEAD_CACHE_PER_CAPTURE = 200;

export function clearFeatureSearchCache(): void {
  lookaheadCache = new WeakMap<object, Map<string, LookaheadResult>>();
  fallbackLookaheadCache.clear();
}

/**
 * Precomputes or retrieves memoized global min/max over finite samples for threshold/hysteresis.
 */
export function getChannelBounds(
  samples: ArrayLike<number>,
): ChannelBounds | null {
  const isObj = typeof samples === "object" && samples !== null;
  if (isObj && boundsCache.has(samples)) {
    return boundsCache.get(samples)!;
  }

  const len = samples.length;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (let i = 0; i < len; i++) {
    const v = samples[i]!;
    if (Number.isFinite(v)) {
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
  }

  const result: ChannelBounds | null =
    !Number.isFinite(vMin) || !Number.isFinite(vMax) || vMax <= vMin
      ? null
      : { vMin, vMax };

  if (isObj) {
    boundsCache.set(samples, result);
  }
  return result;
}

function getFiniteIndices(samples: ArrayLike<number>): Int32Array {
  const isObj = typeof samples === "object" && samples !== null;
  if (isObj && finiteIndicesCache.has(samples)) {
    return finiteIndicesCache.get(samples)!;
  }

  const len = samples.length;
  const temp: number[] = [];
  for (let idx = 0; idx < len; idx++) {
    if (Number.isFinite(samples[idx]!)) {
      temp.push(idx);
    }
  }
  const result = new Int32Array(temp);
  if (isObj) {
    finiteIndicesCache.set(samples, result);
  }
  return result;
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

  const bounds = getChannelBounds(samples);
  if (!bounds) {
    // All samples are NaN or completely flat signal
    return null;
  }
  const { vMin, vMax } = bounds;

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

/**
 * Lookahead helper memoizing both directions (prevResult and nextResult) for
 * button boundary disabling and instant click navigation without redundant passes.
 */
export function getLookahead(
  timestamps: ArrayLike<number> | undefined,
  samples: ArrayLike<number> | undefined,
  captureKey: unknown,
  channelName: string,
  featureType: FeatureType,
  startIndex: number,
  channelVisible: boolean,
): LookaheadResult {
  if (
    !channelVisible ||
    !timestamps ||
    !samples ||
    timestamps.length === 0 ||
    samples.length === 0
  ) {
    return { prevResult: null, nextResult: null };
  }

  const isObjectKey = typeof captureKey === "object" && captureKey !== null;
  const rootKey: object | null = isObjectKey
    ? (captureKey as object)
    : typeof samples === "object" && samples !== null
      ? (samples as object)
      : null;

  const subKey = `${channelName}:${featureType}:${startIndex}:${channelVisible}`;

  if (rootKey) {
    const captureMap = lookaheadCache.get(rootKey);
    if (captureMap && captureMap.has(subKey)) {
      return captureMap.get(subKey)!;
    }
  } else {
    const fallbackKey = `${String(captureKey)}:${subKey}`;
    if (fallbackLookaheadCache.has(fallbackKey)) {
      return fallbackLookaheadCache.get(fallbackKey)!;
    }
  }

  const prevResult = findFeature(
    timestamps,
    samples,
    startIndex,
    "prev",
    featureType,
  );
  const nextResult = findFeature(
    timestamps,
    samples,
    startIndex,
    "next",
    featureType,
  );
  const result: LookaheadResult = { prevResult, nextResult };

  if (rootKey) {
    let captureMap = lookaheadCache.get(rootKey);
    if (!captureMap) {
      captureMap = new Map<string, LookaheadResult>();
      lookaheadCache.set(rootKey, captureMap);
    }
    if (captureMap.size >= MAX_LOOKAHEAD_CACHE_PER_CAPTURE) {
      const firstKey = captureMap.keys().next().value;
      if (firstKey !== undefined) {
        captureMap.delete(firstKey);
      }
    }
    captureMap.set(subKey, result);
  } else {
    const fallbackKey = `${String(captureKey)}:${subKey}`;
    if (fallbackLookaheadCache.size >= MAX_LOOKAHEAD_CACHE_PER_CAPTURE) {
      const firstKey = fallbackLookaheadCache.keys().next().value;
      if (firstKey !== undefined) {
        fallbackLookaheadCache.delete(firstKey);
      }
    }
    fallbackLookaheadCache.set(fallbackKey, result);
  }
  return result;
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
          if (prevVal < vMid && val >= vMid && val >= lowThresh) {
            return { index: i, timestamp: timestamps[i]!, value: val };
          }
        } else {
          if (prevVal > vMid && val <= vMid && val <= highThresh) {
            return { index: i, timestamp: timestamps[i]!, value: val };
          }
        }
      }
      prevVal = val;
    }
  } else {
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
          if (val < vMid && nextVal >= vMid) {
            if (nextIdx < start) {
              return {
                index: nextIdx,
                timestamp: timestamps[nextIdx]!,
                value: samples[nextIdx]!,
              };
            }
          }
        } else {
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

/**
 * Semantic-preserving O(N) extremum search eliminating O(N^2) inner neighbor loops across NaNs.
 * - Plateau rule: val >= prev && val > next for peaks; val <= prev && val < next for valleys.
 * - Nearest finite neighbor lookup across arbitrary NaN runs in O(1) via tracked finite samples.
 * - Prominence threshold: val >= vMin + span * 0.2 for peaks; val <= vMax - span * 0.2 for valleys.
 */
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
  if (len < 3) return null;
  const span = vMax - vMin;

  const finiteIndices = getFiniteIndices(samples);
  const M = finiteIndices.length;
  if (M < 3) return null;

  if (direction === "next") {
    // Find first j where finiteIndices[j] > start
    let j = 0;
    while (j < M && finiteIndices[j]! <= start) j++;
    for (; j < M - 1; j++) {
      if (j < 1) continue;
      const i = finiteIndices[j]!;
      if (i <= 0) continue;
      if (i >= len - 1) break;
      const val = samples[i]!;
      const prev = samples[finiteIndices[j - 1]!]!;
      const next = samples[finiteIndices[j + 1]!]!;
      if (type === "peak") {
        if (val >= prev && val > next && val >= vMin + span * 0.2) {
          return { index: i, timestamp: timestamps[i]!, value: val };
        }
      } else {
        if (val <= prev && val < next && val <= vMax - span * 0.2) {
          return { index: i, timestamp: timestamps[i]!, value: val };
        }
      }
    }
  } else {
    // direction === "prev"
    // Find last j where finiteIndices[j] < start
    let j = M - 1;
    while (j >= 0 && finiteIndices[j]! >= start) j--;
    for (; j >= 1; j--) {
      if (j > M - 2) continue;
      const i = finiteIndices[j]!;
      if (i >= len - 1) continue;
      if (i <= 0) break;
      const val = samples[i]!;
      const prev = samples[finiteIndices[j - 1]!]!;
      const next = samples[finiteIndices[j + 1]!]!;
      if (type === "peak") {
        if (val >= prev && val > next && val >= vMin + span * 0.2) {
          return { index: i, timestamp: timestamps[i]!, value: val };
        }
      } else {
        if (val <= prev && val < next && val <= vMax - span * 0.2) {
          return { index: i, timestamp: timestamps[i]!, value: val };
        }
      }
    }
  }

  return null;
}
