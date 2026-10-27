import { beforeEach, describe, expect, it } from "vitest";
import { computeDefaultSampleIndices, useCursorStore } from "./cursorStore";
import { useCursorDisplayStore } from "./cursorDisplayStore";

describe("cursorStore", () => {
  beforeEach(() => {
    useCursorStore.getState().reset();
    useCursorDisplayStore.getState().reset();
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

describe("cursorStore locked delta-t (issue #225)", () => {
  beforeEach(() => {
    useCursorStore.getState().reset();
    useCursorDisplayStore.getState().reset();
  });

  const positions = () => {
    const s = useCursorStore.getState();
    return { c1: s.c1SampleIndex, c2: s.c2SampleIndex };
  };

  it("setCursorSample slides the pair by equal deltas while locked, preserving the separation exactly", () => {
    useCursorStore.setState({ c1SampleIndex: 100, c2SampleIndex: 400 });
    useCursorDisplayStore.getState().setDeltaLocked(true);

    useCursorStore.getState().setCursorSample("C1", 150, 1000);
    expect(positions()).toEqual({ c1: 150, c2: 450 });

    // Moving the other cursor composes identically (negative direction).
    useCursorStore.getState().setCursorSample("C2", 400, 1000);
    expect(positions()).toEqual({ c1: 100, c2: 400 });

    // Unlocked: single-cursor movement is restored.
    useCursorDisplayStore.getState().setDeltaLocked(false);
    useCursorStore.getState().setCursorSample("C1", 10, 1000);
    expect(positions()).toEqual({ c1: 10, c2: 400 });
  });

  it("locked drags clamp at the sample-range boundaries without breaking the separation", () => {
    useCursorStore.setState({ c1SampleIndex: 100, c2SampleIndex: 400 });
    useCursorDisplayStore.getState().setDeltaLocked(true);

    // C1 cannot pass 0 while C2 must stay at >= 300.
    useCursorStore.getState().setCursorSample("C1", 0, 1000);
    expect(positions()).toEqual({ c1: 0, c2: 300 });

    // And not past the upper window either.
    useCursorStore.getState().setCursorSample("C2", 999, 1000);
    expect(positions()).toEqual({ c1: 699, c2: 999 });
  });

  it("stepCursor (keyboard/mousewheel) composes with the lock the same way", () => {
    useCursorStore.setState({ c1SampleIndex: 100, c2SampleIndex: 400 });
    useCursorDisplayStore.getState().setDeltaLocked(true);

    useCursorStore.getState().stepCursor("C1", 25, 1000);
    expect(positions()).toEqual({ c1: 125, c2: 425 });
    useCursorStore.getState().stepCursor("C2", -50, 1000);
    expect(positions()).toEqual({ c1: 75, c2: 375 });

    useCursorDisplayStore.getState().setDeltaLocked(false);
    useCursorStore.getState().stepCursor("C1", 5, 1000);
    expect(positions()).toEqual({ c1: 80, c2: 375 });
  });

  it("setCursorPositions places both cursors atomically and never triggers the pair-slip (#97 alignment composition)", () => {
    useCursorStore.setState({ c1SampleIndex: 100, c2SampleIndex: 400 });
    useCursorDisplayStore.getState().setDeltaLocked(true);

    // An alignment action sets both positions at once; the lock preserves
    // the NEW separation on later moves instead of re-slipping the pair.
    useCursorStore.getState().setCursorPositions(500, 600, 1000);
    expect(positions()).toEqual({ c1: 500, c2: 600 });

    useCursorStore.getState().setCursorSample("C1", 520, 1000);
    expect(positions()).toEqual({ c1: 520, c2: 620 });
  });

  it("locked moves keep strictly integer sample indices (snap stays hardcoded)", () => {
    useCursorStore.setState({ c1SampleIndex: 10, c2SampleIndex: 20 });
    useCursorDisplayStore.getState().setDeltaLocked(true);
    useCursorStore.getState().setCursorSample("C1", 10.7, 1000);
    expect(positions()).toEqual({ c1: 11, c2: 21 });
    expect(Number.isInteger(positions().c1)).toBe(true);
    expect(Number.isInteger(positions().c2)).toBe(true);
  });
});

describe("cursorStore jumpCursorToSample (issue #314)", () => {
  beforeEach(() => {
    useCursorStore.getState().reset();
    useCursorDisplayStore.getState().reset();
  });

  it("atomically activates, selects, and positions an inactive cursor at the target index", () => {
    const store = useCursorStore.getState();
    expect(store.c1Active).toBe(false);
    expect(store.selectedCursor).toBeNull();

    store.jumpCursorToSample("C1", 42, 1000);
    const state = useCursorStore.getState();
    expect(state.c1Active).toBe(true);
    expect(state.selectedCursor).toBe("C1");
    expect(state.c1SampleIndex).toBe(42);
    expect(state.c2Active).toBe(false);
  });

  it("positions target cursor at sample 0 without clobbering to 25%/75% default", () => {
    const store = useCursorStore.getState();
    store.jumpCursorToSample("C1", 0, 1000);
    const state = useCursorStore.getState();
    expect(state.c1Active).toBe(true);
    expect(state.c1SampleIndex).toBe(0); // must remain 0, not default 249
  });

  it("moves only the target cursor and bypasses locked delta-t pair sliding and clamping", () => {
    useCursorStore.setState({
      c1Active: true,
      c2Active: true,
      selectedCursor: "C1",
      c1SampleIndex: 100,
      c2SampleIndex: 400,
    });
    useCursorDisplayStore.getState().setDeltaLocked(true);

    // Jump C1 to index 500: C2 must stay at 400, not slide to 800
    useCursorStore.getState().jumpCursorToSample("C1", 500, 1000);
    expect(useCursorStore.getState().c1SampleIndex).toBe(500);
    expect(useCursorStore.getState().c2SampleIndex).toBe(400);

    // Jump C2 to index 5: C1 must stay at 500, not clamp short or slide
    useCursorStore.getState().jumpCursorToSample("C2", 5, 1000);
    expect(useCursorStore.getState().c1SampleIndex).toBe(500);
    expect(useCursorStore.getState().c2SampleIndex).toBe(5);
  });

  it("returns unchanged state when totalSamples <= 0", () => {
    useCursorStore.setState({
      c1Active: false,
      c1SampleIndex: 10,
    });
    useCursorStore.getState().jumpCursorToSample("C1", 50, 0);
    expect(useCursorStore.getState().c1Active).toBe(false);
    expect(useCursorStore.getState().c1SampleIndex).toBe(10);
  });
});

describe("cursorStore horizontal Y cursors (issue #281)", () => {
  beforeEach(() => {
    useCursorStore.getState().reset();
  });

  it("toggles Y1 and Y2 on and off, managing selection", () => {
    const store = useCursorStore.getState();

    // Toggle Y1 on
    store.toggleHorizontalCursor("Y1");
    expect(useCursorStore.getState().y1Active).toBe(true);
    expect(useCursorStore.getState().selectedYCursor).toBe("Y1");

    // Toggle Y2 on
    store.toggleHorizontalCursor("Y2");
    expect(useCursorStore.getState().y2Active).toBe(true);
    expect(useCursorStore.getState().selectedYCursor).toBe("Y2");

    // Toggle Y2 off -> selection reverts to Y1
    store.toggleHorizontalCursor("Y2");
    expect(useCursorStore.getState().y2Active).toBe(false);
    expect(useCursorStore.getState().selectedYCursor).toBe("Y1");

    // Toggle Y1 off -> selection reverts to null
    store.toggleHorizontalCursor("Y1");
    expect(useCursorStore.getState().y1Active).toBe(false);
    expect(useCursorStore.getState().selectedYCursor).toBe(null);
  });

  it("sets and steps horizontal cursor values", () => {
    const store = useCursorStore.getState();
    store.toggleHorizontalCursor("Y1");
    store.setHorizontalCursorValue("Y1", 1.5);
    expect(useCursorStore.getState().y1Value).toBe(1.5);

    store.stepHorizontalCursor("Y1", 0.25);
    expect(useCursorStore.getState().y1Value).toBeCloseTo(1.75);

    store.toggleHorizontalCursor("Y2");
    store.setHorizontalCursorValue("Y2", -0.5);
    expect(useCursorStore.getState().y2Value).toBe(-0.5);

    store.stepHorizontalCursor("Y2", -0.1);
    expect(useCursorStore.getState().y2Value).toBeCloseTo(-0.6);
  });

  it("rebinds horizontal cursor values when channel bounds change, preserving relative scale ratio", () => {
    const store = useCursorStore.getState();
    store.toggleHorizontalCursor("Y1");
    store.toggleHorizontalCursor("Y2");

    // Y1 at 2.0 (50% of [0, 4]), Y2 at 1.0 (25% of [0, 4])
    store.setHorizontalCursorValue("Y1", 2.0);
    store.setHorizontalCursorValue("Y2", 1.0);

    // Old bounds: min = 0, max = 4. New bounds: min = -10, max = 10
    store.rebindHorizontalCursors(0, 4, -10, 10, "B");

    const state = useCursorStore.getState();
    // 50% in [-10, 10] is 0.0
    expect(state.y1Value).toBeCloseTo(0.0);
    // 25% in [-10, 10] is -5.0
    expect(state.y2Value).toBeCloseTo(-5.0);
  });
});
