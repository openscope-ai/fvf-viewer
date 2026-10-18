import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type uPlot from "uplot";
import fourChUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import Oscilloscope from "./Oscilloscope";
import WaveformToolbar from "../toolbar/WaveformToolbar";
import { useCaptureStore } from "../../state/captureStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import { useCursorStore } from "../../state/cursorStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useThemeStore } from "../../state/themeStore";
import { useViewportStore } from "../../state/viewportStore";
import { NAVIGATION_HELP_SUMMARY } from "./navigationHelp";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching ${url}`).toBeTruthy();
  return response.arrayBuffer();
}

describe("Wheel zoom and drag pan navigation (Issue #286)", () => {
  let host: HTMLDivElement;
  let root: Root;

  const mountUi = async (): Promise<uPlot> => {
    let mounted: uPlot | null = null;
    await act(async () => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope
            onUPlotInit={(u) => {
              mounted = u;
            }}
          />
        </div>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(mounted).not.toBeNull();
    return mounted!;
  };

  beforeEach(async () => {
    window.localStorage.clear();
    useChannelDisplayStore.getState().reset();
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
    useChannelNamesStore.setState({ fileKey: null, names: {} });

    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(fourChUrl), "four.fvf");

    host = document.createElement("div");
    host.style.width = "900px";
    host.style.height = "640px";
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.localStorage.clear();
  });

  it("AC1: Wheel zoom expands/contracts the view around pointer position", async () => {
    const uplot = await mountUi();
    const over = host.querySelector(".u-over") as HTMLDivElement;
    expect(over).not.toBeNull();

    const rect = over.getBoundingClientRect();
    const curXMin = uplot.scales.x!.min!;
    const curXMax = uplot.scales.x!.max!;
    const initialSpan = curXMax - curXMin;

    // Pointer positioned at 25% across plot area
    const pointerClientX = rect.left + rect.width * 0.25;
    const pointerTime = uplot.posToVal(rect.width * 0.25, "x");

    // 1. Wheel zoom in (negative deltaY)
    await act(async () => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: pointerClientX,
        clientY: rect.top + rect.height * 0.5,
        deltaY: -120,
      });
      over.dispatchEvent(event);
      await new Promise((r) => setTimeout(r, 40));
    });

    const zoomedInMin = uplot.scales.x!.min!;
    const zoomedInMax = uplot.scales.x!.max!;
    const zoomedInSpan = zoomedInMax - zoomedInMin;

    // Span has contracted (zoomed in)
    expect(zoomedInSpan).toBeLessThan(initialSpan);

    // The time under the pointer is preserved at 25% of the new span
    const timeAtSamePixel = uplot.posToVal(rect.width * 0.25, "x");
    expect(timeAtSamePixel).toBeCloseTo(pointerTime, 4);

    // 2. Wheel zoom out (positive deltaY)
    await act(async () => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: pointerClientX,
        clientY: rect.top + rect.height * 0.5,
        deltaY: 120,
      });
      over.dispatchEvent(event);
      await new Promise((r) => setTimeout(r, 40));
    });

    const zoomedOutMin = uplot.scales.x!.min!;
    const zoomedOutMax = uplot.scales.x!.max!;
    const zoomedOutSpan = zoomedOutMax - zoomedOutMin;
    expect(zoomedOutSpan).toBeGreaterThan(zoomedInSpan);
  });

  it("AC2: Pan moves the viewport without changing its span and clamps at capture bounds", async () => {
    const uplot = await mountUi();
    const over = host.querySelector(".u-over") as HTMLDivElement;
    expect(over).not.toBeNull();

    const capture = useCaptureStore.getState().capture!;
    const tMin = capture.timestamps[0]!;
    const tMax = capture.timestamps[capture.timestamps.length - 1]!;

    // First zoom into a 20% window in the middle
    const mid = (tMin + tMax) / 2;
    const windowSpan = (tMax - tMin) * 0.2;
    await act(async () => {
      uplot.setScale("x", {
        min: mid - windowSpan / 2,
        max: mid + windowSpan / 2,
      });
      await new Promise((r) => setTimeout(r, 40));
    });

    const startXMin = uplot.scales.x!.min!;
    const startXMax = uplot.scales.x!.max!;
    const startSpan = startXMax - startXMin;

    const rect = over.getBoundingClientRect();
    const startClientX = rect.left + rect.width * 0.5;
    const startClientY = rect.top + rect.height * 0.5;

    // Middle-click drag pan to the left by 100px (dragging waveform left -> moving later times into view)
    await act(async () => {
      over.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 1, // Middle click
          buttons: 4,
          clientX: startClientX,
          clientY: startClientY,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          buttons: 4,
          clientX: startClientX - 100,
          clientY: startClientY,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 1,
          clientX: startClientX - 100,
          clientY: startClientY,
        }),
      );
      await new Promise((r) => setTimeout(r, 40));
    });

    const pannedMin = uplot.scales.x!.min!;
    const pannedMax = uplot.scales.x!.max!;
    const pannedSpan = pannedMax - pannedMin;

    // Span is strictly preserved
    expect(pannedSpan).toBeCloseTo(startSpan, 6);
    // Viewport moved to the right (later timestamps)
    expect(pannedMin).toBeGreaterThan(startXMin);

    // Shift + Left-click drag pan in the opposite direction (+200px)
    await act(async () => {
      over.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          shiftKey: true,
          clientX: startClientX,
          clientY: startClientY,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          buttons: 1,
          shiftKey: true,
          clientX: startClientX + 200,
          clientY: startClientY,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 0,
          shiftKey: true,
          clientX: startClientX + 200,
          clientY: startClientY,
        }),
      );
      await new Promise((r) => setTimeout(r, 40));
    });

    const shiftPannedMin = uplot.scales.x!.min!;
    const shiftPannedMax = uplot.scales.x!.max!;
    expect(shiftPannedMax - shiftPannedMin).toBeCloseTo(startSpan, 6);
    expect(shiftPannedMin).toBeLessThan(pannedMin);

    // Test clamping at bounds: pan aggressively far to the left (try to go before tMin)
    await act(async () => {
      over.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 1,
          buttons: 4,
          clientX: startClientX,
          clientY: startClientY,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          buttons: 4,
          clientX: startClientX + 5000, // Massive drag right
          clientY: startClientY,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 1,
          clientX: startClientX + 5000,
          clientY: startClientY,
        }),
      );
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(uplot.scales.x!.min!).toBeCloseTo(tMin, 5);
    expect(uplot.scales.x!.max! - uplot.scales.x!.min!).toBeCloseTo(
      startSpan,
      6,
    );
  });

  it("AC3: Escape cancels active pan and restores pre-pan bounds", async () => {
    const uplot = await mountUi();
    const over = host.querySelector(".u-over") as HTMLDivElement;
    expect(over).not.toBeNull();

    const capture = useCaptureStore.getState().capture!;
    const tMin = capture.timestamps[0]!;
    const tMax = capture.timestamps[capture.timestamps.length - 1]!;
    const mid = (tMin + tMax) / 2;
    const windowSpan = (tMax - tMin) * 0.3;

    await act(async () => {
      uplot.setScale("x", {
        min: mid - windowSpan / 2,
        max: mid + windowSpan / 2,
      });
      await new Promise((r) => setTimeout(r, 40));
    });

    const initialMin = uplot.scales.x!.min!;
    const initialMax = uplot.scales.x!.max!;

    const rect = over.getBoundingClientRect();
    const startClientX = rect.left + rect.width * 0.5;
    const startClientY = rect.top + rect.height * 0.5;

    // Start drag
    await act(async () => {
      over.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 1,
          buttons: 4,
          clientX: startClientX,
          clientY: startClientY,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          buttons: 4,
          clientX: startClientX + 150,
          clientY: startClientY,
        }),
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    // Panned mid-drag
    expect(uplot.scales.x!.min!).not.toBe(initialMin);

    // Press Escape during pan
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await new Promise((r) => setTimeout(r, 40));
    });

    // Restores original bounds exactly
    expect(uplot.scales.x!.min!).toBe(initialMin);
    expect(uplot.scales.x!.max!).toBe(initialMax);
  });

  it("AC3: Box-zoom coexists without conflicts (plain drag zooms both axes)", async () => {
    const uplot = await mountUi();
    const over = host.querySelector(".u-over") as HTMLDivElement;
    expect(over).not.toBeNull();

    const initialXMin = uplot.scales.x!.min!;
    const initialXMax = uplot.scales.x!.max!;
    const rect = over.getBoundingClientRect();

    // Plain drag (no shift, no ctrl, button 0) performs box-zoom
    await act(async () => {
      over.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: rect.left + 50,
          clientY: rect.top + 50,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          buttons: 1,
          clientX: rect.left + 200,
          clientY: rect.top + 200,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 0,
          clientX: rect.left + 200,
          clientY: rect.top + 200,
        }),
      );
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(uplot.scales.x!.min!).not.toBe(initialXMin);
    expect(uplot.scales.x!.max!).not.toBe(initialXMax);
  });

  it("AC4: Gesture discoverability is addressed on canvas container and Reset View button", async () => {
    await mountUi();

    const container = host.querySelector(
      "[data-testid='oscilloscope-container']",
    ) as HTMLElement;
    expect(container).not.toBeNull();
    expect(container.getAttribute("role")).toBe("region");
    expect(container.getAttribute("aria-label")).toContain(
      NAVIGATION_HELP_SUMMARY,
    );
    expect(container.getAttribute("title")).toBe(NAVIGATION_HELP_SUMMARY);

    const resetBtn = host.querySelector(
      "[data-testid='reset-view-button']",
    ) as HTMLButtonElement;
    expect(resetBtn).not.toBeNull();
    expect(resetBtn.getAttribute("aria-label")).toContain(
      NAVIGATION_HELP_SUMMARY,
    );
    expect(resetBtn.getAttribute("title")).toContain(NAVIGATION_HELP_SUMMARY);
  });

  it("Double-click on canvas resets view to full capture fit", async () => {
    const uplot = await mountUi();
    const over = host.querySelector(".u-over") as HTMLDivElement;
    expect(over).not.toBeNull();

    // Zoom in first
    const capture = useCaptureStore.getState().capture!;
    const tMin = capture.timestamps[0]!;
    const tMax = capture.timestamps[capture.timestamps.length - 1]!;
    await act(async () => {
      uplot.setScale("x", {
        min: (tMin + tMax) / 2,
        max: (tMin + tMax) / 2 + 0.001,
      });
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(uplot.scales.x!.max! - uplot.scales.x!.min!).toBeCloseTo(0.001, 5);

    // Double-click canvas
    await act(async () => {
      over.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, button: 0 }),
      );
      await new Promise((r) => setTimeout(r, 100));
    });

    // Reset back to full span
    expect(uplot.scales.x!.max! - uplot.scales.x!.min!).toBeCloseTo(
      tMax - tMin,
      4,
    );
  });
});
