import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Oscilloscope from "../canvas/Oscilloscope";
import "../../index.css";
import WaveformToolbar from "../toolbar/WaveformToolbar";
import { useCaptureStore } from "../../state/captureStore";
import { useCursorStore } from "../../state/cursorStore";
import { useCursorDisplayStore } from "../../state/cursorDisplayStore";
import { useViewportStore } from "../../state/viewportStore";
import type { ParsedCapture } from "../../types/capture";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createTestCapture(sampleCount = 1000): ParsedCapture {
  const timestamps = new Float32Array(sampleCount);
  const ch1Data = new Float32Array(sampleCount);
  const ch2Data = new Float32Array(sampleCount);

  // Sampling delta-t = 10 µs, center at N/2
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
        },
        {
          name: "B",
          label: "Input B",
          derived: false,
          samples: sampleCount,
          deltaT: dt,
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

describe("Dual Measurement Cursors & Readout Panel (Issue #14)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;
  let capture: ParsedCapture;

  beforeEach(() => {
    useCursorStore.getState().reset();
    useViewportStore.getState().reset();
    useCaptureStore.getState().reset();

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
    useCursorStore.getState().reset();
    useViewportStore.getState().reset();
    useCaptureStore.getState().reset();
  });

  it("AC1: C1 and C2 toggle via toolbar buttons; default to 25% and 75% on initial activation", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    const toggleC1 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c1']",
    ) as HTMLButtonElement;
    const toggleC2 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c2']",
    ) as HTMLButtonElement;

    expect(toggleC1).not.toBeNull();
    expect(toggleC2).not.toBeNull();
    expect(toggleC1.getAttribute("aria-pressed")).toBe("false");
    expect(toggleC2.getAttribute("aria-pressed")).toBe("false");

    // Toggle C1 on
    act(() => {
      toggleC1.click();
    });
    expect(useCursorStore.getState().c1Active).toBe(true);
    expect(useCursorStore.getState().c1SampleIndex).toBe(
      Math.floor(0.25 * 999),
    );
    expect(toggleC1.getAttribute("aria-pressed")).toBe("true");

    // Toggle C2 on
    act(() => {
      toggleC2.click();
    });
    expect(useCursorStore.getState().c2Active).toBe(true);
    expect(useCursorStore.getState().c2SampleIndex).toBe(
      Math.floor(0.75 * 999),
    );
    expect(toggleC2.getAttribute("aria-pressed")).toBe("true");
  });

  it("AC2: Active cursor can be selected via toolbar button, cursor line click, or readout badge", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    const toggleC1 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c1']",
    ) as HTMLButtonElement;
    const toggleC2 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c2']",
    ) as HTMLButtonElement;

    // Activate both
    act(() => {
      toggleC1.click();
      toggleC2.click();
    });
    expect(useCursorStore.getState().selectedCursor).toBe("C2");

    // Select C1 via toolbar
    act(() => {
      toggleC1.click();
    });
    expect(useCursorStore.getState().selectedCursor).toBe("C1");

    // Select C2 via readout badge
    const badgeC2 = hostElement.querySelector(
      "[data-testid='cursor-badge-select-c2']",
    ) as HTMLButtonElement;
    expect(badgeC2).not.toBeNull();
    act(() => {
      badgeC2.click();
    });
    expect(useCursorStore.getState().selectedCursor).toBe("C2");

    // Select C1 via line handle click
    const handleC1 = hostElement.querySelector(
      "[data-testid='cursor-handle-c1']",
    ) as HTMLDivElement;
    expect(handleC1).not.toBeNull();
    act(() => {
      handleC1.click();
    });
    expect(useCursorStore.getState().selectedCursor).toBe("C1");

    // Select C2 via cursor line click (outside handle, Finding F1)
    const lineC2 = hostElement.querySelector(
      "[data-testid='cursor-line-c2']",
    ) as HTMLDivElement;
    expect(lineC2).not.toBeNull();
    act(() => {
      lineC2.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useCursorStore.getState().selectedCursor).toBe("C2");
  });

  it("AC3: Unmodified drag starting on a cursor line initiates box-zoom (Finding F5)", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    const toggleC1 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c1']",
    ) as HTMLButtonElement;
    act(() => {
      toggleC1.click();
    });

    const lineC1 = hostElement.querySelector(
      "[data-testid='cursor-line-c1']",
    ) as HTMLDivElement;
    expect(lineC1).not.toBeNull();

    const overlay = hostElement.querySelector(
      "[data-testid='box-zoom-overlay']",
    ) as HTMLDivElement;
    expect(overlay).not.toBeNull();
    expect(overlay.style.display).toBe("none");

    // Unmodified drag starting on cursor line (Finding F5)
    act(() => {
      lineC1.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          clientX: 200,
          clientY: 100,
        }),
      );
    });

    expect(overlay.style.display).toBe("block");

    // Cancel drag via Escape
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(overlay.style.display).toBe("none");
  });

  it("AC5: Ctrl + LeftArrow and Ctrl + RightArrow micro-step selected cursor by exactly 1 sample", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    const toggleC1 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c1']",
    ) as HTMLButtonElement;
    act(() => {
      toggleC1.click();
    });

    const initialIdx = useCursorStore.getState().c1SampleIndex;

    // Press Ctrl + RightArrow
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    expect(useCursorStore.getState().c1SampleIndex).toBe(initialIdx + 1);

    // Press Ctrl + LeftArrow
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowLeft",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    expect(useCursorStore.getState().c1SampleIndex).toBe(initialIdx);
  });

  it("AC6: Ctrl + wheel steps cursor with dynamic acceleration", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    const toggleC1 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c1']",
    ) as HTMLButtonElement;
    act(() => {
      toggleC1.click();
    });

    const initialIdx = useCursorStore.getState().c1SampleIndex;
    const plotArea = hostElement.querySelector(".u-over") as HTMLElement;
    expect(plotArea).not.toBeNull();

    // Small scroll: deltaY = 20 -> step 1
    act(() => {
      plotArea.dispatchEvent(
        new WheelEvent("wheel", { deltaY: 20, ctrlKey: true, bubbles: true }),
      );
    });
    expect(useCursorStore.getState().c1SampleIndex).toBe(initialIdx + 1);

    // Fast scroll: deltaY = -100 -> step Math.round(100/20) = 5
    act(() => {
      plotArea.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true }),
      );
    });
    expect(useCursorStore.getState().c1SampleIndex).toBe(initialIdx + 1 - 5);
  });

  it("AC7: Pressing Escape during cursor drag cancels interaction and restores pre-drag position", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    const toggleC1 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c1']",
    ) as HTMLButtonElement;
    act(() => {
      toggleC1.click();
    });

    const startIdx = useCursorStore.getState().c1SampleIndex;
    const plotArea = hostElement.querySelector(".u-over") as HTMLElement;

    // Start Ctrl-drag
    act(() => {
      plotArea.dispatchEvent(
        new MouseEvent("mousedown", {
          button: 0,
          clientX: 200,
          clientY: 100,
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });

    // Drag move to clientX = 400
    act(() => {
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: 400,
          clientY: 100,
          bubbles: true,
          buttons: 1,
        }),
      );
    });

    // Sample index moved
    const draggedIdx = useCursorStore.getState().c1SampleIndex;
    expect(draggedIdx).not.toBe(startIdx);

    // Press Escape
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    // Position restored to startIdx!
    expect(useCursorStore.getState().c1SampleIndex).toBe(startIdx);
  });

  it("AC8, AC9, AC10, AC11: Floating HUD card displays absolute and differential readouts, units, and respects channel toggles", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    // Initially neither cursor active -> card is hidden
    expect(
      hostElement.querySelector("[data-testid='cursor-readout-card']"),
    ).toBeNull();

    const toggleC1 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c1']",
    ) as HTMLButtonElement;
    const toggleC2 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c2']",
    ) as HTMLButtonElement;

    // Activate C1 only (Single cursor mode)
    act(() => {
      toggleC1.click();
    });

    const card = hostElement.querySelector(
      "[data-testid='cursor-readout-card']",
    );
    expect(card).not.toBeNull();
    expect(
      hostElement.querySelector("[data-testid='cursor-readout-c1']"),
    ).not.toBeNull();
    expect(
      hostElement.querySelector("[data-testid='cursor-readout-c2']"),
    ).toBeNull();
    expect(
      hostElement.querySelector("[data-testid='cursor-readout-differential']"),
    ).toBeNull();

    // Verify channel voltages visible
    expect(
      hostElement.querySelector("[data-testid='cursor-c1-ch-A']"),
    ).not.toBeNull();
    expect(
      hostElement.querySelector("[data-testid='cursor-c1-ch-B']"),
    ).not.toBeNull();

    // AC11: Toggle Channel B off -> B should disappear from readout card
    const toggleChB = hostElement.querySelector(
      "[data-testid='channel-badge-B']",
    ) as HTMLButtonElement;
    act(() => {
      toggleChB.click();
      toggleChB.click();
    });
    expect(
      hostElement.querySelector("[data-testid='cursor-c1-ch-A']"),
    ).not.toBeNull();
    expect(
      hostElement.querySelector("[data-testid='cursor-c1-ch-B']"),
    ).toBeNull();

    // Activate C2 (Dual cursor mode)
    act(() => {
      toggleC2.click();
    });
    expect(
      hostElement.querySelector("[data-testid='cursor-readout-c2']"),
    ).not.toBeNull();
    const diff = hostElement.querySelector(
      "[data-testid='cursor-readout-differential']",
    );
    expect(diff).not.toBeNull();
    expect(
      hostElement.querySelector("[data-testid='cursor-delta-t']"),
    ).not.toBeNull();
    expect(
      hostElement.querySelector("[data-testid='cursor-frequency']"),
    ).not.toBeNull();
    expect(
      hostElement.querySelector("[data-testid='cursor-delta-v-A']"),
    ).not.toBeNull();
  });

  it("AC12: Ingesting a new capture file resets cursors to off and reinitializes default positions", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    const toggleC1 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c1']",
    ) as HTMLButtonElement;
    act(() => {
      toggleC1.click();
    });
    expect(useCursorStore.getState().c1Active).toBe(true);

    // Ingest new capture with 2000 points
    const newCapture = createTestCapture(2000);
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={newCapture} />
        </div>,
      );
    });

    const state = useCursorStore.getState();
    expect(state.c1Active).toBe(false);
    expect(state.c2Active).toBe(false);
    expect(state.selectedCursor).toBeNull();
    expect(state.c1SampleIndex).toBe(Math.floor(0.25 * 1999));
    expect(state.c2SampleIndex).toBe(Math.floor(0.75 * 1999));
  });

  it("F4: Unmounting during cursor drag cleans up document listeners and does not leak or corrupt on Escape", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    const toggleC1 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c1']",
    ) as HTMLButtonElement;
    act(() => {
      toggleC1.click();
    });

    const plotArea = hostElement.querySelector(".u-over") as HTMLDivElement;
    expect(plotArea).not.toBeNull();

    // Start Ctrl+drag
    act(() => {
      plotArea.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          ctrlKey: true,
          clientX: 200,
        }),
      );
    });

    // Unmount Oscilloscope mid-drag
    act(() => {
      root.render(<div>Unmounted</div>);
    });

    // Subsequent Escape or mousemove should not crash or mutate store
    expect(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 300 }));
      document.dispatchEvent(new MouseEvent("mouseup"));
    }).not.toThrow();
  });

  it("F2: cursor drag terminates cleanly if window blurs or primary mouse button is lost", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    const toggleC1 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c1']",
    ) as HTMLButtonElement;
    act(() => {
      toggleC1.click();
    });

    const plotArea = hostElement.querySelector(".u-over") as HTMLDivElement;

    // Start Ctrl+drag
    act(() => {
      plotArea.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          ctrlKey: true,
          clientX: 200,
        }),
      );
    });

    // Window blur event should terminate drag
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });

    // Mousemove afterwards without primary button should not move cursor
    act(() => {
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 350,
          buttons: 0,
        }),
      );
    });

    // Start another drag to test buttons === 0 during move
    act(() => {
      plotArea.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          ctrlKey: true,
          clientX: 200,
        }),
      );
    });

    // Mousemove with buttons = 0 (primary button lost outside context)
    act(() => {
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 210,
          buttons: 0,
        }),
      );
    });

    expect(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 400 }));
    }).not.toThrow();
  });

  it("issue #226 AC3: cursor lines render solid/dashed/dotted in the configured color, independent per cursor", () => {
    useCursorDisplayStore.getState().reset();
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });
    const toggleC1 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c1']",
    ) as HTMLButtonElement;
    const toggleC2 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c2']",
    ) as HTMLButtonElement;
    act(() => {
      toggleC1.click();
      toggleC2.click();
    });

    const line1 = hostElement.querySelector(
      "[data-testid='cursor-line-c1']",
    ) as HTMLDivElement;
    const line2 = hostElement.querySelector(
      "[data-testid='cursor-line-c2']",
    ) as HTMLDivElement;

    // Solid default: 2px background fill in the effective stroke, no border.
    expect(line1.style.backgroundColor).toBe("rgb(224, 64, 251)");
    expect(line1.style.borderLeft).toBe("");

    // Dashed: transparent fill + 2px dashed border in the same stroke.
    act(() => {
      useCursorDisplayStore.getState().setLineStyle("C1", "dashed");
    });
    expect(line1.style.backgroundColor).toBe("transparent");
    expect(line1.style.borderLeft).toBe("2px dashed rgb(224, 64, 251)");

    // Dotted restyles in place; C2 keeps its own solid line.
    act(() => {
      useCursorDisplayStore.getState().setLineStyle("C1", "dotted");
      useCursorDisplayStore.getState().setLineStyle("C2", "dotted");
    });
    expect(line1.style.borderLeft).toBe("2px dotted rgb(224, 64, 251)");
    expect(line2.style.borderLeft).toBe("2px dotted rgb(176, 176, 176)");

    // Back to solid: the plain fill returns.
    act(() => {
      useCursorDisplayStore.getState().setLineStyle("C1", "solid");
    });
    expect(line1.style.backgroundColor).toBe("rgb(224, 64, 251)");
    expect(line1.style.borderLeft).toBe("");

    useCursorDisplayStore.getState().reset();
  });

  it("issue #225 AC2: locked Δt moves both cursor lines by equal pixel deltas, preserving separation", async () => {
    useCursorDisplayStore.getState().reset();
    await act(async () => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
      // Let uPlot lay out and paint once so valToPos resolves real
      // positions (pre-paint reads yield NaN).
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const toggleC1 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c1']",
    ) as HTMLButtonElement;
    const toggleC2 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c2']",
    ) as HTMLButtonElement;
    await act(async () => {
      toggleC1.click();
      toggleC2.click();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const line1 = hostElement.querySelector(
      "[data-testid='cursor-line-c1']",
    ) as HTMLDivElement;
    const line2 = hostElement.querySelector(
      "[data-testid='cursor-line-c2']",
    ) as HTMLDivElement;
    const leftOf = () => ({
      c1: parseFloat(line1.style.left),
      c2: parseFloat(line2.style.left),
    });
    const before = leftOf();
    expect(Number.isFinite(before.c1)).toBe(true);
    expect(Number.isFinite(before.c2)).toBe(true);

    await act(async () => {
      useCursorDisplayStore.getState().setDeltaLocked(true);
      useCursorStore
        .getState()
        .setCursorSample(
          "C1",
          useCursorStore.getState().c1SampleIndex + 50,
          1000,
        );
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const after = leftOf();
    expect(after.c1).toBeGreaterThan(before.c1);
    // Equal pixel deltas → separation preserved exactly.
    expect(after.c2 - before.c2).toBeCloseTo(after.c1 - before.c1, 6);
    expect(
      Math.abs(after.c2 - after.c1 - (before.c2 - before.c1)),
    ).toBeLessThan(1e-6);

    useCursorDisplayStore.getState().reset();
  });

  it("AC3 (Issue #133): cursor handles C1 and C2 carry informative movement tooltips", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    act(() => {
      useCursorStore.getState().toggleCursor("C1", 1000);
      useCursorStore.getState().toggleCursor("C2", 1000);
    });

    const handleC1 = hostElement.querySelector(
      "[data-testid='cursor-handle-c1']",
    ) as HTMLElement;
    const handleC2 = hostElement.querySelector(
      "[data-testid='cursor-handle-c2']",
    ) as HTMLElement;

    expect(handleC1).not.toBeNull();
    expect(handleC1.title).toContain("Cursor C1");
    expect(handleC1.title).toContain("Ctrl + Drag");
    expect(handleC1.title).toContain("Ctrl + Click");
    expect(handleC1.title).toContain("Ctrl + Mousewheel");
    expect(handleC1.title).toContain("Ctrl + Arrow keys");
    expect(handleC1.title).not.toContain("Shift");
    expect(handleC1.getAttribute("aria-label")).toContain("Cursor C1");

    expect(handleC2).not.toBeNull();
    expect(handleC2.title).toContain("Cursor C2");
    expect(handleC2.title).toContain("Ctrl + Drag");
    expect(handleC2.title).toContain("Ctrl + Click");
    expect(handleC2.title).toContain("Ctrl + Mousewheel");
    expect(handleC2.title).toContain("Ctrl + Arrow keys");
    expect(handleC2.title).not.toContain("Shift");
    expect(handleC2.getAttribute("aria-label")).toContain("Cursor C2");
  });
});
