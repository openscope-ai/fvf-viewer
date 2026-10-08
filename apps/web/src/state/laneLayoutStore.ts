/**
 * Stack-view lane layout store (issue #251): per-lane relative weights
 * for the resizable Stack view, persisted per capture identity
 * (fileName::timestamp14 — the same keying as the per-file channel
 * names) so re-opening the same .fvf restores its proportions while a
 * different file starts from equal lanes.
 *
 * Weights are positive relative units; lane height fractions are always
 * weight/Σweights over the VISIBLE lanes, so visibility changes
 * renormalize automatically: surviving channels keep their relative
 * weights, newly visible channels join with their stored weight (or the
 * default 1), and repeated toggles never drift (idempotent by
 * construction — nothing is rewritten on normalization).
 */

import { create } from "zustand";
import {
  CHANNEL_DISPLAY_KEYS,
  type ChannelKey,
} from "../components/canvas/channelDisplay";

export const LANE_WEIGHTS_STORAGE_KEY = "fvf.lane-weights";

/** Minimum lane height as a fraction of the plot (enforced by the drag, never stored). */
export const LANE_MIN_FRACTION = 0.1;

/** Default relative weight of a lane without a stored value. */
export const DEFAULT_LANE_WEIGHT = 1;

/** Storage shape: fileKey -> { channelKey -> positive relative weight }. */
export type StoredLaneWeights = Record<
  string,
  Partial<Record<ChannelKey, number>>
>;

function isChannelKey(value: unknown): value is ChannelKey {
  return (CHANNEL_DISPLAY_KEYS as readonly string[]).includes(value as string);
}

function readStoredWeights(): StoredLaneWeights {
  try {
    const raw = window.localStorage.getItem(LANE_WEIGHTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const cleaned: StoredLaneWeights = {};
    for (const [fileKey, weights] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (
        typeof fileKey !== "string" ||
        typeof weights !== "object" ||
        weights === null
      )
        continue;
      const fileWeights: Partial<Record<ChannelKey, number>> = {};
      for (const [key, value] of Object.entries(
        weights as Record<string, unknown>,
      )) {
        if (
          isChannelKey(key) &&
          typeof value === "number" &&
          Number.isFinite(value) &&
          value > 0
        ) {
          fileWeights[key] = value;
        }
      }
      cleaned[fileKey] = fileWeights;
    }
    return cleaned;
  } catch {
    return {};
  }
}

function writeStoredWeights(weights: StoredLaneWeights): void {
  try {
    if (Object.keys(weights).length === 0) {
      window.localStorage.removeItem(LANE_WEIGHTS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        LANE_WEIGHTS_STORAGE_KEY,
        JSON.stringify(weights),
      );
    }
  } catch {
    // Best-effort persistence (private mode, disabled storage): the
    // in-session weights still apply.
  }
}

export interface LaneLayoutState {
  /** Capture identity of the active file (fileName::timestamp14). */
  fileKey: string | null;
  /** Active file's lane weights: channel key -> positive relative weight. */
  weights: Partial<Record<ChannelKey, number>>;
  /** Swaps the active file (restoring its stored weights, or equal lanes). */
  setFileKey: (fileKey: string | null) => void;
  /** Commits a batch of weight edits (a drag frame or a renormalization). */
  setWeights: (patch: Partial<Record<ChannelKey, number>>) => void;
  /** Drops the given keys' weights (comparison teardown drops Ref lanes). */
  dropKeys: (keys: ChannelKey[]) => void;
  /** Double-click equalize: back to default weights everywhere. */
  equalize: () => void;
}

export function createLaneLayoutStore() {
  return create<LaneLayoutState>((set, get) => {
    const persistActive = () => {
      const { fileKey, weights } = get();
      if (!fileKey) return;
      const stored = readStoredWeights();
      if (Object.keys(weights).length === 0) {
        delete stored[fileKey];
      } else {
        stored[fileKey] = weights;
      }
      writeStoredWeights(stored);
    };
    return {
      fileKey: null,
      weights: {},
      setFileKey: (fileKey) =>
        set(() => {
          if (!fileKey) {
            return { fileKey: null, weights: {} };
          }
          const stored = readStoredWeights();
          return {
            fileKey,
            weights: { ...(stored[fileKey] ?? {}) },
          };
        }),
      setWeights: (patch) => {
        set((state) => {
          const weights: Partial<Record<ChannelKey, number>> = {
            ...state.weights,
          };
          for (const [key, value] of Object.entries(patch)) {
            if (
              typeof value === "number" &&
              Number.isFinite(value) &&
              value > 0
            ) {
              weights[key as ChannelKey] = value;
            }
          }
          return { weights };
        });
        persistActive();
      },
      dropKeys: (keys) => {
        set((state) => {
          if (!keys.some((key) => key in state.weights)) return state;
          const weights = { ...state.weights };
          for (const key of keys) delete weights[key];
          return { weights };
        });
        persistActive();
      },
      equalize: () => {
        set(() => ({ weights: {} }));
        persistActive();
      },
    };
  });
}

export const useLaneLayoutStore = createLaneLayoutStore();

/**
 * Per-key lane height fractions (summing to 1) for the visible lane
 * keys, from the active weights (missing keys default to 1; invalid
 * weights fall back to the default).
 */
export function laneFractions(
  keys: readonly string[],
  weights: Partial<Record<ChannelKey, number>>,
): number[] {
  const effective = keys.map((key) => {
    const weight = weights[key as ChannelKey];
    return typeof weight === "number" && Number.isFinite(weight) && weight > 0
      ? weight
      : DEFAULT_LANE_WEIGHT;
  });
  const total = effective.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return keys.map(() => 1 / Math.max(keys.length, 1));
  return effective.map((weight) => weight / total);
}
