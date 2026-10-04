/**
 * Zustand cursor store (Issue #14): tracks state for dual measurement cursors
 * C1 (#E040FB) and C2 (#B0B0B0).
 *
 * Cursors snap strictly to discrete sample indices [0, N-1].
 * Defaults: C1 at 25%, C2 at 75% of total capture sample length.
 * When a capture is ingested or replaced, cursors reset to deactivated (off)
 * and positions re-initialize to 25% and 75%.
 */

import { create } from "zustand";
import { useCursorDisplayStore } from "./cursorDisplayStore";

export type CursorId = "C1" | "C2";

export interface CursorStoreState {
  c1Active: boolean;
  c2Active: boolean;
  selectedCursor: CursorId | null;
  c1SampleIndex: number;
  c2SampleIndex: number;

  toggleCursor: (id: CursorId, totalSamples?: number) => void;
  setCursorActive: (
    id: CursorId,
    active: boolean,
    totalSamples?: number,
  ) => void;
  selectCursor: (id: CursorId | null) => void;
  setCursorSample: (id: CursorId, index: number, totalSamples: number) => void;
  stepCursor: (id: CursorId, delta: number, totalSamples: number) => void;
  /**
   * Sets both cursor positions atomically (issue #225): the pair-slip
   * composition of locked Δt never fires here, so an alignment action
   * (#97 Align-at-Cursors) places both cursors exactly and the lock then
   * preserves the newly aligned separation on subsequent moves.
   */
  setCursorPositions: (
    c1Index: number,
    c2Index: number,
    totalSamples: number,
  ) => void;
  initForCapture: (totalSamples: number) => void;
  reset: () => void;
}

function clampIndex(index: number, totalSamples: number): number {
  return Math.max(0, Math.min(Math.round(index), totalSamples - 1));
}

export function computeDefaultSampleIndices(totalSamples: number): {
  c1Index: number;
  c2Index: number;
} {
  if (totalSamples <= 1) {
    return { c1Index: 0, c2Index: 0 };
  }
  const maxIdx = totalSamples - 1;
  return {
    c1Index: Math.floor(0.25 * maxIdx),
    c2Index: Math.floor(0.75 * maxIdx),
  };
}

export const useCursorStore = create<CursorStoreState>((set) => ({
  c1Active: false,
  c2Active: false,
  selectedCursor: null,
  c1SampleIndex: 0,
  c2SampleIndex: 0,

  toggleCursor: (id, totalSamples = 0) =>
    set((state) => {
      const activeKey = id === "C1" ? "c1Active" : "c2Active";
      const nowActive = !state[activeKey];
      const otherId: CursorId = id === "C1" ? "C2" : "C1";
      const otherActive = id === "C1" ? state.c2Active : state.c1Active;

      // Handle selection change
      let newSelected = state.selectedCursor;
      if (nowActive) {
        newSelected = id;
      } else if (state.selectedCursor === id) {
        newSelected = otherActive ? otherId : null;
      }

      // If activating and indices are 0 while totalSamples > 0, ensure 25%/75% defaults
      const defaults = computeDefaultSampleIndices(totalSamples);
      const c1Index =
        id === "C1" &&
        nowActive &&
        state.c1SampleIndex === 0 &&
        totalSamples > 1
          ? defaults.c1Index
          : state.c1SampleIndex;
      const c2Index =
        id === "C2" &&
        nowActive &&
        state.c2SampleIndex === 0 &&
        totalSamples > 1
          ? defaults.c2Index
          : state.c2SampleIndex;

      return {
        [activeKey]: nowActive,
        selectedCursor: newSelected,
        c1SampleIndex: c1Index,
        c2SampleIndex: c2Index,
      };
    }),

  setCursorActive: (id, active, totalSamples = 0) =>
    set((state) => {
      const activeKey = id === "C1" ? "c1Active" : "c2Active";
      if (state[activeKey] === active) return state;

      const otherId: CursorId = id === "C1" ? "C2" : "C1";
      const otherActive = id === "C1" ? state.c2Active : state.c1Active;

      let newSelected = state.selectedCursor;
      if (active) {
        newSelected = id;
      } else if (state.selectedCursor === id) {
        newSelected = otherActive ? otherId : null;
      }

      const defaults = computeDefaultSampleIndices(totalSamples);
      const c1Index =
        id === "C1" && active && state.c1SampleIndex === 0 && totalSamples > 1
          ? defaults.c1Index
          : state.c1SampleIndex;
      const c2Index =
        id === "C2" && active && state.c2SampleIndex === 0 && totalSamples > 1
          ? defaults.c2Index
          : state.c2SampleIndex;

      return {
        [activeKey]: active,
        selectedCursor: newSelected,
        c1SampleIndex: c1Index,
        c2SampleIndex: c2Index,
      };
    }),

  selectCursor: (id) =>
    set((state) => {
      if (id === null) return { selectedCursor: null };
      const isActive = id === "C1" ? state.c1Active : state.c2Active;
      return isActive ? { selectedCursor: id } : state;
    }),

  setCursorSample: (id, index, totalSamples) =>
    set((state) => {
      if (totalSamples <= 0) return state;
      const clamped = clampIndex(index, totalSamples);
      // Issue #225: while Δt is locked, moving one cursor slides the pair
      // by the same sample delta — the separation is preserved exactly,
      // including at the sample-range boundaries (the dragged cursor is
      // constrained to the window where the partner stays in range).
      if (useCursorDisplayStore.getState().deltaLocked) {
        const own = id === "C1" ? state.c1SampleIndex : state.c2SampleIndex;
        const rel =
          (id === "C1" ? state.c2SampleIndex : state.c1SampleIndex) - own;
        const lo = Math.max(0, -rel);
        const hi = Math.min(totalSamples - 1, totalSamples - 1 - rel);
        const x = Math.max(lo, Math.min(clamped, hi));
        return id === "C1"
          ? { c1SampleIndex: x, c2SampleIndex: x + rel }
          : { c1SampleIndex: x + rel, c2SampleIndex: x };
      }
      return id === "C1"
        ? { c1SampleIndex: clamped }
        : { c2SampleIndex: clamped };
    }),

  stepCursor: (id, delta, totalSamples) =>
    set((state) => {
      if (totalSamples <= 0) return state;
      const current = id === "C1" ? state.c1SampleIndex : state.c2SampleIndex;
      // Issue #225: keyboard/mousewheel stepping composes with the lock
      // exactly like a drag (equal sample deltas for both cursors).
      if (useCursorDisplayStore.getState().deltaLocked) {
        const rel =
          (id === "C1" ? state.c2SampleIndex : state.c1SampleIndex) - current;
        const lo = Math.max(0, -rel);
        const hi = Math.min(totalSamples - 1, totalSamples - 1 - rel);
        const x = Math.max(lo, Math.min(current + delta, hi));
        return id === "C1"
          ? { c1SampleIndex: x, c2SampleIndex: x + rel }
          : { c1SampleIndex: x + rel, c2SampleIndex: x };
      }
      const next = Math.max(0, Math.min(current + delta, totalSamples - 1));
      return id === "C1" ? { c1SampleIndex: next } : { c2SampleIndex: next };
    }),

  setCursorPositions: (c1Index, c2Index, totalSamples) =>
    set(() => {
      if (totalSamples <= 0) return {};
      return {
        c1SampleIndex: clampIndex(c1Index, totalSamples),
        c2SampleIndex: clampIndex(c2Index, totalSamples),
      };
    }),

  initForCapture: (totalSamples) =>
    set(() => {
      const { c1Index, c2Index } = computeDefaultSampleIndices(totalSamples);
      return {
        c1Active: false,
        c2Active: false,
        selectedCursor: null,
        c1SampleIndex: c1Index,
        c2SampleIndex: c2Index,
      };
    }),

  reset: () =>
    set({
      c1Active: false,
      c2Active: false,
      selectedCursor: null,
      c1SampleIndex: 0,
      c2SampleIndex: 0,
    }),
}));
