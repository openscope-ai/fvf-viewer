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
  initForCapture: (totalSamples: number) => void;
  reset: () => void;
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
      const clamped = Math.max(
        0,
        Math.min(Math.round(index), totalSamples - 1),
      );
      return id === "C1"
        ? { c1SampleIndex: clamped }
        : { c2SampleIndex: clamped };
    }),

  stepCursor: (id, delta, totalSamples) =>
    set((state) => {
      if (totalSamples <= 0) return state;
      const current = id === "C1" ? state.c1SampleIndex : state.c2SampleIndex;
      const next = Math.max(0, Math.min(current + delta, totalSamples - 1));
      return id === "C1" ? { c1SampleIndex: next } : { c2SampleIndex: next };
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
