import { beforeEach, describe, expect, it } from "vitest";
import { useViewportStore } from "./viewportStore";

describe("viewportStore", () => {
  beforeEach(() => {
    useViewportStore.getState().reset();
  });

  it("initialises with null bounds and default active channels A, B, C, D", () => {
    const state = useViewportStore.getState();
    expect(state.xMin).toBeNull();
    expect(state.xMax).toBeNull();
    expect(state.yMin).toBeNull();
    expect(state.yMax).toBeNull();
    expect(state.fitRequest).toBe(0);
    expect(state.activeChannels).toEqual(["A", "B", "C", "D"]);
  });

  it("updates bounds via setBounds", () => {
    useViewportStore.getState().setBounds({
      xMin: -0.05,
      xMax: 0.05,
      yMin: -10,
      yMax: 10,
    });

    const state = useViewportStore.getState();
    expect(state.xMin).toBe(-0.05);
    expect(state.xMax).toBe(0.05);
    expect(state.yMin).toBe(-10);
    expect(state.yMax).toBe(10);
  });

  it("partially updates bounds without clobbering unspecified fields", () => {
    useViewportStore.getState().setBounds({ xMin: 0.0, xMax: 1.0 });
    useViewportStore.getState().setBounds({ yMin: -2.5 });

    const state = useViewportStore.getState();
    expect(state.xMin).toBe(0.0);
    expect(state.xMax).toBe(1.0);
    expect(state.yMin).toBe(-2.5);
    expect(state.yMax).toBeNull();
  });

  it("clears bounds via resetBounds while preserving active channels", () => {
    useViewportStore
      .getState()
      .setBounds({ xMin: -1, xMax: 1, yMin: -5, yMax: 5 });
    useViewportStore.getState().toggleChannel("A");
    useViewportStore.getState().resetBounds();

    const state = useViewportStore.getState();
    expect(state.xMin).toBeNull();
    expect(state.xMax).toBeNull();
    expect(state.yMin).toBeNull();
    expect(state.yMax).toBeNull();
    expect(state.activeChannels).toEqual(["B", "C", "D"]);
  });

  it("toggles channels on and off", () => {
    expect(useViewportStore.getState().activeChannels).toContain("B");

    useViewportStore.getState().toggleChannel("B");
    expect(useViewportStore.getState().activeChannels).not.toContain("B");

    useViewportStore.getState().toggleChannel("B");
    expect(useViewportStore.getState().activeChannels).toContain("B");
  });

  it("sets channel visibility explicitly", () => {
    useViewportStore.getState().setChannelVisibility("C", false);
    expect(useViewportStore.getState().activeChannels).not.toContain("C");

    // Idempotent false
    useViewportStore.getState().setChannelVisibility("C", false);
    expect(useViewportStore.getState().activeChannels).not.toContain("C");

    useViewportStore.getState().setChannelVisibility("C", true);
    expect(useViewportStore.getState().activeChannels).toContain("C");

    // Idempotent true
    useViewportStore.getState().setChannelVisibility("C", true);
    expect(useViewportStore.getState().activeChannels).toContain("C");
  });

  it("sets active channels in bulk", () => {
    useViewportStore.getState().setActiveChannels(["A", "D"]);
    expect(useViewportStore.getState().activeChannels).toEqual(["A", "D"]);
  });

  it("starts with fitRequest 0 and increments monotonically via requestFit", () => {
    expect(useViewportStore.getState().fitRequest).toBe(0);

    useViewportStore.getState().requestFit();
    expect(useViewportStore.getState().fitRequest).toBe(1);

    useViewportStore.getState().requestFit();
    expect(useViewportStore.getState().fitRequest).toBe(2);
  });

  it("requestFit does not mutate bounds or active channels", () => {
    useViewportStore
      .getState()
      .setBounds({ xMin: -1, xMax: 1, yMin: -5, yMax: 5 });
    useViewportStore.getState().toggleChannel("A");

    useViewportStore.getState().requestFit();

    const state = useViewportStore.getState();
    expect(state.xMin).toBe(-1);
    expect(state.xMax).toBe(1);
    expect(state.yMin).toBe(-5);
    expect(state.yMax).toBe(5);
    expect(state.activeChannels).toEqual(["B", "C", "D"]);
  });

  it("resets back to initial state", () => {
    useViewportStore.getState().setBounds({ xMin: 1, xMax: 2 });
    useViewportStore.getState().setActiveChannels(["A"]);
    useViewportStore.getState().requestFit();
    useViewportStore.getState().reset();

    const state = useViewportStore.getState();
    expect(state.xMin).toBeNull();
    expect(state.xMax).toBeNull();
    expect(state.yMin).toBeNull();
    expect(state.yMax).toBeNull();
    expect(state.fitRequest).toBe(0);
    expect(state.activeChannels).toEqual(["A", "B", "C", "D"]);
    expect(state.selectedChannel).toBe("A");
  });

  describe("selectedChannel and cycleChannelBadge (Issue #119)", () => {
    it("initialises with selectedChannel defaulting to first visible channel A", () => {
      expect(useViewportStore.getState().selectedChannel).toBe("A");
    });

    it("cycles badge: hidden -> visible -> selected -> hidden", () => {
      // Start with only A visible and selected; B is hidden
      useViewportStore.getState().setActiveChannels(["A"]);
      expect(useViewportStore.getState().selectedChannel).toBe("A");
      expect(useViewportStore.getState().activeChannels).toEqual(["A"]);

      // 1. Hidden -> Visible (B becomes visible, A remains selected)
      useViewportStore.getState().cycleChannelBadge("B");
      expect(useViewportStore.getState().activeChannels).toContain("B");
      expect(useViewportStore.getState().selectedChannel).toBe("A");

      // 2. Visible -> Selected (B becomes selected)
      useViewportStore.getState().cycleChannelBadge("B");
      expect(useViewportStore.getState().activeChannels).toContain("B");
      expect(useViewportStore.getState().selectedChannel).toBe("B");

      // 3. Selected -> Hidden (B becomes hidden; selection falls back to A)
      useViewportStore.getState().cycleChannelBadge("B");
      expect(useViewportStore.getState().activeChannels).not.toContain("B");
      expect(useViewportStore.getState().selectedChannel).toBe("A");
    });

    it("falling back when selected channel is hidden, and degenerate state when all channels hidden", () => {
      useViewportStore.getState().setActiveChannels(["A", "B"]);
      useViewportStore.getState().setSelectedChannel("A");

      // Hiding A makes selection fall back to B
      useViewportStore.getState().setChannelVisibility("A", false);
      expect(useViewportStore.getState().activeChannels).toEqual(["B"]);
      expect(useViewportStore.getState().selectedChannel).toBe("B");

      // Hiding B leaves 0 channels visible -> degenerate null selection
      useViewportStore.getState().setChannelVisibility("B", false);
      expect(useViewportStore.getState().activeChannels).toEqual([]);
      expect(useViewportStore.getState().selectedChannel).toBeNull();

      // Turning B back on sets selection to B
      useViewportStore.getState().setChannelVisibility("B", true);
      expect(useViewportStore.getState().activeChannels).toEqual(["B"]);
      expect(useViewportStore.getState().selectedChannel).toBe("B");
    });

    it("setSelectedChannel changes selected channel among visible channels", () => {
      useViewportStore.getState().setActiveChannels(["A", "B", "C"]);
      useViewportStore.getState().setSelectedChannel("C");
      expect(useViewportStore.getState().selectedChannel).toBe("C");

      // Ignored for non-visible channel
      useViewportStore.getState().setSelectedChannel("D");
      expect(useViewportStore.getState().selectedChannel).toBe("C");
    });
  });
});
