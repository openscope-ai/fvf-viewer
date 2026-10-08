/**
 * Channel display settings store (issue #224): per-channel display
 * transforms (Y-scale %, vertical offset, invert ±) persisted per key in
 * local storage next to the palette record, plus the Solo quick-knob
 * state. The offset here is the single source of truth #98's Ctrl+drag
 * and ground-marker double-click reset will write — one shared store, no
 * drift between the popover face and the canvas interactions.
 *
 * Solo: one click saves the current visibility set into the record and
 * shows only that channel; a second click (or capture
 * ingestion/replacement via `clearSolo`) restores the saved set.
 */

import { create } from "zustand";
import {
  CHANNEL_DISPLAY_KEYS,
  DEFAULT_OFFSET,
  DEFAULT_Y_SCALE_PERCENT,
  isDefaultConfig,
  isRefChannelKey,
  normalizeOffset,
  normalizeYScalePercent,
  type ChannelDisplayConfig,
  type ChannelDisplayConfigs,
  type ChannelKey,
} from "../components/canvas/channelDisplay";
import { useViewportStore, type ChannelTag } from "./viewportStore";
import { useReferenceStore } from "./referenceStore";

export const CHANNEL_DISPLAY_STORAGE_KEY = "fvf.channel-display";

/** Solo record: which channel is isolated + the visibility set to restore. */
export interface SoloState {
  key: ChannelKey;
  savedActive: ChannelTag[];
}

function isChannelKey(value: unknown): value is ChannelKey {
  return (CHANNEL_DISPLAY_KEYS as readonly string[]).includes(value as string);
}

/**
 * Hydrates the persisted per-key display records and solo state; invalid
 * entries drop silently (validated hydration, mirroring #204/#226).
 */
function readStored(): {
  keyConfigs: ChannelDisplayConfigs;
  solo: SoloState | null;
  stackMode: boolean;
} {
  try {
    const raw = window.localStorage.getItem(CHANNEL_DISPLAY_STORAGE_KEY);
    if (!raw) return { keyConfigs: {}, solo: null, stackMode: false };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { keyConfigs: {}, solo: null, stackMode: false };
    }
    const record = parsed as Record<string, unknown>;
    const keyConfigs: ChannelDisplayConfigs = {};
    const entries =
      typeof record.keyConfigs === "object" && record.keyConfigs !== null
        ? (record.keyConfigs as Record<string, unknown>)
        : {};
    for (const [key, value] of Object.entries(entries)) {
      if (!isChannelKey(key)) continue;
      if (typeof value !== "object" || value === null) continue;
      const config: ChannelDisplayConfig = {};
      const { yScalePercent, offset, inverted } = value as Record<
        string,
        unknown
      >;
      if (
        typeof yScalePercent === "number" &&
        Number.isFinite(yScalePercent) &&
        normalizeYScalePercent(yScalePercent) !== DEFAULT_Y_SCALE_PERCENT
      ) {
        config.yScalePercent = normalizeYScalePercent(yScalePercent);
      }
      if (
        typeof offset === "number" &&
        Number.isFinite(offset) &&
        normalizeOffset(offset) !== DEFAULT_OFFSET
      ) {
        config.offset = normalizeOffset(offset);
      }
      if (inverted === true) config.inverted = true;
      if (!isDefaultConfig(config)) keyConfigs[key] = config;
    }
    let solo: SoloState | null = null;
    if (typeof record.solo === "object" && record.solo !== null) {
      const rawSolo = record.solo as Record<string, unknown>;
      const savedActiveRaw: unknown = rawSolo.savedActive;
      if (isChannelKey(rawSolo.key) && Array.isArray(savedActiveRaw)) {
        const savedActive = savedActiveRaw.filter(
          (tag: unknown): tag is ChannelTag => typeof tag === "string",
        );
        solo = { key: rawSolo.key, savedActive };
      }
    }
    return { keyConfigs, solo, stackMode: record.stackMode === true };
  } catch {
    return { keyConfigs: {}, solo: null, stackMode: false };
  }
}

function writeStored(state: ChannelDisplayStoreState): void {
  try {
    if (
      Object.keys(state.keyConfigs).length === 0 &&
      !state.solo &&
      !state.stackMode
    ) {
      window.localStorage.removeItem(CHANNEL_DISPLAY_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        CHANNEL_DISPLAY_STORAGE_KEY,
        JSON.stringify({
          keyConfigs: state.keyConfigs,
          solo: state.solo,
          stackMode: state.stackMode,
        }),
      );
    }
  } catch {
    // Best-effort persistence (private mode, disabled storage): the
    // in-session settings still apply.
  }
}

export interface ChannelDisplayStoreState {
  /** Persisted per-channel display records — the source of truth. */
  keyConfigs: ChannelDisplayConfigs;
  /** Solo quick-knob state (null = no channel isolated). */
  solo: SoloState | null;
  /**
   * Issue #98 Quick-Stack: Overlay (false, default) or Stack (true) —
   * the canvas partitions visible channels into equal horizontal lanes
   * while stacked. Persisted with the display record (validated
   * hydration); the lane windowing itself is applied by the canvas at
   * toggle time, so pan/zoom keeps working on top of it.
   */
  stackMode: boolean;
  /** Toggles Overlay/Stack lane partitioning (issue #98). */
  setStackMode: (stacked: boolean) => void;
  /** Sets the Y-scale percent (clamped 10–500; 100 prunes the field). */
  setYScale: (key: ChannelKey, percent: number) => void;
  /** Sets the vertical offset (0 prunes the field). */
  setOffset: (key: ChannelKey, offset: number) => void;
  setInverted: (key: ChannelKey, inverted: boolean) => void;
  /**
   * Solo quick-knob: isolates the channel (saving the current visibility
   * set) or restores the saved set on the second click.
   */
  toggleSolo: (key: ChannelKey) => void;
  /**
   * Clears solo (restoring the saved visibility set); called on capture
   * ingestion/replacement.
   */
  clearSolo: () => void;
  /** Per-key ↺: scale 100% + offset 0 + not inverted. */
  resetKey: (key: ChannelKey) => void;
  /**
   * Issue #248 Reset View: clears every channel's display transform
   * (Y-scale %, vertical offset, invert) — visible or hidden, primary
   * or reference — while leaving Solo and the Stack/Overlay mode
   * untouched (they are view layout, not display transforms).
   */
  resetTransforms: () => void;
  reset: () => void;
}

/**
 * Issue #238: persistence is trailing-debounced (120 ms). Scrub drags
 * commit at pointer cadence (60–120 Hz); a synchronous JSON.stringify +
 * localStorage write per commit made the fields feel sluggish. The
 * debounce coalesces bursts; the final state always lands one window
 * after the last edit, and `flushPersist` forces it out (unload, tests).
 */
const PERSIST_DEBOUNCE_MS = 120;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Persists the current state immediately, cancelling any pending write. */
export function flushPersist(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  writeStored(useChannelDisplayStore.getState());
}

function schedulePersist(): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    writeStored(useChannelDisplayStore.getState());
  }, PERSIST_DEBOUNCE_MS);
}

if (
  typeof window !== "undefined" &&
  typeof window.addEventListener === "function"
) {
  // A closed tab must never lose the trailing edit waiting in the
  // debounce window.
  window.addEventListener("pagehide", flushPersist);
}

/** Applies a partial patch, scheduling the debounced persistence. */
function commit(
  set: (
    fn: (state: ChannelDisplayStoreState) => ChannelDisplayStoreState,
  ) => void,
  updater: (
    state: ChannelDisplayStoreState,
  ) => Partial<ChannelDisplayStoreState>,
): void {
  set((state) => {
    const next = { ...state, ...updater(state) };
    schedulePersist();
    return next;
  });
}

/** Drops one key's record field once back at its default. */
function patchKey(
  configs: ChannelDisplayConfigs,
  key: ChannelKey,
  patch: Partial<ChannelDisplayConfig>,
): ChannelDisplayConfigs {
  const merged: ChannelDisplayConfig = { ...(configs[key] ?? {}), ...patch };
  const next = { ...configs };
  if (isDefaultConfig(merged)) delete next[key];
  else next[key] = merged;
  return next;
}

export function createChannelDisplayStore() {
  const initial = readStored();

  return create<ChannelDisplayStoreState>((set) => ({
    keyConfigs: initial.keyConfigs,
    solo: initial.solo,
    stackMode: initial.stackMode,

    setStackMode: (stacked) => commit(set, () => ({ stackMode: stacked })),

    setYScale: (key, percent) =>
      commit(set, (state) => {
        const normalized = normalizeYScalePercent(percent);
        return {
          keyConfigs:
            normalized === DEFAULT_Y_SCALE_PERCENT
              ? patchKey(state.keyConfigs, key, { yScalePercent: undefined })
              : patchKey(state.keyConfigs, key, { yScalePercent: normalized }),
        };
      }),

    setOffset: (key, offset) =>
      commit(set, (state) => {
        const normalized = normalizeOffset(offset);
        return {
          keyConfigs:
            normalized === DEFAULT_OFFSET
              ? patchKey(state.keyConfigs, key, { offset: undefined })
              : patchKey(state.keyConfigs, key, { offset: normalized }),
        };
      }),

    setInverted: (key, inverted) =>
      commit(set, (state) => ({
        keyConfigs: patchKey(state.keyConfigs, key, {
          inverted: inverted || undefined,
        }),
      })),

    toggleSolo: (key) =>
      commit(set, (state) => {
        const ref = isRefChannelKey(key);
        if (state.solo?.key === key) {
          // Second click: restore the saved visibility set (primary
          // channels in viewportStore, reference channels in the
          // reference store — issue #96 keeps the two slots separate).
          if (ref) {
            useReferenceStore
              .getState()
              .setRefActiveChannels(state.solo.savedActive);
          } else {
            useViewportStore
              .getState()
              .setActiveChannels(state.solo.savedActive);
          }
          return { solo: null };
        }
        const savedActive = ref
          ? [...useReferenceStore.getState().refActiveChannels]
          : [...useViewportStore.getState().activeChannels];
        if (ref) {
          useReferenceStore.getState().setRefActiveChannels([key]);
        } else {
          useViewportStore.getState().setActiveChannels([key]);
        }
        return { solo: { key, savedActive } };
      }),

    clearSolo: () =>
      commit(set, (state) => {
        if (!state.solo) return {};
        if (isRefChannelKey(state.solo.key)) {
          useReferenceStore
            .getState()
            .setRefActiveChannels(state.solo.savedActive);
        } else {
          useViewportStore.getState().setActiveChannels(state.solo.savedActive);
        }
        return { solo: null };
      }),

    resetKey: (key) =>
      commit(set, (state) => {
        if (!(key in state.keyConfigs)) return {};
        const next = { ...state.keyConfigs };
        delete next[key];
        return { keyConfigs: next };
      }),

    resetTransforms: () =>
      commit(set, (state) =>
        Object.keys(state.keyConfigs).length > 0 ? { keyConfigs: {} } : {},
      ),

    reset: () =>
      commit(set, () => ({ keyConfigs: {}, solo: null, stackMode: false })),
  }));
}

export const useChannelDisplayStore = createChannelDisplayStore();
