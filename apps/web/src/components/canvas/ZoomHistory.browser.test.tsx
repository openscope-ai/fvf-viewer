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
import { useZoomHistoryStore } from "../../state/zoomHistoryStore";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching ${url}`).toBeTruthy();
  return response.arrayBuffer();
}

describe("Zoom and pan viewport history (Issue #287)", () => {
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
    useZoomHistoryStore.getState().reset();

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

  it("AC1 & AC2: Box zoom, pan, wheel zoom and Reset View push entries; back/forward restores viewport", async () => {
    const uplot = await mountUi();
    const over = host.querySelector(".u-over") as HTMLDivElement;
    expect(over).not.toBeNull();

    const backBtn = host.querySelector(
      '[data-testid="zoom-history-back"]',
    ) as HTMLButtonElement;
    const forwardBtn = host.querySelector(
      '[data-testid="zoom-history-forward"]',
    ) as HTMLButtonElement;

    expect(backBtn).not.toBeNull();
    expect(forwardBtn).not.toBeNull();

    // Initial state: initial fit is captured as entry 0
    expect(backBtn.disabled).toBe(true);
    expect(forwardBtn.disabled).toBe(true);

    const initialXMin = uplot.scales.x!.min!;
    const initialXMax = uplot.scales.x!.max!;
    const initialYMin = uplot.scales.y0!.min!;
    const initialYMax = uplot.scales.y0!.max!;
    expect(initialYMin).toBeDefined();
    expect(initialYMax).toBeDefined();

    const rect = over.getBoundingClientRect();

    // 1. Perform a Box-zoom to zoom into the waveform (modifying both X and Y)
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
          clientX: rect.left + 250,
          clientY: rect.top + 200,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 0,
          clientX: rect.left + 250,
          clientY: rect.top + 200,
        }),
      );
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(useZoomHistoryStore.getState().past.length).toBe(1);
    expect(backBtn.disabled).toBe(false);
    expect(forwardBtn.disabled).toBe(true);
    const boxZoomedXMin = uplot.scales.x!.min!;
    const boxZoomedXMax = uplot.scales.x!.max!;
    const boxZoomedYMin = uplot.scales.y0!.min!;
    const boxZoomedYMax = uplot.scales.y0!.max!;
    expect(boxZoomedXMin).not.toBeCloseTo(initialXMin, 4);
    expect(boxZoomedYMin).not.toBeCloseTo(initialYMin, 4);

    // 2. Perform a Wheel zoom
    await act(async () => {
      over.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width * 0.5,
          clientY: rect.top + rect.height * 0.5,
          deltaY: -120,
        }),
      );
    });

    // Wait 400ms for debounced wheel settling
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    expect(useZoomHistoryStore.getState().past.length).toBe(2);
    const wheeledXMin = uplot.scales.x!.min!;
    const wheeledXMax = uplot.scales.x!.max!;
    expect(wheeledXMin).not.toBeCloseTo(boxZoomedXMin, 4);

    // 3. Perform a drag-pan (Middle-click drag)
    const panStartX = rect.left + rect.width * 0.5;
    const panStartY = rect.top + rect.height * 0.5;
    await act(async () => {
      over.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 1,
          buttons: 4,
          clientX: panStartX,
          clientY: panStartY,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          buttons: 4,
          clientX: panStartX - 60,
          clientY: panStartY,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 1,
          clientX: panStartX - 60,
          clientY: panStartY,
        }),
      );
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(useZoomHistoryStore.getState().past.length).toBe(3);
    const pannedXMin = uplot.scales.x!.min!;
    const pannedXMax = uplot.scales.x!.max!;
    expect(pannedXMin).not.toBeCloseTo(wheeledXMin, 4);

    // 4. Click Reset View
    const resetBtn = host.querySelector(
      '[data-testid="reset-view-button"]',
    ) as HTMLButtonElement;
    expect(resetBtn).not.toBeNull();
    await act(async () => {
      resetBtn.click();
    });

    expect(useZoomHistoryStore.getState().past.length).toBe(4);
    expect(uplot.scales.x!.min!).toBeCloseTo(initialXMin, 5);
    expect(uplot.scales.y0!.min!).toBeCloseTo(initialYMin, 5);

    // 5. Back navigation restores panned state
    await act(async () => {
      backBtn.click();
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(uplot.scales.x!.min!).toBeCloseTo(pannedXMin, 5);
    expect(uplot.scales.x!.max!).toBeCloseTo(pannedXMax, 5);
    expect(forwardBtn.disabled).toBe(false);

    // 6. Back navigation restores wheeled state
    await act(async () => {
      backBtn.click();
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(uplot.scales.x!.min!).toBeCloseTo(wheeledXMin, 5);
    expect(uplot.scales.x!.max!).toBeCloseTo(wheeledXMax, 5);

    // 7. Back navigation restores box-zoomed state (both X and Y)
    await act(async () => {
      backBtn.click();
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(uplot.scales.x!.min!).toBeCloseTo(boxZoomedXMin, 5);
    expect(uplot.scales.x!.max!).toBeCloseTo(boxZoomedXMax, 5);
    expect(uplot.scales.y0!.min!).toBeCloseTo(boxZoomedYMin, 5);
    expect(uplot.scales.y0!.max!).toBeCloseTo(boxZoomedYMax, 5);

    // 8. Back navigation restores initial fit state (both X and Y)
    await act(async () => {
      backBtn.click();
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(uplot.scales.x!.min!).toBeCloseTo(initialXMin, 5);
    expect(uplot.scales.x!.max!).toBeCloseTo(initialXMax, 5);
    expect(uplot.scales.y0!.min!).toBeCloseTo(initialYMin, 5);
    expect(uplot.scales.y0!.max!).toBeCloseTo(initialYMax, 5);
    expect(backBtn.disabled).toBe(true);

    // 9. Forward navigation steps forward to box-zoomed state
    await act(async () => {
      forwardBtn.click();
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(uplot.scales.x!.min!).toBeCloseTo(boxZoomedXMin, 5);
    expect(uplot.scales.y0!.min!).toBeCloseTo(boxZoomedYMin, 5);
  });

  it("AC3: New navigation truncates forward history", async () => {
    await mountUi();
    const over = host.querySelector(".u-over") as HTMLDivElement;
    const rect = over.getBoundingClientRect();
    const backBtn = host.querySelector(
      '[data-testid="zoom-history-back"]',
    ) as HTMLButtonElement;
    const forwardBtn = host.querySelector(
      '[data-testid="zoom-history-forward"]',
    ) as HTMLButtonElement;

    // Wheel zoom 1
    await act(async () => {
      over.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + 200,
          clientY: rect.top + 100,
          deltaY: -120,
        }),
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    // Wheel zoom 2
    await act(async () => {
      over.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + 200,
          clientY: rect.top + 100,
          deltaY: -120,
        }),
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    expect(useZoomHistoryStore.getState().past.length).toBe(2);

    // Go back once
    await act(async () => {
      backBtn.click();
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(forwardBtn.disabled).toBe(false);
    expect(useZoomHistoryStore.getState().future.length).toBe(1);

    // New navigation: Reset View
    const resetBtn = host.querySelector(
      '[data-testid="reset-view-button"]',
    ) as HTMLButtonElement;
    await act(async () => {
      resetBtn.click();
      await new Promise((r) => setTimeout(r, 40));
    });

    // Forward history must be truncated!
    expect(useZoomHistoryStore.getState().future.length).toBe(0);
    expect(forwardBtn.disabled).toBe(true);
  });

  it("AC4: Loading a new capture resets zoom history", async () => {
    await mountUi();
    const over = host.querySelector(".u-over") as HTMLDivElement;
    const rect = over.getBoundingClientRect();

    // Wheel zoom to add history
    await act(async () => {
      over.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + 200,
          clientY: rect.top + 100,
          deltaY: -120,
        }),
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    expect(useZoomHistoryStore.getState().past.length).toBe(1);

    // Load new capture
    await act(async () => {
      await useCaptureStore
        .getState()
        .parseBuffer(await fixture(fourChUrl), "another.fvf");
      await new Promise((r) => setTimeout(r, 80));
    });

    // History must be reset (with entry 0 initialized for the new capture)
    expect(useZoomHistoryStore.getState().past.length).toBe(0);
    expect(useZoomHistoryStore.getState().future.length).toBe(0);
    expect(useZoomHistoryStore.getState().canGoBack).toBe(false);
    expect(useZoomHistoryStore.getState().canGoForward).toBe(false);
  });

  it("Keyboard shortcuts Alt+Left and Alt+Right navigate history", async () => {
    const uplot = await mountUi();
    const over = host.querySelector(".u-over") as HTMLDivElement;
    const rect = over.getBoundingClientRect();

    const initialXMin = uplot.scales.x!.min!;

    // Wheel zoom
    await act(async () => {
      over.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + 200,
          clientY: rect.top + 100,
          deltaY: -120,
        }),
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    const wheeledXMin = uplot.scales.x!.min!;
    expect(wheeledXMin).not.toBeCloseTo(initialXMin, 4);

    // Trigger Alt+Left
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowLeft",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(uplot.scales.x!.min!).toBeCloseTo(initialXMin, 5);

    // Trigger Alt+Right
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(uplot.scales.x!.min!).toBeCloseTo(wheeledXMin, 5);
  });
});
