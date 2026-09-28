import { beforeEach, describe, expect, it } from "vitest";
import { computeDefaultSampleIndices, useCursorStore } from "./cursorStore";

describe("cursorStore", () => {
  beforeEach(() => {
    useCursorStore.getState().reset();
  });

  it("calculates 25% and 75% default indices accurately", () => {
    expect(computeDefaultSampleIndices(1001)).toEqual({
      c1Index: 250,
      c2Index: 750,
    });
    expect(computeDefaultSampleIndices(1)).toEqual({
      c1Index: 0,
      c2Index: 0,
    });
  });

  it("toggles C1 and C2 on and off, managing selection", () => {
    const store = useCursorStore.getState();

    // Toggle C1 on
    store.toggleCursor("C1", 1000);
    expect(useCursorStore.getState().c1Active).toBe(true);
    expect(useCursorStore.getState().selectedCursor).toBe("C1");
    expect(useCursorStore.getState().c1SampleIndex).toBe(249);

    // Toggle C2 on
    store.toggleCursor("C2", 1000);
    expect(useCursorStore.getState().c2Active).toBe(true);
    expect(useCursorStore.getState().selectedCursor).toBe("C2");
    expect(useCursorStore.getState().c2SampleIndex).toBe(749);

    // Toggle C2 off -> selected should revert to C1
    store.toggleCursor("C2", 1000);
    expect(useCursorStore.getState().c2Active).toBe(false);
    expect(useCursorStore.getState().selectedCursor).toBe("C1");

    // Toggle C1 off -> selected becomes null
    store.toggleCursor("C1", 1000);
    expect(useCursorStore.getState().c1Active).toBe(false);
    expect(useCursorStore.getState().selectedCursor).toBe(null);
  });

  it("clamps cursor movement within valid sample bounds", () => {
    const store = useCursorStore.getState();
    store.initForCapture(100);

    store.setCursorSample("C1", -50, 100);
    expect(useCursorStore.getState().c1SampleIndex).toBe(0);

    store.setCursorSample("C1", 200, 100);
    expect(useCursorStore.getState().c1SampleIndex).toBe(99);

    store.stepCursor("C1", -10, 100);
    expect(useCursorStore.getState().c1SampleIndex).toBe(89);

    store.stepCursor("C1", 20, 100);
    expect(useCursorStore.getState().c1SampleIndex).toBe(99);
  });

  it("resets on new capture initialization", () => {
    const store = useCursorStore.getState();
    store.toggleCursor("C1", 500);
    store.toggleCursor("C2", 500);

    // Simulate new capture ingestion
    store.initForCapture(2000);
    const state = useCursorStore.getState();
    expect(state.c1Active).toBe(false);
    expect(state.c2Active).toBe(false);
    expect(state.selectedCursor).toBe(null);
    expect(state.c1SampleIndex).toBe(499);
    expect(state.c2SampleIndex).toBe(1499);
  });
});
