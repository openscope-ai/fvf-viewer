import { beforeEach, describe, expect, it } from "vitest";
import type uPlot from "uplot";
import {
  applyViewportSnapshot,
  MAX_ZOOM_HISTORY,
  snapshotsEqual,
  useZoomHistoryStore,
  type ViewportSnapshot,
} from "./zoomHistoryStore";

function makeSnapshot(xMin: number, xMax: number, yVal = 1): ViewportSnapshot {
  return {
    x: { min: xMin, max: xMax },
    y: {
      A: { min: -yVal, max: yVal },
    },
  };
}

describe("zoomHistoryStore (unit)", () => {
  beforeEach(() => {
    useZoomHistoryStore.getState().reset();
  });

  it("initializes empty with back and forward disabled", () => {
    const state = useZoomHistoryStore.getState();
    expect(state.past).toEqual([]);
    expect(state.current).toBeNull();
    expect(state.future).toEqual([]);
    expect(state.canGoBack).toBe(false);
    expect(state.canGoForward).toBe(false);
  });

  it("first push establishes current snapshot without enabling back", () => {
    const s0 = makeSnapshot(0, 10);
    useZoomHistoryStore.getState().push(s0);

    const state = useZoomHistoryStore.getState();
    expect(state.past).toEqual([]);
    expect(state.current).toEqual(s0);
    expect(state.canGoBack).toBe(false);
    expect(state.canGoForward).toBe(false);
  });

  it("de-duplicates identical consecutive snapshots", () => {
    const s0 = makeSnapshot(0, 10);
    useZoomHistoryStore.getState().push(s0);
    useZoomHistoryStore.getState().push(makeSnapshot(0, 10));

    const state = useZoomHistoryStore.getState();
    expect(state.past).toEqual([]);
    expect(state.current).toEqual(s0);
  });

  it("pushes history entries and enables back navigation", () => {
    const s0 = makeSnapshot(0, 10);
    const s1 = makeSnapshot(2, 8);
    const s2 = makeSnapshot(3, 5);

    useZoomHistoryStore.getState().push(s0);
    useZoomHistoryStore.getState().push(s1);
    useZoomHistoryStore.getState().push(s2);

    const state = useZoomHistoryStore.getState();
    expect(state.past).toEqual([s0, s1]);
    expect(state.current).toEqual(s2);
    expect(state.canGoBack).toBe(true);
    expect(state.canGoForward).toBe(false);
  });

  it("AC2: back/forward navigates exact viewport states", () => {
    const s0 = makeSnapshot(0, 10);
    const s1 = makeSnapshot(2, 8);
    const s2 = makeSnapshot(3, 5);

    useZoomHistoryStore.getState().push(s0);
    useZoomHistoryStore.getState().push(s1);
    useZoomHistoryStore.getState().push(s2);

    // Step back to s1
    useZoomHistoryStore.getState().back();
    let state = useZoomHistoryStore.getState();
    expect(state.current).toEqual(s1);
    expect(state.past).toEqual([s0]);
    expect(state.future).toEqual([s2]);
    expect(state.canGoBack).toBe(true);
    expect(state.canGoForward).toBe(true);
    expect(state.restoreRequest?.target).toEqual(s1);

    // Step back to s0
    useZoomHistoryStore.getState().back();
    state = useZoomHistoryStore.getState();
    expect(state.current).toEqual(s0);
    expect(state.past).toEqual([]);
    expect(state.future).toEqual([s1, s2]);
    expect(state.canGoBack).toBe(false);
    expect(state.canGoForward).toBe(true);

    // Step forward back to s1
    useZoomHistoryStore.getState().forward();
    state = useZoomHistoryStore.getState();
    expect(state.current).toEqual(s1);
    expect(state.past).toEqual([s0]);
    expect(state.future).toEqual([s2]);
    expect(state.canGoBack).toBe(true);
    expect(state.canGoForward).toBe(true);

    // Step forward back to s2
    useZoomHistoryStore.getState().forward();
    state = useZoomHistoryStore.getState();
    expect(state.current).toEqual(s2);
    expect(state.past).toEqual([s0, s1]);
    expect(state.future).toEqual([]);
    expect(state.canGoBack).toBe(true);
    expect(state.canGoForward).toBe(false);
  });

  it("AC3: new navigation action truncates forward history", () => {
    const s0 = makeSnapshot(0, 10);
    const s1 = makeSnapshot(2, 8);
    const s2 = makeSnapshot(3, 5);

    useZoomHistoryStore.getState().push(s0);
    useZoomHistoryStore.getState().push(s1);
    useZoomHistoryStore.getState().push(s2);

    // Go back to s1
    useZoomHistoryStore.getState().back();
    expect(useZoomHistoryStore.getState().future).toEqual([s2]);

    // Turn off isNavigating to simulate next user action
    useZoomHistoryStore.getState().setIsNavigating(false);

    // New action s3
    const s3 = makeSnapshot(4, 6);
    useZoomHistoryStore.getState().push(s3);

    const state = useZoomHistoryStore.getState();
    expect(state.past).toEqual([s0, s1]);
    expect(state.current).toEqual(s3);
    // Future must be truncated!
    expect(state.future).toEqual([]);
    expect(state.canGoForward).toBe(false);
  });

  it("AC4: reset clears all history", () => {
    useZoomHistoryStore.getState().push(makeSnapshot(0, 10));
    useZoomHistoryStore.getState().push(makeSnapshot(2, 8));
    expect(useZoomHistoryStore.getState().canGoBack).toBe(true);

    useZoomHistoryStore.getState().reset();
    const state = useZoomHistoryStore.getState();
    expect(state.past).toEqual([]);
    expect(state.current).toBeNull();
    expect(state.future).toEqual([]);
    expect(state.canGoBack).toBe(false);
    expect(state.canGoForward).toBe(false);
  });

  it("caps maximum history depth at MAX_ZOOM_HISTORY (50)", () => {
    useZoomHistoryStore.getState().push(makeSnapshot(0, 1));
    for (let i = 1; i <= 60; i++) {
      useZoomHistoryStore.getState().push(makeSnapshot(i, i + 1));
    }

    const state = useZoomHistoryStore.getState();
    expect(state.past.length).toBe(MAX_ZOOM_HISTORY);
    expect(state.current).toEqual(makeSnapshot(60, 61));
  });

  it("snapshotsEqual compares x and per-channel y bounds within epsilon", () => {
    const s1 = makeSnapshot(0, 10, 5);
    const s2 = makeSnapshot(0, 10 + 1e-10, 5);
    const s3 = makeSnapshot(0, 10.01, 5);
    expect(snapshotsEqual(s1, s2)).toBe(true);
    expect(snapshotsEqual(s1, s3)).toBe(false);

    // preStack sensitivity
    const sWithPreStack1 = { ...s1, preStack: { A: { min: -5, max: 5 } } };
    const sWithPreStack2 = { ...s1, preStack: { A: { min: -5, max: 5 } } };
    const sWithPreStackDiff = { ...s1, preStack: { A: { min: -4, max: 4 } } };
    expect(snapshotsEqual(s1, sWithPreStack1)).toBe(false);
    expect(snapshotsEqual(sWithPreStack1, sWithPreStack2)).toBe(true);
    expect(snapshotsEqual(sWithPreStack1, sWithPreStackDiff)).toBe(false);
  });

  it("applyViewportSnapshot restores scales and clears/restores preStackMap", () => {
    const scales: Record<string, { min?: number; max?: number }> = {
      x: { min: 0, max: 100 },
      A: { min: -10, max: 10 },
    };
    const mockUplot = {
      scales,
      batch: (fn: () => void) => fn(),
      setScale: (k: string, bounds: { min: number; max: number }) => {
        scales[k] = { ...bounds };
      },
    } as unknown as uPlot;

    const preStackMap = new Map<string, { min: number; max: number }>([
      ["A", { min: -20, max: 20 }],
    ]);

    // Snapshot with preStack restores both scale and preStackMap
    const snap1 = {
      x: { min: 5, max: 25 },
      y: { A: { min: -2, max: 2 } },
      preStack: { A: { min: -8, max: 8 } },
    };
    applyViewportSnapshot(mockUplot, snap1, preStackMap);
    expect(scales.x).toEqual({ min: 5, max: 25 });
    expect(scales.A).toEqual({ min: -2, max: 2 });
    expect(preStackMap.get("A")).toEqual({ min: -8, max: 8 });

    // Snapshot without preStack clears preStackMap
    const snap2 = {
      x: { min: 0, max: 100 },
      y: { A: { min: -10, max: 10 } },
    };
    applyViewportSnapshot(mockUplot, snap2, preStackMap);
    expect(scales.x).toEqual({ min: 0, max: 100 });
    expect(scales.A).toEqual({ min: -10, max: 10 });
    expect(preStackMap.size).toBe(0);
  });
});
