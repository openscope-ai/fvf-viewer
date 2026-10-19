/**
 * Zoom and pan viewport history store (issue #287).
 *
 * Maintains a client-side stack of previous zoom/pan/fit viewport states,
 * allowing navigation backwards and forwards across box-zooms, wheel-zooms,
 * drag-pans, and Reset View actions.
 *
 * Invariants:
 * - Purely client-side: no capture data or history is ever egressed (ADR 0006).
 * - Truncation: any new navigation action truncates forward history (as in browser navigation).
 * - Maximum depth: 50 states to prevent unbounded memory growth.
 * - Capture lifecycle: loading a new capture completely resets the history.
 */

import { create } from "zustand";
import type uPlot from "uplot";

export const MAX_ZOOM_HISTORY = 50;

export interface ViewportSnapshot {
  x: { min: number; max: number };
  y: Record<string, { min: number; max: number }>;
  preStack?: Record<string, { min: number; max: number }>;
}

export interface RestoreRequest {
  target: ViewportSnapshot;
  token: number;
}

export interface ZoomHistoryState {
  past: ViewportSnapshot[];
  current: ViewportSnapshot | null;
  future: ViewportSnapshot[];
  isNavigating: boolean;
  restoreRequest: RestoreRequest | null;

  canGoBack: boolean;
  canGoForward: boolean;

  push: (snapshot: ViewportSnapshot) => void;
  back: () => void;
  forward: () => void;
  goBack: () => void;
  goForward: () => void;
  reset: () => void;
  setIsNavigating: (isNavigating: boolean) => void;
}

export function snapshotsEqual(
  a: ViewportSnapshot | null,
  b: ViewportSnapshot,
): boolean {
  if (!a) return false;
  const eps = 1e-9;
  if (Math.abs(a.x.min - b.x.min) > eps || Math.abs(a.x.max - b.x.max) > eps) {
    return false;
  }
  const keysA = Object.keys(a.y);
  const keysB = Object.keys(b.y);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    const yA = a.y[k];
    const yB = b.y[k];
    if (!yA || !yB) return false;
    if (Math.abs(yA.min - yB.min) > eps || Math.abs(yA.max - yB.max) > eps) {
      return false;
    }
  }
  const psA = a.preStack;
  const psB = b.preStack;
  if (Boolean(psA) !== Boolean(psB)) return false;
  if (psA && psB) {
    const keysPsA = Object.keys(psA);
    const keysPsB = Object.keys(psB);
    if (keysPsA.length !== keysPsB.length) return false;
    for (const k of keysPsA) {
      const vA = psA[k];
      const vB = psB[k];
      if (!vA || !vB) return false;
      if (Math.abs(vA.min - vB.min) > eps || Math.abs(vA.max - vB.max) > eps) {
        return false;
      }
    }
  }
  return true;
}

export function createViewportSnapshot(
  u: uPlot,
  preStackMap?: Map<string, { min: number; max: number }>,
): ViewportSnapshot | null {
  if (!u.scales.x || u.scales.x.min == null || u.scales.x.max == null) {
    return null;
  }
  const x = { min: u.scales.x.min, max: u.scales.x.max };
  const y: Record<string, { min: number; max: number }> = {};
  for (const [key, scale] of Object.entries(u.scales)) {
    if (key !== "x" && scale && scale.min != null && scale.max != null) {
      y[key] = { min: scale.min, max: scale.max };
    }
  }
  const preStack: Record<string, { min: number; max: number }> = {};
  if (preStackMap && preStackMap.size > 0) {
    for (const [k, v] of preStackMap.entries()) {
      preStack[k] = { ...v };
    }
  }
  return {
    x,
    y,
    ...(preStackMap && preStackMap.size > 0 ? { preStack } : {}),
  };
}

export function applyViewportSnapshot(
  u: uPlot,
  snapshot: ViewportSnapshot,
  preStackMap?: Map<string, { min: number; max: number }>,
): void {
  u.batch(() => {
    u.setScale("x", snapshot.x);
    for (const [key, bounds] of Object.entries(snapshot.y)) {
      if (u.scales[key]) {
        u.setScale(key, bounds);
      }
    }
  });
  if (preStackMap) {
    preStackMap.clear();
    if (snapshot.preStack) {
      for (const [k, v] of Object.entries(snapshot.preStack)) {
        preStackMap.set(k, { ...v });
      }
    }
  }
}

export const useZoomHistoryStore = create<ZoomHistoryState>((set, get) => ({
  past: [],
  current: null,
  future: [],
  isNavigating: false,
  restoreRequest: null,
  canGoBack: false,
  canGoForward: false,

  push: (snapshot: ViewportSnapshot) =>
    set((state) => {
      if (state.isNavigating) {
        return state;
      }
      if (snapshotsEqual(state.current, snapshot)) {
        return state;
      }
      const nextPast = state.current
        ? [...state.past, state.current]
        : state.past;
      if (nextPast.length > MAX_ZOOM_HISTORY) {
        nextPast.shift();
      }
      return {
        past: nextPast,
        current: snapshot,
        future: [],
        canGoBack: nextPast.length > 0,
        canGoForward: false,
      };
    }),

  back: () =>
    set((state) => {
      if (state.past.length === 0 || !state.current) {
        return state;
      }
      const nextPast = [...state.past];
      const previous = nextPast.pop()!;
      const nextFuture = [state.current, ...state.future];
      return {
        past: nextPast,
        current: previous,
        future: nextFuture,
        canGoBack: nextPast.length > 0,
        canGoForward: nextFuture.length > 0,
        isNavigating: true,
        restoreRequest: {
          target: previous,
          token: Date.now() + Math.random(),
        },
      };
    }),

  forward: () =>
    set((state) => {
      if (state.future.length === 0 || !state.current) {
        return state;
      }
      const nextFuture = [...state.future];
      const next = nextFuture.shift()!;
      const nextPast = [...state.past, state.current];
      if (nextPast.length > MAX_ZOOM_HISTORY) {
        nextPast.shift();
      }
      return {
        past: nextPast,
        current: next,
        future: nextFuture,
        canGoBack: nextPast.length > 0,
        canGoForward: nextFuture.length > 0,
        isNavigating: true,
        restoreRequest: {
          target: next,
          token: Date.now() + Math.random(),
        },
      };
    }),

  goBack: () => get().back(),
  goForward: () => get().forward(),

  reset: () =>
    set({
      past: [],
      current: null,
      future: [],
      isNavigating: false,
      restoreRequest: null,
      canGoBack: false,
      canGoForward: false,
    }),

  setIsNavigating: (isNavigating: boolean) => set({ isNavigating }),
}));
