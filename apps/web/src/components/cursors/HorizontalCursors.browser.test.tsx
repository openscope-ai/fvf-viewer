import type uPlot from "uplot";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Oscilloscope from "../canvas/Oscilloscope";
import "../../index.css";
import WaveformToolbar from "../toolbar/WaveformToolbar";
import { useCaptureStore } from "../../state/captureStore";
import { useCursorStore } from "../../state/cursorStore";
import { useViewportStore } from "../../state/viewportStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import type { ParsedCapture } from "../../types/capture";
import { resetSession } from "../../state/captureSession";
import { getLiveRenderState } from "../canvas/liveRenderState";
import {
  laneBandCss,
  visibleYRangeForScale,
} from "../canvas/stackLaneDecorations";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createTestCapture(sampleCount = 1000): ParsedCapture {
  const timestamps = new Float32Array(sampleCount);
  const ch1Data = new Float32Array(sampleCount);
  const ch2Data = new Float32Array(sampleCount);

  const dt = 1e-5;
  const center = Math.floor(sampleCount / 2);
  for (let i = 0; i < sampleCount; i++) {
    timestamps[i] = (i - center) * dt;
    ch1Data[i] = Math.sin(i * 0.05) * 3.3;
    ch2Data[i] = Math.cos(i * 0.05) * 1.8;
  }

  return {
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "10 us/Div",
      secondsPerDiv: 1e-5,
      timestamp14: "12300020260905",
      samples: sampleCount,
      deltaT: dt,
      channels: [
        {
          name: "A",
          label: "Input A",
          derived: false,
          samples: sampleCount,
          deltaT: dt,
          unit: "V",
        },
        {
          name: "B",
          label: "Input B",
          derived: false,
          samples: sampleCount,
          deltaT: dt,
          unit: "mA",
        },
      ],
    },
    channels: [
      { name: "A", label: "Input A", derived: false, data: ch1Data },
      { name: "B", label: "Input B", derived: false, data: ch2Data },
    ],
    derivedChannels: [],
    timestamps,
    warnings: [],
  };
}

describe("Horizontal (Y) Measurement Cursors (Issue #281)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;
  let capture: ParsedCapture;

  beforeEach(() => {
    resetSession();

    capture = createTestCapture(1000);
    useCaptureStore.setState({ capture });

    hostElement = document.createElement("div");
    hostElement.style.width = "800px";
    hostElement.style.height = "600px";
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    hostElement.remove();
    resetSession();
  });

  it("AC1: Y1 and Y2 toggle on/off via toolbar buttons", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    const toggleY1 = hostElement.querySelector(
      "[data-testid='cursor-toggle-y1']",
    ) as HTMLButtonElement;
    const toggleY2 = hostElement.querySelector(
      "[data-testid='cursor-toggle-y2']",
    ) as HTMLButtonElement;

    expect(toggleY1).not.toBeNull();
    expect(toggleY2).not.toBeNull();
    expect(toggleY1.getAttribute("aria-pressed")).toBe("false");
    expect(toggleY2.getAttribute("aria-pressed")).toBe("false");

    // Toggle Y1 on
    act(() => {
      toggleY1.click();
    });
    expect(useCursorStore.getState().y1Active).toBe(true);
    expect(toggleY1.getAttribute("aria-pressed")).toBe("true");

    // Toggle Y2 on
    act(() => {
      toggleY2.click();
    });
    expect(useCursorStore.getState().y2Active).toBe(true);
    expect(toggleY2.getAttribute("aria-pressed")).toBe("true");

    // Lines must be positioned distinctly (75% and 25%, not overlapping at zero)
    const lineY1 = hostElement.querySelector(
      "[data-testid='cursor-line-y1']",
    ) as HTMLDivElement;
    const lineY2 = hostElement.querySelector(
      "[data-testid='cursor-line-y2']",
    ) as HTMLDivElement;
    expect(lineY1).not.toBeNull();
    expect(lineY2).not.toBeNull();
    expect(lineY1.style.top).not.toEqual(lineY2.style.top);

    // Handles must provide accurate horizontal cursor accessibility guidance
    const handleY1 = hostElement.querySelector(
      "[data-testid='cursor-handle-y1']",
    ) as HTMLDivElement;
    expect(handleY1.getAttribute("aria-label")).toContain("amplitude");

    // Gear button opens config popover (F-UI-01)
    const gearY1 = hostElement.querySelector(
      "[data-testid='cursor-gear-y1']",
    ) as HTMLButtonElement;
    expect(gearY1).not.toBeNull();
    act(() => {
      gearY1.click();
    });
    expect(
      document.body.querySelector("[data-testid='badge-config-popover']"),
    ).not.toBeNull();
    act(() => {
      gearY1.click();
    });

    // Clicking Y1 when Y2 is selected switches selection to Y1
    act(() => {
      toggleY1.click();
    });
    expect(useCursorStore.getState().selectedYCursor).toBe("Y1");

    // Ctrl + ArrowUp steps selected Y cursor upward
    const prevY1 = useCursorStore.getState().y1Value!;
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    expect(useCursorStore.getState().y1Value).toBeGreaterThan(prevY1);

    // Pointer dragging moves Y1 cursor line (F-TEST-01)
    const beforeDragY1 = useCursorStore.getState().y1Value!;
    act(() => {
      lineY1.dispatchEvent(
        new MouseEvent("mousedown", {
          button: 0,
          clientY: 100,
          bubbles: true,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          clientY: 180,
          buttons: 1,
          bubbles: true,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          button: 0,
          bubbles: true,
        }),
      );
    });
    const afterDragY1 = useCursorStore.getState().y1Value!;
    expect(afterDragY1).not.toBe(beforeDragY1);

    // Clicking selected Y1 toggles it off
    act(() => {
      toggleY1.click();
    });
    expect(useCursorStore.getState().y1Active).toBe(false);
  });

  it("AC2: Readout displays absolute amplitudes and delta-Y in selected channel units", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    act(() => {
      useCursorStore.getState().toggleHorizontalCursor("Y1");
      useCursorStore.getState().toggleHorizontalCursor("Y2");
      useCursorStore.getState().setHorizontalCursorValue("Y1", 2.5);
      useCursorStore.getState().setHorizontalCursorValue("Y2", 1.0);
    });

    const readout = hostElement.querySelector(
      "[data-testid='cursor-readout-horizontal']",
    );
    expect(readout).not.toBeNull();
    expect(readout?.textContent).toContain("Y1");
    expect(readout?.textContent).toContain("2.500 V");
    expect(readout?.textContent).toContain("Y2");
    expect(readout?.textContent).toContain("1.000 V");
    expect(readout?.textContent).toContain("ΔY");
    expect(readout?.textContent).toContain("1.500 V");
  });

  it("AC3: Channel switching re-binds Y1/Y2 to new channel's axis/units", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    act(() => {
      useCursorStore.getState().toggleHorizontalCursor("Y1");
      useCursorStore.getState().setHorizontalCursorValue("Y1", 1.65);
    });

    const readoutBefore = hostElement.querySelector(
      "[data-testid='cursor-readout-horizontal']",
    );
    expect(readoutBefore?.textContent).toContain("Y1");
    expect(readoutBefore?.textContent).toContain("A:");

    // Switch selected channel from A to B
    act(() => {
      useViewportStore.getState().setSelectedChannel("B");
    });

    const readoutAfter = hostElement.querySelector(
      "[data-testid='cursor-readout-horizontal']",
    );
    expect(readoutAfter).not.toBeNull();
    // Readout reflects Channel B
    expect(readoutAfter?.textContent).toContain("B:");
    // Value must be re-bound to Channel B's scale (scaled from ~1.65 on A to ~0.9 on B)
    const remappedY1 = useCursorStore.getState().y1Value!;
    expect(remappedY1).toBeLessThan(1.65);
    expect(remappedY1).toBeCloseTo(0.9, 1);
  });

  it("AC4: Out-of-view recovery badges appear on top/bottom and clicking snaps cursors back into view", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    // Viewport Y bounds for channel A default around [-3.3, 3.3]
    // Set Y1 way above max and Y2 way below min
    act(() => {
      useCursorStore.getState().toggleHorizontalCursor("Y1");
      useCursorStore.getState().setHorizontalCursorValue("Y1", 100.0);
      useCursorStore.getState().toggleHorizontalCursor("Y2");
      useCursorStore.getState().setHorizontalCursorValue("Y2", -100.0);
    });

    const badgeY1 = hostElement.querySelector(
      "[data-testid='cursor-recovery-badge-y1']",
    ) as HTMLButtonElement;
    const badgeY2 = hostElement.querySelector(
      "[data-testid='cursor-recovery-badge-y2']",
    ) as HTMLButtonElement;

    expect(badgeY1).not.toBeNull();
    expect(badgeY2).not.toBeNull();

    // Clicking recovery badge snaps Y1 back into visible viewport
    act(() => {
      badgeY1.click();
    });

    const recoveredY1 = useCursorStore.getState().y1Value;
    expect(recoveredY1).not.toBeNull();
    expect(recoveredY1!).toBeLessThanOrEqual(3.3);
    expect(recoveredY1!).toBeGreaterThanOrEqual(-3.3);
    expect(
      hostElement.querySelector("[data-testid='cursor-recovery-badge-y1']"),
    ).toBeNull();

    // Clicking recovery badge snaps Y2 back into visible viewport
    act(() => {
      badgeY2.click();
    });

    const recoveredY2 = useCursorStore.getState().y2Value;
    expect(recoveredY2).not.toBeNull();
    expect(recoveredY2!).toBeLessThanOrEqual(3.3);
    expect(recoveredY2!).toBeGreaterThanOrEqual(-3.3);
    expect(
      hostElement.querySelector("[data-testid='cursor-recovery-badge-y2']"),
    ).toBeNull();
  });

  it("Y cursor on inverted channel matches vertical cursor readout semantics (F-INV-02)", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    act(() => {
      // Invert channel A
      useChannelDisplayStore.getState().setInverted("A", true);
      useCursorStore.getState().toggleHorizontalCursor("Y1");
      // Line placed on the inverted trace peak at -2.0 V display space
      useCursorStore.getState().setHorizontalCursorValue("Y1", -2.0);
    });

    const readoutVal = hostElement.querySelector(
      "[data-testid='cursor-value-y1']",
    );
    expect(readoutVal?.textContent).toContain("-2.000 V");
  });

  it("Y cursor readout inverts scale and offset display transforms (F-DISP-01)", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    act(() => {
      useCursorStore.getState().toggleHorizontalCursor("Y1");
      useCursorStore.getState().toggleHorizontalCursor("Y2");
      // Set display-space position to 5.0 and 1.0 display units
      useCursorStore.getState().setHorizontalCursorValue("Y1", 5.0);
      useCursorStore.getState().setHorizontalCursorValue("Y2", 1.0);
      // Set 200% Y scale and +1.0 V offset on Channel A
      useChannelDisplayStore.getState().setYScale("A", 200);
      useChannelDisplayStore.getState().setOffset("A", 1.0);
    });

    // In display space, 5.0 V with 200% scale and +1.0 offset corresponds to physical 2.0 V: (5.0 - 1.0) / 2.0 = 2.000 V
    // Y2: (1.0 - 1.0) / 2.0 = 0.000 V
    // ΔY: |2.0 - 0.0| = 2.000 V
    const readoutValY1 = hostElement.querySelector(
      "[data-testid='cursor-value-y1']",
    );
    const readoutValY2 = hostElement.querySelector(
      "[data-testid='cursor-value-y2']",
    );
    const deltaY = hostElement.querySelector(
      "[data-testid='cursor-delta-y-value']",
    );
    expect(readoutValY1?.textContent).toContain("2.000 V");
    expect(readoutValY2?.textContent).toContain("0.000 V");
    expect(deltaY?.textContent).toContain("2.000 V");
  });
});

describe("Horizontal (Y) Cursors in Stacked View (Issue #364)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;
  let capture: ParsedCapture;

  const getUPlot = (): uPlot => {
    const container = hostElement.querySelector(".oscilloscope-container") as
      (HTMLElement & { __uplot?: uPlot }) | null;
    if (!container?.__uplot) {
      throw new Error("Expected mounted uPlot instance");
    }
    return container.__uplot;
  };

  const renderStacked = async () => {
    act(() => {
      useChannelDisplayStore.getState().setStackMode(true);
      root.render(
        <div
          style={{
            width: "800px",
            height: "600px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <WaveformToolbar />
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            <Oscilloscope capture={capture} />
          </div>
        </div>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
  };

  beforeEach(() => {
    resetSession();
    capture = createTestCapture(1000);
    useCaptureStore.setState({ capture });

    hostElement = document.createElement("div");
    hostElement.style.width = "800px";
    hostElement.style.height = "600px";
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    hostElement.remove();
    resetSession();
  });

  it("AC1: activating Y1/Y2 in stacked view places them at 75%/25% of the selected channel's lane", async () => {
    await renderStacked();
    const u = getUPlot();
    const renderState = getLiveRenderState(capture);
    const bandA = laneBandCss(u, renderState, "y0")!;
    expect(bandA).not.toBeNull();
    const laneHeight = bandA.bottom - bandA.top;
    expect(laneHeight).toBeGreaterThan(20);

    act(() => {
      useCursorStore.getState().toggleHorizontalCursor("Y1");
      useCursorStore.getState().toggleHorizontalCursor("Y2");
    });

    const lineY1 = hostElement.querySelector(
      "[data-testid='cursor-line-y1']",
    ) as HTMLDivElement;
    const lineY2 = hostElement.querySelector(
      "[data-testid='cursor-line-y2']",
    ) as HTMLDivElement;
    expect(lineY1.style.display).toBe("block");
    expect(lineY2.style.display).toBe("block");

    const top1 = parseFloat(lineY1.style.top);
    const top2 = parseFloat(lineY2.style.top);

    // 75% up from lane bottom = 25% down from lane top; 25% up = 75% down
    expect(top1).toBeGreaterThanOrEqual(bandA.top);
    expect(top1).toBeLessThanOrEqual(bandA.bottom);
    expect(top2).toBeGreaterThanOrEqual(bandA.top);
    expect(top2).toBeLessThanOrEqual(bandA.bottom);
    expect(top1).toBeCloseTo(bandA.top + 0.25 * laneHeight, 0);
    expect(top2).toBeCloseTo(bandA.top + 0.75 * laneHeight, 0);

    const visibleA = visibleYRangeForScale(
      u.scales.y0!.min!,
      u.scales.y0!.max!,
      renderState,
      "y0",
    );
    expect(useCursorStore.getState().y1Value!).toBeCloseTo(
      visibleA.min + 0.75 * (visibleA.max - visibleA.min),
      3,
    );
    expect(useCursorStore.getState().y2Value!).toBeCloseTo(
      visibleA.min + 0.25 * (visibleA.max - visibleA.min),
      3,
    );
  });

  it("AC2: switching selected channel in stacked view moves Y1/Y2 into the new lane preserving relative position and updating readout units", async () => {
    await renderStacked();

    act(() => {
      useCursorStore.getState().toggleHorizontalCursor("Y1");
      useCursorStore.getState().toggleHorizontalCursor("Y2");
    });

    // Switch selected channel from A to B
    await act(async () => {
      useViewportStore.getState().setSelectedChannel("B");
      await new Promise((r) => setTimeout(r, 40));
    });

    const u = getUPlot();
    const renderState = getLiveRenderState(capture);
    const bandB = laneBandCss(u, renderState, "y1")!;
    expect(bandB).not.toBeNull();
    const laneBHeight = bandB.bottom - bandB.top;

    const lineY1 = hostElement.querySelector(
      "[data-testid='cursor-line-y1']",
    ) as HTMLDivElement;
    const lineY2 = hostElement.querySelector(
      "[data-testid='cursor-line-y2']",
    ) as HTMLDivElement;
    expect(lineY1.style.display).toBe("block");
    expect(lineY2.style.display).toBe("block");

    const top1 = parseFloat(lineY1.style.top);
    const top2 = parseFloat(lineY2.style.top);

    // Both cursors must now live inside Lane B at 75% (top+25%) and 25% (top+75%)
    expect(top1).toBeGreaterThanOrEqual(bandB.top);
    expect(top1).toBeLessThanOrEqual(bandB.bottom);
    expect(top2).toBeGreaterThanOrEqual(bandB.top);
    expect(top2).toBeLessThanOrEqual(bandB.bottom);
    expect(top1).toBeCloseTo(bandB.top + 0.25 * laneBHeight, 0);
    expect(top2).toBeCloseTo(bandB.top + 0.75 * laneBHeight, 0);

    const visibleB = visibleYRangeForScale(
      u.scales.y1!.min!,
      u.scales.y1!.max!,
      renderState,
      "y1",
    );
    const expectedY1 = visibleB.min + 0.75 * (visibleB.max - visibleB.min);
    const expectedY2 = visibleB.min + 0.25 * (visibleB.max - visibleB.min);
    expect(useCursorStore.getState().y1Value!).toBeCloseTo(expectedY1, 3);
    expect(useCursorStore.getState().y2Value!).toBeCloseTo(expectedY2, 3);

    const readout = hostElement.querySelector(
      "[data-testid='cursor-readout-horizontal']",
    );
    expect(readout?.textContent).toContain("B:");
    expect(readout?.textContent).toContain("mA");
  });

  it("AC3: dragging and Ctrl+Up/Down stepping clamp Y1/Y2 to the selected lane's top and bottom edges", async () => {
    await renderStacked();
    const u = getUPlot();
    const renderState = getLiveRenderState(capture);
    const bandA = laneBandCss(u, renderState, "y0")!;
    const visibleA = visibleYRangeForScale(
      u.scales.y0!.min!,
      u.scales.y0!.max!,
      renderState,
      "y0",
    );

    act(() => {
      useCursorStore.getState().toggleHorizontalCursor("Y1");
    });

    const lineY1 = hostElement.querySelector(
      "[data-testid='cursor-line-y1']",
    ) as HTMLDivElement;
    const plotRect = u.over.getBoundingClientRect();

    // Drag far below Channel A's lane (into Channel B's lane)
    act(() => {
      lineY1.dispatchEvent(
        new MouseEvent("mousedown", {
          button: 0,
          clientY: plotRect.top + (bandA.top + bandA.bottom) / 2,
          bubbles: true,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          clientY: plotRect.bottom - 5,
          buttons: 1,
          bubbles: true,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          button: 0,
          bubbles: true,
        }),
      );
    });

    expect(useCursorStore.getState().y1Value!).toBeCloseTo(visibleA.min, 3);
    expect(parseFloat(lineY1.style.top)).toBeCloseTo(bandA.bottom, 0);
    // Clamping at edge must not trigger a recovery badge
    expect(
      hostElement.querySelector("[data-testid='cursor-recovery-badge-y1']"),
    ).toBeNull();

    // Ctrl+ArrowDown at bottom edge must stay clamped at visibleA.min
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    expect(useCursorStore.getState().y1Value!).toBeCloseTo(visibleA.min, 3);

    // Drag above top edge of Lane A
    act(() => {
      lineY1.dispatchEvent(
        new MouseEvent("mousedown", {
          button: 0,
          clientY: plotRect.top + bandA.bottom - 5,
          bubbles: true,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          clientY: plotRect.top - 40,
          buttons: 1,
          bubbles: true,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          button: 0,
          bubbles: true,
        }),
      );
    });

    expect(useCursorStore.getState().y1Value!).toBeCloseTo(visibleA.max, 3);
    expect(parseFloat(lineY1.style.top)).toBeCloseTo(bandA.top, 0);

    // Ctrl+ArrowUp at top edge must stay clamped at visibleA.max
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    expect(useCursorStore.getState().y1Value!).toBeCloseTo(visibleA.max, 3);
  });

  it("AC4: out-of-lane Y cursors are hidden, show recovery badges, and recover to 67%/33% of the lane", async () => {
    await renderStacked();
    const u = getUPlot();
    const renderState = getLiveRenderState(capture);
    const bandA = laneBandCss(u, renderState, "y0")!;
    const visibleA = visibleYRangeForScale(
      u.scales.y0!.min!,
      u.scales.y0!.max!,
      renderState,
      "y0",
    );

    // Place Y1 above Lane A's visible max and Y2 below Lane A's visible min
    // (note: Y2's value still falls inside uPlot's stretched full-canvas y0 scale,
    // which previously caused it to bleed into Lane B without a recovery badge!)
    act(() => {
      useCursorStore.getState().toggleHorizontalCursor("Y1");
      useCursorStore.getState().toggleHorizontalCursor("Y2");
      useCursorStore
        .getState()
        .setHorizontalCursorValue("Y1", visibleA.max + 2.0);
      useCursorStore
        .getState()
        .setHorizontalCursorValue("Y2", visibleA.min - 2.0);
    });

    const lineY1 = hostElement.querySelector(
      "[data-testid='cursor-line-y1']",
    ) as HTMLDivElement;
    const lineY2 = hostElement.querySelector(
      "[data-testid='cursor-line-y2']",
    ) as HTMLDivElement;
    expect(lineY1.style.display).toBe("none");
    expect(lineY2.style.display).toBe("none");

    const badgeY1 = hostElement.querySelector(
      "[data-testid='cursor-recovery-badge-y1']",
    ) as HTMLButtonElement;
    const badgeY2 = hostElement.querySelector(
      "[data-testid='cursor-recovery-badge-y2']",
    ) as HTMLButtonElement;
    expect(badgeY1).not.toBeNull();
    expect(badgeY2).not.toBeNull();

    // Recover Y1 -> 67% of Lane A
    act(() => {
      badgeY1.click();
    });
    expect(useCursorStore.getState().y1Value!).toBeCloseTo(
      visibleA.min + 0.67 * (visibleA.max - visibleA.min),
      3,
    );
    expect(lineY1.style.display).toBe("block");
    expect(parseFloat(lineY1.style.top)).toBeGreaterThanOrEqual(bandA.top);
    expect(parseFloat(lineY1.style.top)).toBeLessThanOrEqual(bandA.bottom);
    expect(
      hostElement.querySelector("[data-testid='cursor-recovery-badge-y1']"),
    ).toBeNull();

    // Recover Y2 -> 33% of Lane A
    act(() => {
      badgeY2.click();
    });
    expect(useCursorStore.getState().y2Value!).toBeCloseTo(
      visibleA.min + 0.33 * (visibleA.max - visibleA.min),
      3,
    );
    expect(lineY2.style.display).toBe("block");
    expect(parseFloat(lineY2.style.top)).toBeGreaterThanOrEqual(bandA.top);
    expect(parseFloat(lineY2.style.top)).toBeLessThanOrEqual(bandA.bottom);
    expect(
      hostElement.querySelector("[data-testid='cursor-recovery-badge-y2']"),
    ).toBeNull();
  });

  it("AC5: toggling between overlay and stacked view preserves Y1/Y2 values with accurate positions and out-of-view state", async () => {
    // Start in overlay mode
    act(() => {
      useChannelDisplayStore.getState().setStackMode(false);
      root.render(
        <div
          style={{
            width: "800px",
            height: "600px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <WaveformToolbar />
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            <Oscilloscope capture={capture} />
          </div>
        </div>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });

    act(() => {
      useCursorStore.getState().toggleHorizontalCursor("Y1");
      useCursorStore.getState().toggleHorizontalCursor("Y2");
      useCursorStore.getState().setHorizontalCursorValue("Y1", 1.5);
      useCursorStore.getState().setHorizontalCursorValue("Y2", -1.5);
    });

    // Toggle to stacked mode
    await act(async () => {
      useChannelDisplayStore.getState().setStackMode(true);
      await new Promise((r) => setTimeout(r, 80));
    });

    expect(useCursorStore.getState().y1Value).toBe(1.5);
    expect(useCursorStore.getState().y2Value).toBe(-1.5);

    const u = getUPlot();
    const renderState = getLiveRenderState(capture);
    const bandA = laneBandCss(u, renderState, "y0")!;
    const lineY1 = hostElement.querySelector(
      "[data-testid='cursor-line-y1']",
    ) as HTMLDivElement;
    const lineY2 = hostElement.querySelector(
      "[data-testid='cursor-line-y2']",
    ) as HTMLDivElement;
    expect(lineY1.style.display).toBe("block");
    expect(lineY2.style.display).toBe("block");
    expect(parseFloat(lineY1.style.top)).toBeGreaterThanOrEqual(bandA.top);
    expect(parseFloat(lineY1.style.top)).toBeLessThanOrEqual(bandA.bottom);
    expect(parseFloat(lineY2.style.top)).toBeGreaterThanOrEqual(bandA.top);
    expect(parseFloat(lineY2.style.top)).toBeLessThanOrEqual(bandA.bottom);

    // Toggle back to overlay mode
    await act(async () => {
      useChannelDisplayStore.getState().setStackMode(false);
      await new Promise((r) => setTimeout(r, 80));
    });

    expect(useCursorStore.getState().y1Value).toBe(1.5);
    expect(useCursorStore.getState().y2Value).toBe(-1.5);
    expect(lineY1.style.display).toBe("block");
    expect(lineY2.style.display).toBe("block");
    expect(
      hostElement.querySelector("[data-testid='cursor-recovery-badge-y1']"),
    ).toBeNull();
  });
});
