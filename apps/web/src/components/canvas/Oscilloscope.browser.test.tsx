import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import uPlot from "uplot";
import fourChUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import mixedCurrentUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-2ch-current-offcenter-1s-div.fvf.bin?url";
import Oscilloscope, {
  CHANNEL_PALETTE,
  THEME_COLORS,
  computeCaptureFit,
  getChannelColor,
} from "./Oscilloscope";
import { yScaleKey } from "../../capture/channelUnits";
import { LIGHT_THEME } from "./themePalette";
import {
  useThemeStore,
  VIEWPORT_THEME_STORAGE_KEY,
} from "../../state/themeStore";
import {
  usePaletteStore,
  CHANNEL_PALETTE_STORAGE_KEY,
} from "../../state/paletteStore";
import WaveformToolbar from "../toolbar/WaveformToolbar";
import { BOX_ZOOM_MIN_DRAG_PX } from "./plugins/boxZoomPlugin";
import { useCaptureStore } from "../../state/captureStore";
import { useViewportStore } from "../../state/viewportStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import type { ParsedCapture } from "../../types/capture";
import App from "../../App";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching ${url}`).toBeTruthy();
  return response.arrayBuffer();
}

function resolveStroke(
  stroke: unknown,
  uplot: uPlot,
  seriesIdx: number,
): string {
  if (typeof stroke === "function") {
    return stroke(uplot, seriesIdx);
  }
  return String(stroke);
}

describe("Oscilloscope canvas wrapper (browser)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
    useChannelNamesStore.setState({ fileKey: null, names: {} });
    window.localStorage.clear();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();

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
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
    useChannelNamesStore.setState({ fileKey: null, names: {} });
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
    window.localStorage.clear();
  });

  it("AC-2: Theme and trace colors match the architecture.md palette exactly", async () => {
    // 1. Static palette checks matching architecture.md §4.1
    expect(CHANNEL_PALETTE["A"]).toBe("#FFD700");
    expect(CHANNEL_PALETTE["B"]).toBe("#00BFFF");
    expect(CHANNEL_PALETTE["C"]).toBe("#FF4500");
    expect(CHANNEL_PALETTE["D"]).toBe("#00FF7F");
    expect(getChannelColor("A")).toBe("#FFD700");
    expect(getChannelColor("Input A")).toBe("#FFD700");
    expect(getChannelColor("B")).toBe("#00BFFF");
    expect(getChannelColor("Input B")).toBe("#00BFFF");
    expect(getChannelColor("C")).toBe("#FF4500");
    expect(getChannelColor("Input C")).toBe("#FF4500");
    expect(getChannelColor("D")).toBe("#00FF7F");
    expect(getChannelColor("Input D")).toBe("#00FF7F");

    // Dark OLED theme constants
    expect(THEME_COLORS.background).toBe("#000000");
    expect(THEME_COLORS.grid).toBe("#222222");
    expect(THEME_COLORS.ticks).toBe("#333333");
    expect(THEME_COLORS.axisText).toBe("#888888");
    expect(THEME_COLORS.cursor1).toBe("#E040FB");
    expect(THEME_COLORS.cursor2).toBe("#B0B0B0");

    // 2. Render real 4-channel capture and verify uPlot series stroke colors
    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(fourChUrl), "four.fvf");
    const capture = useCaptureStore.getState().capture!;

    let mountedUplot: uPlot | null = null;

    await act(async () => {
      root.render(
        <Oscilloscope
          capture={capture}
          onUPlotInit={(u) => {
            mountedUplot = u;
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(mountedUplot).not.toBeNull();
    const uplot = mountedUplot!;

    // Series 0 is X-axis, Series 1..4 are channels A..D
    expect(resolveStroke(uplot.series[1]?.stroke, uplot, 1)).toBe("#FFD700");
    expect(resolveStroke(uplot.series[2]?.stroke, uplot, 2)).toBe("#00BFFF");
    expect(resolveStroke(uplot.series[3]?.stroke, uplot, 3)).toBe("#FF4500");
    expect(resolveStroke(uplot.series[4]?.stroke, uplot, 4)).toBe("#00FF7F");

    // Grid strokes
    expect(resolveStroke(uplot.axes[0]?.grid?.stroke, uplot, 0)).toBe(
      "#222222",
    );
    expect(resolveStroke(uplot.axes[1]?.grid?.stroke, uplot, 1)).toBe(
      "#222222",
    );

    // Pure black background on DOM element
    const container = hostElement.querySelector(
      ".oscilloscope-container",
    ) as HTMLElement;
    expect(container).not.toBeNull();
    const bg = window.getComputedStyle(container).backgroundColor;
    expect(bg === "rgb(0, 0, 0)" || bg === "#000000").toBe(true);
  });

  it("AC-3: uPlot consumes typed arrays without intermediate JS array copies", async () => {
    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(fourChUrl), "four.fvf");
    const capture = useCaptureStore.getState().capture!;

    let mountedUplot: uPlot | null = null;

    await act(async () => {
      root.render(
        <Oscilloscope
          capture={capture}
          onUPlotInit={(u) => {
            mountedUplot = u;
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(mountedUplot).not.toBeNull();
    const uplot = mountedUplot!;

    // ZERO-COPY ASSERTION: the timestamp buffer crosses into uPlot by
    // reference; channel lanes are the NaN edge-clipped display copies
    // (issue #106 — value-identical here, the fixture has no saturation).
    expect(uplot.data[0]).toBe(capture.timestamps);
    for (let seriesIdx = 1; seriesIdx <= 4; seriesIdx += 1) {
      expect(uplot.data[seriesIdx]).not.toBe(
        capture.channels[seriesIdx - 1]!.data,
      );
      expect(Array.from(uplot.data[seriesIdx] as Float32Array)).toEqual(
        Array.from(capture.channels[seriesIdx - 1]!.data),
      );
    }

    // Verify all are typed Float32Arrays with 10,000 samples
    expect(uplot.data[0]).toBeInstanceOf(Float32Array);
    expect((uplot.data[0] as Float32Array).length).toBe(10000);
    expect((uplot.data[1] as Float32Array).length).toBe(10000);

    // Test channel visibility toggling via setSeries WITHOUT recreating uPlot instance
    const initialInstance = mountedUplot;
    expect(uplot.series[1]?.show).toBe(true);

    // Toggle Channel A off
    await act(async () => {
      useViewportStore.getState().toggleChannel("A");
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(uplot.series[1]?.show).toBe(false);
    expect(uplot.series[2]?.show).toBe(true);
    // Crucial: Instance identity preserved (no canvas recreation!)
    const currentContainer = hostElement.querySelector(
      ".oscilloscope-container",
    ) as HTMLElement & { __uplot?: uPlot };
    expect(currentContainer.__uplot).toBe(initialInstance);

    // Toggle Channel A back on
    await act(async () => {
      useViewportStore.getState().toggleChannel("A");
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(uplot.series[1]?.show).toBe(true);
    expect(currentContainer.__uplot).toBe(initialInstance);
  });

  it("AC-1: A parsed capture renders all channels at 60 FPS during window resize", async () => {
    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(fourChUrl), "four.fvf");
    const capture = useCaptureStore.getState().capture!;

    let mountedUplot: uPlot | null = null;

    await act(async () => {
      root.render(
        <Oscilloscope
          capture={capture}
          onUPlotInit={(u) => {
            mountedUplot = u;
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(mountedUplot).not.toBeNull();
    const uplot = mountedUplot!;
    const initialInstance = mountedUplot;

    // Verify canvas elements exist in DOM
    const canvasElements = hostElement.querySelectorAll("canvas");
    expect(canvasElements.length).toBeGreaterThan(0);

    // Simulate resizing container
    hostElement.style.width = "1200px";
    hostElement.style.height = "750px";

    await act(async () => {
      // Trigger resize via ResizeObserver / window event
      window.dispatchEvent(new Event("resize"));
      await new Promise((r) => setTimeout(r, 80));
    });

    // Verify instance was not destroyed and recreated
    const currentContainer = hostElement.querySelector(
      ".oscilloscope-container",
    ) as HTMLElement & { __uplot?: uPlot };
    expect(currentContainer.__uplot).toBe(initialInstance);

    // Verify fast resize: a single resize cycle operates in << 16.6ms frame budget
    // Direct setSize execution on uPlot takes < 2ms
    const tDirect0 = performance.now();
    uplot.setSize({ width: 1024, height: 600 });
    const directElapsed = performance.now() - tDirect0;

    expect(directElapsed).toBeLessThan(16.6); // 60 FPS frame ceiling is 16.6ms
    expect(uplot.width).toBe(1024);
    expect(uplot.height).toBe(600);
  });

  it("decoupled viewport sync: updates bounds in viewportStore on uPlot scale changes", async () => {
    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(fourChUrl), "four.fvf");
    const capture = useCaptureStore.getState().capture!;

    let mountedUplot: uPlot | null = null;

    await act(async () => {
      root.render(
        <Oscilloscope
          capture={capture}
          onUPlotInit={(u) => {
            mountedUplot = u;
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    const uplot = mountedUplot!;
    expect(uplot).not.toBeNull();

    // Initial scale bounds are synced to viewportStore
    const initialBounds = useViewportStore.getState();
    expect(initialBounds.xMin).not.toBeNull();
    expect(initialBounds.xMax).not.toBeNull();

    // Trigger scale change in uPlot (native interaction zoom/pan)
    await act(async () => {
      uplot.batch(() => {
        uplot.setScale("x", { min: -0.02, max: 0.02 });
      });
      await new Promise((r) => setTimeout(r, 60));
    });

    const updatedBounds = useViewportStore.getState();
    expect(updatedBounds.xMin).toBe(-0.02);
    expect(updatedBounds.xMax).toBe(0.02);
  });

  async function mountCapture(): Promise<{
    capture: NonNullable<
      ReturnType<typeof useCaptureStore.getState>["capture"]
    >;
    uplot: uPlot;
  }> {
    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(fourChUrl), "four.fvf");
    const capture = useCaptureStore.getState().capture!;

    let mountedUplot: uPlot | null = null;

    await act(async () => {
      root.render(
        <Oscilloscope
          capture={capture}
          onUPlotInit={(u) => {
            mountedUplot = u;
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(mountedUplot).not.toBeNull();
    return { capture, uplot: mountedUplot! };
  }

  it("AC: toggling channel visibility updates trace display without modifying any Y-scale min/max bounds", async () => {
    const { capture, uplot } = await mountCapture();
    const initialInstance = uplot;

    // Pre-toggle per-channel scales (initial view is the full-capture fit)
    const yBefore = yScaleSnapshot(uplot);
    expect(Object.keys(yBefore)).toEqual(["y0", "y1", "y2", "y3"]);
    expect(uplot.series[1]?.show).toBe(true);
    expect(uplot.series[4]?.show).toBe(true);

    // Hide Channels A and D
    await act(async () => {
      useViewportStore.getState().toggleChannel("A");
      useViewportStore.getState().toggleChannel("D");
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(uplot.series[1]?.show).toBe(false);
    expect(uplot.series[4]?.show).toBe(false);
    expect(uplot.series[2]?.show).toBe(true);
    expect(uplot.series[3]?.show).toBe(true);

    // Every Y-scale min/max bound is exactly untouched by the toggles
    expectYScalesUnchanged(uplot, yBefore);
    // The rendered axis follows the new owner (B on y1) and the store
    // mirrors it.
    expect(useViewportStore.getState().selectedChannel).toBe("B");
    const storeState = useViewportStore.getState();
    expect(storeState.yMin).toBe(yBefore["y1"]!.min);
    expect(storeState.yMax).toBe(yBefore["y1"]!.max);

    // No canvas recreation happened
    const container = hostElement.querySelector(
      ".oscilloscope-container",
    ) as HTMLElement & { __uplot?: uPlot };
    expect(container.__uplot).toBe(initialInstance);
    expect(capture.channels.length).toBe(4);

    // Toggle back on: still no rescale, axis returns to A
    await act(async () => {
      useViewportStore.getState().toggleChannel("A");
      useViewportStore.getState().toggleChannel("D");
      useViewportStore.getState().setSelectedChannel("A");
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(uplot.series[1]?.show).toBe(true);
    expect(uplot.series[4]?.show).toBe(true);
    expectYScalesUnchanged(uplot, yBefore);
    expect(useViewportStore.getState().selectedChannel).toBe("A");
    const restored = useViewportStore.getState();
    expect(restored.yMin).toBe(yBefore["y0"]!.min);
    expect(restored.yMax).toBe(yBefore["y0"]!.max);
    expect(container.__uplot).toBe(initialInstance);
  });

  it("AC: Fit Waveform restores full capture timestamp bounds on X and per-channel optimal dynamic margins on every Y scale", async () => {
    const { capture, uplot } = await mountCapture();

    // Simulate a zoomed-in viewport (native drag zoom drives setScale too)
    await act(async () => {
      uplot.batch(() => {
        uplot.setScale("x", { min: -0.01, max: 0.01 });
        uplot.setScale("y0", { min: -0.5, max: 0.5 });
      });
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(uplot.scales.x!.min!).toBe(-0.01);
    expect(uplot.scales["y0"]!.min!).toBe(-0.5);

    // Hide Channel A: the axis owner moves to B while every channel keeps
    // its own zoomed bounds until the explicit fit.
    await act(async () => {
      useViewportStore.getState().toggleChannel("A");
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(useViewportStore.getState().selectedChannel).toBe("B");

    await act(async () => {
      useViewportStore.getState().requestFit();
      await new Promise((r) => setTimeout(r, 60));
    });

    // Every channel scale returns to its own fit — never a blended pool.
    const expected = computeCaptureFit(capture);
    expect(uplot.scales.x!.min!).toBe(expected.xMin);
    expect(uplot.scales.x!.max!).toBe(expected.xMax);
    capture.channels.forEach((_channel, index) => {
      const key = yScaleKey(index);
      expect(uplot.scales[key]!.min!).toBe(expected.channels[index]!.min);
      expect(uplot.scales[key]!.max!).toBe(expected.channels[index]!.max);
    });

    // Full capture timestamp range on X
    expect(expected.xMin).toBe(capture.timestamps[0]);
    expect(expected.xMax).toBe(
      capture.timestamps[capture.timestamps.length - 1],
    );

    // Store mirrors the fitted bounds of the axis owner (B on y1)
    const storeState = useViewportStore.getState();
    expect(storeState.xMin).toBe(expected.xMin);
    expect(storeState.xMax).toBe(expected.xMax);
    expect(storeState.yMin).toBe(expected.channels[1]!.min);
    expect(storeState.yMax).toBe(expected.channels[1]!.max);

    // Y margins are strictly wider than the raw data extent of channel B
    let rawMin = Number.POSITIVE_INFINITY;
    let rawMax = Number.NEGATIVE_INFINITY;
    for (const value of capture.channels[1]!.data) {
      if (value < rawMin) rawMin = value;
      if (value > rawMax) rawMax = value;
    }
    expect(expected.channels[1]!.min).toBeLessThan(rawMin);
    expect(expected.channels[1]!.max).toBeGreaterThan(rawMax);
  });

  it("AC1-AC4 (#129): computeCaptureFit and uPlot initial mount align the zero value of all y-axes at vertical center", async () => {
    const { uplot, capture } = await mountCapture();

    // AC1: Every channel's Y axis scale is symmetric around zero
    capture.channels.forEach((_channel, index) => {
      const scale = uplot.scales[yScaleKey(index)]!;
      expect(scale.min).toBeDefined();
      expect(scale.max).toBeDefined();
      expect(scale.min!).toBe(-scale.max!);
      expect(scale.min!).toBeLessThan(0);
      expect(scale.max!).toBeGreaterThan(0);
      // Zero position is exactly 50%
      const zeroFraction = (0 - scale.min!) / (scale.max! - scale.min!);
      expect(zeroFraction).toBeCloseTo(0.5, 6);
    });

    // AC2: Fit Waveform restores zero-aligned symmetric bounds
    await act(async () => {
      useViewportStore.getState().requestFit();
      await new Promise((r) => setTimeout(r, 60));
    });
    capture.channels.forEach((_channel, index) => {
      const scale = uplot.scales[yScaleKey(index)]!;
      expect(scale.min!).toBe(-scale.max!);
    });

    // AC3: Flatlined at zero or all-NaN fallback to [-1, 1]
    const syntheticCapture: ParsedCapture = {
      ...capture,
      channels: [
        {
          name: "A",
          label: "Input A",
          derived: false,
          data: new Float32Array([0, 0, 0]),
        },
        {
          name: "B",
          label: "Input B",
          derived: false,
          data: new Float32Array([Number.NaN, Number.NaN]),
        },
        {
          name: "C",
          label: "Input C",
          derived: false,
          data: new Float32Array([10, 20, 30]),
        },
      ],
    };
    const fit = computeCaptureFit(syntheticCapture);
    expect(fit.channels[0]).toEqual({ min: -1, max: 1 });
    expect(fit.channels[1]).toEqual({ min: -1, max: 1 });
    expect(fit.channels[2]!.min).toBe(-fit.channels[2]!.max);
    expect(fit.channels[2]!.max).toBeCloseTo(30 * 1.05, 5);
  });

  it("AC: wheel events over the canvas never mutate axis scales", async () => {
    const { uplot } = await mountCapture();

    const xMinBefore = uplot.scales.x!.min!;
    const xMaxBefore = uplot.scales.x!.max!;
    const yBefore = yScaleSnapshot(uplot);

    const canvas = hostElement.querySelector(
      ".oscilloscope-container canvas",
    ) as HTMLCanvasElement;
    expect(canvas).not.toBeNull();

    // Wheel events with positive/negative deltas over the canvas
    let prevented = 0;
    for (const deltaY of [-120, 120, -1, 1]) {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY,
      });
      canvas.dispatchEvent(event);
      if (event.defaultPrevented) prevented++;
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    // Every wheel event was explicitly cancelled (wheel zoom disabled)
    expect(prevented).toBe(4);

    // X and every Y scale min/max are unchanged
    expect(uplot.scales.x!.min!).toBe(xMinBefore);
    expect(uplot.scales.x!.max!).toBe(xMaxBefore);
    expectYScalesUnchanged(uplot, yBefore);
  });

  // ---------------------------------------------------------------------
  // Issue #13: rectangular box-zoom plugin
  // ---------------------------------------------------------------------

  function dispatchMouse(
    target: EventTarget,
    type: "mousedown" | "mousemove" | "mouseup",
    clientX: number,
    clientY: number,
    buttons: number,
  ): void {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
        buttons,
        clientX,
        clientY,
      }),
    );
  }

  interface ScaleSnapshot {
    xMin: number | null;
    xMax: number | null;
    yMin: number | null;
    yMax: number | null;
    /** One entry per channel scale (`y0`, `y1`, ...). */
    yScales: Record<string, { min: number | null; max: number | null }>;
  }

  /** Committed bounds of every channel Y scale keyed by scale key. */
  function yScaleSnapshot(
    uplot: uPlot,
  ): Record<string, { min: number | null; max: number | null }> {
    return Object.fromEntries(
      Object.entries(uplot.scales)
        // uPlot always instantiates an unused default "y" scale alongside
        // the per-channel yN scales; only the latter carry traces.
        .filter(([key]) => key !== "x" && key !== "y")
        .map(([key, scale]) => [
          key,
          { min: scale.min ?? null, max: scale.max ?? null },
        ]),
    );
  }

  function expectYScalesUnchanged(
    uplot: uPlot,
    before: Record<string, { min: number | null; max: number | null }>,
  ): void {
    expect(yScaleSnapshot(uplot)).toEqual(before);
  }

  function snapshotScales(uplot: uPlot): ScaleSnapshot {
    return {
      xMin: uplot.scales.x?.min ?? null,
      xMax: uplot.scales.x?.max ?? null,
      yMin: uplot.scales[uplot.axes[1]?.scale ?? ""]?.min ?? null,
      yMax: uplot.scales[uplot.axes[1]?.scale ?? ""]?.max ?? null,
      yScales: yScaleSnapshot(uplot),
    };
  }

  function expectScalesUnchanged(uplot: uPlot, before: ScaleSnapshot): void {
    expect(uplot.scales.x?.min).toBe(before.xMin);
    expect(uplot.scales.x?.max).toBe(before.xMax);
    expect(yScaleSnapshot(uplot)).toEqual(before.yScales);
  }

  function boxZoomOverlay(): HTMLElement {
    const overlay = hostElement.querySelector(
      '[data-testid="box-zoom-overlay"]',
    ) as HTMLElement | null;
    expect(overlay).not.toBeNull();
    return overlay!;
  }

  /** Drags a selection rectangle across the plot area (plot-relative px). */
  async function dragBox(
    uplot: uPlot,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Promise<void> {
    const rect = uplot.over.getBoundingClientRect();
    await act(async () => {
      dispatchMouse(
        uplot.over,
        "mousedown",
        rect.left + from.x,
        rect.top + from.y,
        1,
      );
      dispatchMouse(
        uplot.over,
        "mousemove",
        rect.left + to.x,
        rect.top + to.y,
        1,
      );
      dispatchMouse(
        uplot.over,
        "mouseup",
        rect.left + to.x,
        rect.top + to.y,
        0,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  }

  /** Builds a synthetic multi-channel capture without touching the parser. */
  function makeSyntheticCapture(samples: number): ParsedCapture {
    const timestamps = new Float32Array(samples);
    for (let i = 0; i < samples; i += 1) {
      timestamps[i] = i * 1e-5;
    }
    const channels = ["A", "B", "C", "D"].map((name, channelIdx) => {
      const data = new Float32Array(samples);
      for (let i = 0; i < samples; i += 1) {
        data[i] =
          Math.sin((i / samples) * 2 * Math.PI * (channelIdx + 1) * 13) *
          (channelIdx + 1);
      }
      return { name, label: `Channel ${name}`, derived: false, data };
    });
    return {
      timestamps,
      channels,
      derivedChannels: [],
      warnings: [],
      metadata: {
        version: 1,
        flavor: "synthetic",
        timebaseRaw: "10us",
        secondsPerDiv: 0.001,
        timestamp14: "",
        samples,
        deltaT: 1e-5,
        channels: channels.map((channel) => ({
          name: channel.name,
          label: channel.label,
          derived: false,
          samples,
          deltaT: 1e-5,
        })),
      },
    };
  }

  it("AC: mouse drag with width < 8px or height < 8px clears selection and leaves scales unchanged", async () => {
    const { uplot } = await mountCapture();
    const overlay = boxZoomOverlay();
    expect(BOX_ZOOM_MIN_DRAG_PX).toBe(8);
    const before = snapshotScales(uplot);
    const rect = uplot.over.getBoundingClientRect();

    // Narrow drag: 4px wide (below threshold), tall enough
    await act(async () => {
      dispatchMouse(uplot.over, "mousedown", rect.left + 60, rect.top + 60, 1);
      dispatchMouse(uplot.over, "mousemove", rect.left + 64, rect.top + 200, 1);
    });
    // Live translucent overlay is rendered during the drag
    expect(overlay.style.display).toBe("block");
    await act(async () => {
      dispatchMouse(uplot.over, "mouseup", rect.left + 64, rect.top + 200, 0);
    });
    expect(overlay.style.display).toBe("none");
    expectScalesUnchanged(uplot, before);

    // Shallow drag: wide enough, 3px tall (below threshold)
    await act(async () => {
      dispatchMouse(uplot.over, "mousedown", rect.left + 60, rect.top + 60, 1);
      dispatchMouse(uplot.over, "mousemove", rect.left + 300, rect.top + 63, 1);
      dispatchMouse(uplot.over, "mouseup", rect.left + 300, rect.top + 63, 0);
    });
    expect(overlay.style.display).toBe("none");
    expectScalesUnchanged(uplot, before);
  });

  it("AC: pressing Escape during active box drag clears selection overlay and leaves X and Y scales unchanged", async () => {
    const { uplot } = await mountCapture();
    const overlay = boxZoomOverlay();
    const before = snapshotScales(uplot);
    const rect = uplot.over.getBoundingClientRect();

    await act(async () => {
      dispatchMouse(uplot.over, "mousedown", rect.left + 80, rect.top + 70, 1);
      dispatchMouse(
        uplot.over,
        "mousemove",
        rect.left + 380,
        rect.top + 260,
        1,
      );
    });
    expect(overlay.style.display).toBe("block");

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    // Selection overlay is fully cleared by the cancellation
    expect(overlay.style.display).toBe("none");

    // The cancelled drag must not zoom on the trailing mouseup
    await act(async () => {
      dispatchMouse(uplot.over, "mouseup", rect.left + 380, rect.top + 260, 0);
    });
    expectScalesUnchanged(uplot, before);
  });

  it("F3: window blur or lost mouse button clears box-zoom drag overlay without modifying scales", async () => {
    const { uplot } = await mountCapture();
    const overlay = boxZoomOverlay();
    const before = snapshotScales(uplot);
    const rect = uplot.over.getBoundingClientRect();

    // Start drag
    await act(async () => {
      dispatchMouse(uplot.over, "mousedown", rect.left + 80, rect.top + 70, 1);
      dispatchMouse(
        uplot.over,
        "mousemove",
        rect.left + 380,
        rect.top + 260,
        1,
      );
    });
    expect(overlay.style.display).toBe("block");

    // Blur window
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(overlay.style.display).toBe("none");
    expectScalesUnchanged(uplot, before);

    // Start another drag
    await act(async () => {
      dispatchMouse(uplot.over, "mousedown", rect.left + 80, rect.top + 70, 1);
      dispatchMouse(
        uplot.over,
        "mousemove",
        rect.left + 380,
        rect.top + 260,
        1,
      );
    });
    expect(overlay.style.display).toBe("block");

    // Move with buttons = 0 (button released outside window)
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: rect.left + 390,
          clientY: rect.top + 270,
          buttons: 0,
        }),
      );
    });
    expect(overlay.style.display).toBe("none");
    expectScalesUnchanged(uplot, before);
  });

  it("AC: 2D box drag updates X and every visible Y scale to dragged rectangle values", async () => {
    const { capture, uplot } = await mountCapture();

    // Expected values, independently converted from the pre-drag scales:
    // the same pixel band maps into each channel's own scale.
    const expXMin = uplot.posToVal(60, "x");
    const expXMax = uplot.posToVal(420, "x");
    const expY = capture.channels.map((_channel, index) => {
      const key = yScaleKey(index);
      return {
        key,
        min: uplot.posToVal(330, key),
        max: uplot.posToVal(90, key),
      };
    });

    await dragBox(uplot, { x: 60, y: 90 }, { x: 420, y: 330 });

    expect(uplot.scales.x?.min).toBe(expXMin);
    expect(uplot.scales.x?.max).toBe(expXMax);
    for (const { key, min, max } of expY) {
      expect(uplot.scales[key]?.min).toBe(min);
      expect(uplot.scales[key]?.max).toBe(max);
    }

    // The atomic multi-axis commit mirrors X plus the active channel (A)
    const store = useViewportStore.getState();
    expect(store.xMin).toBe(expXMin);
    expect(store.xMax).toBe(expXMax);
    expect(store.yMin).toBe(expY[0]!.min);
    expect(store.yMax).toBe(expY[0]!.max);
  });

  it("AC: multiple consecutive nested box-zooms maintain accurate value alignment without coordinate drift", async () => {
    const { capture, uplot } = await mountCapture();

    const zoomTargets = [
      { from: { x: 60, y: 90 }, to: { x: 420, y: 330 } },
      { from: { x: 120, y: 120 }, to: { x: 330, y: 280 } },
      { from: { x: 150, y: 150 }, to: { x: 300, y: 250 } },
    ];

    for (const { from, to } of zoomTargets) {
      // Expected values derived from the live (pre-zoom) scale state; the
      // plugin must land exactly there through its own posToVal pipeline.
      const expXMin = uplot.posToVal(from.x, "x");
      const expXMax = uplot.posToVal(to.x, "x");
      const expY = capture.channels.map((_channel, index) => {
        const key = yScaleKey(index);
        return {
          key,
          min: uplot.posToVal(to.y, key),
          max: uplot.posToVal(from.y, key),
        };
      });

      await dragBox(uplot, from, to);

      // Exact double-precision equality: any cumulative pixel drift would
      // surface here as a mismatch.
      expect(uplot.scales.x?.min).toBe(expXMin);
      expect(uplot.scales.x?.max).toBe(expXMax);
      for (const { key, min, max } of expY) {
        expect(uplot.scales[key]?.min).toBe(min);
        expect(uplot.scales[key]?.max).toBe(max);
      }
    }
  });

  it("AC: benchmark drag overlay mousemove frame duration on 4-channel 40,000-point capture (p95 < 16.6ms)", async () => {
    const capture = makeSyntheticCapture(40_000);
    let mountedUplot: uPlot | null = null;

    await act(async () => {
      root.render(
        <Oscilloscope
          capture={capture}
          onUPlotInit={(u) => {
            mountedUplot = u;
          }}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    const uplot = mountedUplot!;
    const rect = uplot.over.getBoundingClientRect();
    const overlay = boxZoomOverlay();
    const before = snapshotScales(uplot);

    await act(async () => {
      dispatchMouse(uplot.over, "mousedown", rect.left + 40, rect.top + 40, 1);
    });

    // Per-event main-thread cost attributable to the overlay drag path.
    // The overlay update is rAF-throttled, so a mousemove must never trigger
    // synchronous series redraws; a regression that re-renders the 4-channel
    // 40k-point chart per move would consume most of a frame per event and
    // blow the 16.6ms (60 FPS) budget.
    const moveCount = 120;
    const durations: number[] = [];
    for (let i = 0; i < moveCount; i += 1) {
      const px = 40 + (i % 40);
      const py = 40 + ((i * 7) % 300);
      const t0 = performance.now();
      dispatchMouse(uplot.over, "mousemove", rect.left + px, rect.top + py, 1);
      durations.push(performance.now() - t0);
    }
    durations.sort((a, b) => a - b);
    const p95 = durations[Math.ceil(0.95 * moveCount) - 1]!;
    expect(p95).toBeLessThan(16.6);

    // The overlay actually tracked the drag (last scheduled frame applied)
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(overlay.style.display).toBe("block");
    expect(parseFloat(overlay.style.width)).toBeGreaterThan(0);

    // Releasing the benchmark drag commits a valid zoom
    await act(async () => {
      dispatchMouse(uplot.over, "mouseup", rect.left + 79, rect.top + 300, 0);
    });
    expect(overlay.style.display).toBe("none");
    expect(uplot.scales.x?.min).not.toBe(before.xMin);
    expect(uplot.scales.x?.max).not.toBe(before.xMax);
  });

  // ---------------------------------------------------------------------
  // Issue #38: light/dark viewport theme toggle
  // ---------------------------------------------------------------------

  /**
   * Samples background pixels from the canvas gutters (outside the clipped
   * plot area, inside the drawClear fill rect). The 10k-point fixture's
   * traces dominate every in-plot pixel (later channels paint over earlier
   * ones), so the clipped gutter is the deterministic background signal.
   */
  function canvasBackgroundPixels(uplot: uPlot): number[][] {
    const ctx = uplot.ctx as CanvasRenderingContext2D;
    const points: number[][] = [];
    const samplePoints: Array<[number, number]> = [
      [2, 2],
      [10, 5],
      [2, Math.floor((uplot.bbox.height ?? 0) / 2)],
      [Math.floor((uplot.bbox.width ?? 0) / 2), 2],
    ];
    for (const [gx, gy] of samplePoints) {
      const data = ctx.getImageData(gx, gy, 1, 1).data;
      points.push([data[0]!, data[1]!, data[2]!]);
    }
    return points;
  }

  it("AC1-AC3 (#38): the theme toggle restyles the live canvas in place between Dark OLED and Light theme", async () => {
    // Parse a real capture, then render toolbar + oscilloscope together so
    // the toggle can be driven through the real UI control.
    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(fourChUrl), "four.fvf");
    const capture = useCaptureStore.getState().capture!;

    let mountedUplot: uPlot | null = null;
    await act(async () => {
      root.render(
        <>
          <WaveformToolbar />
          <Oscilloscope
            capture={capture}
            onUPlotInit={(u) => {
              mountedUplot = u;
            }}
          />
        </>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(mountedUplot).not.toBeNull();
    const uplot = mountedUplot!;
    const initialInstance = mountedUplot;

    const isBlack = (px: number[]) => px.every((v) => v === 0);
    const isWhite = (px: number[]) => px.every((v) => v === 255);

    // Dark OLED defaults
    const container = hostElement.querySelector(
      "[data-testid='oscilloscope-container']",
    ) as HTMLElement;
    expect(container.getAttribute("data-theme")).toBe("dark");
    expect(resolveStroke(uplot.axes[0]?.grid?.stroke, uplot, 0)).toBe(
      "#222222",
    );
    expect(resolveStroke(uplot.series[1]?.stroke, uplot, 1)).toBe("#FFD700");
    expect(canvasBackgroundPixels(uplot).some(isBlack)).toBe(true);

    // Toggle to Light theme through the real toolbar control
    const themeButton = hostElement.querySelector(
      "[data-testid='theme-toggle-button']",
    ) as HTMLButtonElement;
    expect(themeButton).not.toBeNull();

    await act(async () => {
      themeButton.click();
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(useThemeStore.getState().theme).toBe("light");

    // AC1: viewport switched to the Light theme (container + canvas pixels)
    expect(container.getAttribute("data-theme")).toBe("light");
    const bg = window.getComputedStyle(container).backgroundColor;
    expect(bg === "rgb(255, 255, 255)" || bg === "#FFFFFF").toBe(true);
    expect(canvasBackgroundPixels(uplot).some(isWhite)).toBe(true);
    expect(canvasBackgroundPixels(uplot).some(isBlack)).toBe(false);

    // AC2: high-contrast graticule + contrast-adapted trace strokes
    expect(resolveStroke(uplot.axes[0]?.grid?.stroke, uplot, 0)).toBe(
      LIGHT_THEME.grid,
    );
    expect(resolveStroke(uplot.axes[1]?.grid?.stroke, uplot, 1)).toBe(
      LIGHT_THEME.grid,
    );
    expect(resolveStroke(uplot.axes[0]?.stroke, uplot, 0)).toBe(
      LIGHT_THEME.axisText,
    );
    expect(resolveStroke(uplot.series[1]?.stroke, uplot, 1)).toBe(
      LIGHT_THEME.traces.A,
    );
    expect(resolveStroke(uplot.series[2]?.stroke, uplot, 2)).toBe(
      LIGHT_THEME.traces.B,
    );
    expect(resolveStroke(uplot.series[3]?.stroke, uplot, 3)).toBe(
      LIGHT_THEME.traces.C,
    );
    expect(resolveStroke(uplot.series[4]?.stroke, uplot, 4)).toBe(
      LIGHT_THEME.traces.D,
    );

    // AC3: no canvas recreation, no data re-parse
    const currentContainer = hostElement.querySelector(
      "[data-testid='oscilloscope-container']",
    ) as HTMLElement & { __uplot?: uPlot };
    expect(currentContainer.__uplot).toBe(initialInstance);
    expect(uplot.data[0]).toBe(capture.timestamps);
    for (const seriesIdx of [1, 4]) {
      expect(Array.from(uplot.data[seriesIdx] as Float32Array)).toEqual(
        Array.from(capture.channels[seriesIdx - 1]!.data),
      );
    }

    // Toggle back to dark: in-place restyle again, same instance
    await act(async () => {
      themeButton.click();
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(container.getAttribute("data-theme")).toBe("dark");
    expect(resolveStroke(uplot.axes[0]?.grid?.stroke, uplot, 0)).toBe(
      "#222222",
    );
    expect(resolveStroke(uplot.series[1]?.stroke, uplot, 1)).toBe("#FFD700");
    expect(canvasBackgroundPixels(uplot).some(isBlack)).toBe(true);
    expect(
      (
        hostElement.querySelector(
          "[data-testid='oscilloscope-container']",
        ) as HTMLElement & { __uplot?: uPlot }
      ).__uplot,
    ).toBe(initialInstance);
  });

  it("AC4 (#38): the selected theme persists across browser sessions in local storage", async () => {
    await mountCapture();
    // beforeEach resets to dark, which persists the default explicitly
    expect(window.localStorage.getItem(VIEWPORT_THEME_STORAGE_KEY)).toBe(
      "dark",
    );

    await act(async () => {
      useThemeStore.getState().toggleTheme();
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(useThemeStore.getState().theme).toBe("light");
    expect(window.localStorage.getItem(VIEWPORT_THEME_STORAGE_KEY)).toBe(
      "light",
    );
    expect(
      (
        hostElement.querySelector(
          "[data-testid='oscilloscope-container']",
        ) as HTMLElement
      ).getAttribute("data-theme"),
    ).toBe("light");

    // Simulate a fresh browser session: a new module registry hydrates a new
    // store instance from the persisted localStorage value.
    vi.resetModules();
    const fresh = await import("../../state/themeStore");
    expect(fresh.useThemeStore.getState().theme).toBe("light");

    // Leave the hydrated instance dark for hygiene; afterEach restores the
    // component-level store instance.
    fresh.useThemeStore.getState().setTheme("dark");
  });

  // ---------------------------------------------------------------------
  // Issue #40: user-configurable channel color palette
  // ---------------------------------------------------------------------

  /** Sets a React-controlled input's value and fires the input event. */
  function setReactInputValue(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("AC1-AC4 (#40/#204): popover palette edits apply in place, persist, and reset to the default palette", async () => {
    // Parse a real capture, then render toolbar + oscilloscope together so
    // the customization flows through the real badge-config popover.
    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(fourChUrl), "four.fvf");
    const capture = useCaptureStore.getState().capture!;

    let mountedUplot: uPlot | null = null;
    await act(async () => {
      root.render(
        <>
          <WaveformToolbar />
          <Oscilloscope
            capture={capture}
            onUPlotInit={(u) => {
              mountedUplot = u;
            }}
          />
        </>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(mountedUplot).not.toBeNull();
    const uplot = mountedUplot!;
    const initialInstance = mountedUplot;

    const container = hostElement.querySelector(
      "[data-testid='oscilloscope-container']",
    ) as HTMLElement & { __uplot?: uPlot };

    // The retired PaletteSettings panel is gone from the toolbar.
    expect(
      hostElement.querySelector("[data-testid='palette-settings-button']"),
    ).toBeNull();

    // Open Channel A's configuration popover via its gear and expand the
    // color detail through the hero square.
    await act(async () => {
      (
        hostElement.querySelector(
          "[data-testid='channel-gear-A']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(
      document.body.querySelector("[data-testid='badge-config-popover']"),
    ).not.toBeNull();
    await act(async () => {
      (
        document.body.querySelector(
          "[data-testid='hero-color-square']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });

    const yBefore = yScaleSnapshot(uplot);

    // AC1: hex text input customizes Channel A
    const hexA = document.body.querySelector(
      "[data-testid='config-hex']",
    ) as HTMLInputElement;
    await act(async () => {
      setReactInputValue(hexA, "#123456");
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(usePaletteStore.getState().customColors.A).toBe("#123456");
    expect(resolveStroke(uplot.series[1]?.stroke, uplot, 1)).toBe("#123456");

    // AC1: native color picker customizes cursor C1 (single-open: the
    // channel popover dismisses when the cursor popover opens)
    await act(async () => {
      (
        hostElement.querySelector(
          "[data-testid='cursor-gear-c1']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    await act(async () => {
      (
        document.body.querySelector(
          "[data-testid='hero-color-square']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    const pickerC1 = document.body.querySelector(
      "[data-testid='config-native-picker']",
    ) as HTMLInputElement;
    await act(async () => {
      setReactInputValue(pickerC1, "#00FFAA");
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(usePaletteStore.getState().customColors.C1).toBe("#00ffaa");

    // AC1: curated swatch customizes Channel B
    await act(async () => {
      (
        hostElement.querySelector(
          "[data-testid='channel-gear-B']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    await act(async () => {
      (
        document.body.querySelector(
          "[data-testid='hero-color-square']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    const swatchB = document.body.querySelector(
      "[data-testid='config-swatch-#FF4444']",
    ) as HTMLButtonElement;
    await act(async () => {
      swatchB.click();
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(usePaletteStore.getState().customColors.B).toBe("#ff4444");
    expect(resolveStroke(uplot.series[2]?.stroke, uplot, 2)).toBe("#ff4444");

    // AC2: updates applied in place — same uPlot instance, same timestamp
    // buffer, untouched Y scales (no canvas recreation, no data re-parse,
    // no rescale). The plotted lanes are the NaN edge-clipped display
    // copies (value-identical here: the fixture carries no saturation).
    expect(container.__uplot).toBe(initialInstance);
    expect(uplot.data[0]).toBe(capture.timestamps);
    expect(uplot.data[1]).not.toBe(capture.channels[0]!.data);
    expect(Array.from(uplot.data[1] as Float32Array)).toEqual(
      Array.from(capture.channels[0]!.data),
    );
    expectYScalesUnchanged(uplot, yBefore);
    // Untouched channels keep their dark-theme defaults
    expect(resolveStroke(uplot.series[4]?.stroke, uplot, 4)).toBe("#00FF7F");

    // Issue #204 AC4: per-key opacity renders as rgba() in the uPlot
    // series config (hex stays canonical at full opacity)
    await act(async () => {
      usePaletteStore.getState().setKeyOpacity("A", 50);
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(resolveStroke(uplot.series[1]?.stroke, uplot, 1)).toBe(
      "rgba(18, 52, 86, 0.50)",
    );
    await act(async () => {
      usePaletteStore.getState().setKeyOpacity("A", 100);
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(resolveStroke(uplot.series[1]?.stroke, uplot, 1)).toBe("#123456");

    // AC3: custom palette persists across browser sessions in local
    // storage (per-key { color } records, issue #204 shape)
    expect(
      JSON.parse(window.localStorage.getItem(CHANNEL_PALETTE_STORAGE_KEY)!),
    ).toEqual({
      A: { color: "#123456" },
      B: { color: "#ff4444" },
      C1: { color: "#00ffaa" },
    });
    vi.resetModules();
    const freshPalette = await import("../../state/paletteStore");
    expect(freshPalette.usePaletteStore.getState().customColors).toEqual({
      A: "#123456",
      B: "#ff4444",
      C1: "#00ffaa",
    });

    // AC4: full reset restores the architecture 4.1 default palette (the
    // retired panel's global button is covered by the per-key ↺ in the
    // toolbar test; the store action remains the sweep)
    await act(async () => {
      usePaletteStore.getState().resetPalette();
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(usePaletteStore.getState().customColors).toEqual({});
    expect(resolveStroke(uplot.series[1]?.stroke, uplot, 1)).toBe("#FFD700");
    expect(resolveStroke(uplot.series[2]?.stroke, uplot, 2)).toBe("#00BFFF");
    expect(resolveStroke(uplot.series[3]?.stroke, uplot, 3)).toBe("#FF4500");
    expect(resolveStroke(uplot.series[4]?.stroke, uplot, 4)).toBe("#00FF7F");
    expect(window.localStorage.getItem(CHANNEL_PALETTE_STORAGE_KEY)).toBeNull();
    expect(container.__uplot).toBe(initialInstance);
    expectYScalesUnchanged(uplot, yBefore);

    // Leave the hydrated module clean for subsequent tests
    freshPalette.usePaletteStore.getState().resetPalette();
  });

  it("AC1/AC4 (#40/#204): per-key ↺ reset restores only that entry's theme default", async () => {
    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(fourChUrl), "four.fvf");
    const capture = useCaptureStore.getState().capture!;

    let mountedUplot: uPlot | null = null;
    await act(async () => {
      root.render(
        <>
          <WaveformToolbar />
          <Oscilloscope
            capture={capture}
            onUPlotInit={(u) => {
              mountedUplot = u;
            }}
          />
        </>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    const uplot = mountedUplot!;

    await act(async () => {
      usePaletteStore.getState().setCustomColor("A", "#123456");
      usePaletteStore.getState().setCustomColor("D", "#654321");
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(resolveStroke(uplot.series[1]?.stroke, uplot, 1)).toBe("#123456");
    expect(resolveStroke(uplot.series[4]?.stroke, uplot, 4)).toBe("#654321");

    // Open Channel A's popover and reset only A through the ↺ control
    await act(async () => {
      (
        hostElement.querySelector(
          "[data-testid='channel-gear-A']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    await act(async () => {
      (
        document.body.querySelector(
          "[data-testid='hero-color-square']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    const resetA = document.body.querySelector(
      "[data-testid='config-reset']",
    ) as HTMLButtonElement;
    await act(async () => {
      resetA.click();
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(usePaletteStore.getState().customColors).toEqual({ D: "#654321" });
    expect(resolveStroke(uplot.series[1]?.stroke, uplot, 1)).toBe("#FFD700");
    expect(resolveStroke(uplot.series[4]?.stroke, uplot, 4)).toBe("#654321");
  });

  // ---------------------------------------------------------------------
  // Issue #73: blank canvas + hidden X axis on initial file open
  // (uPlot redraw()/deferred-scale-commit race)
  // ---------------------------------------------------------------------

  /** Painted in-plot pixels that differ from the Dark OLED background. */
  /** uPlot underscore internals are real at runtime but absent from the typings. */
  function axisShow(uplot: uPlot, idx: number): boolean | undefined {
    return (uplot.axes[idx] as unknown as { _show?: boolean })._show;
  }

  function axisValues(uplot: uPlot, idx: number): number[] {
    return (uplot.axes[idx] as unknown as { _values?: number[] })._values ?? [];
  }

  function seriesPaths(uplot: uPlot, idx: number): unknown {
    return (uplot.series[idx] as unknown as { _paths?: unknown })._paths;
  }

  function paintedInPlotPixels(uplot: uPlot): number {
    const ctx = uplot.ctx as CanvasRenderingContext2D;
    const x = Math.floor((uplot.bbox.left ?? 0) + (uplot.bbox.width ?? 0) / 2);
    let painted = 0;
    for (let y = 0; y < (uplot.bbox.height ?? 0); y += 2) {
      const data = ctx.getImageData(x, (uplot.bbox.top ?? 0) + y, 1, 1).data;
      if (data[0]! + data[1]! + data[2]! > 0) painted += 1;
    }
    return painted;
  }

  it("AC1/AC2/AC4 (#73): ingesting a capture through the app renders the 100% fit with a visible X axis immediately, without clicking Fit Waveform", async () => {
    // Full app flow: the App-level effect dispatches setChannelNamesFileKey
    // right after ingestion, which used to re-enter the channel-names label
    // effect and synchronously redraw() the freshly constructed uPlot while
    // its initial scale commit was still queued — clobbering the pending
    // fit bounds into {min: null, max: null} and leaving a blank canvas
    // with axes[0]._show === false.
    let mountedApp: Root | null = null;
    const appHost = document.createElement("div");
    appHost.style.width = "1280px";
    appHost.style.height = "800px";
    document.body.appendChild(appHost);
    mountedApp = createRoot(appHost);

    try {
      await act(async () => {
        mountedApp!.render(<App />);
      });

      // Real ingestion path: parse the 4-channel fixture while App is live
      // (same sequence as choosing a file in the picker).
      await act(async () => {
        await useCaptureStore
          .getState()
          .parseBuffer(await fixture(fourChUrl), "four.fvf");
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 60));
      });

      const container = appHost.querySelector(
        "[data-testid='oscilloscope-container']",
      ) as HTMLElement & { __uplot?: uPlot };
      expect(container).not.toBeNull();
      const uplot = container.__uplot!;
      expect(uplot).not.toBeNull();

      const capture = useCaptureStore.getState().capture!;
      const expected = computeCaptureFit(capture);

      // AC1: initial view is the full-capture 100% fit (scales committed,
      // never left null waiting on a deferred fit). Every channel owns its
      // fitted scale; the axis opens on the first visible channel (A).
      expect(uplot.scales.x?.min).toBe(expected.xMin);
      expect(uplot.scales.x?.max).toBe(expected.xMax);
      capture.channels.forEach((_channel, index) => {
        const key = yScaleKey(index);
        expect(uplot.scales[key]?.min).toBe(expected.channels[index]!.min);
        expect(uplot.scales[key]?.max).toBe(expected.channels[index]!.max);
      });
      expect(uplot.axes.find((a) => a.scale === "y0")).toBeDefined();
      const storeFit = useViewportStore.getState();
      expect(storeFit.yMin).toBe(expected.channels[0]!.min);
      expect(storeFit.yMax).toBe(expected.channels[0]!.max);

      // AC2: bottom X axis is shown with real tick values on first render.
      expect(axisShow(uplot, 0)).toBe(true);
      expect(axisValues(uplot, 0).length).toBeGreaterThan(0);

      // Traces have valid non-empty path geometry and actually painted.
      expect(seriesPaths(uplot, 1)).not.toBeNull();
      expect(seriesPaths(uplot, 4)).not.toBeNull();
      expect(paintedInPlotPixels(uplot)).toBeGreaterThan(0);

      // The bounds survive the post-ingestion channel-names store update.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 60));
      });
      expect(uplot.scales.x?.min).toBe(expected.xMin);
      expect(axisShow(uplot, 0)).toBe(true);
    } finally {
      await act(async () => {
        mountedApp!.unmount();
      });
      appHost.remove();
    }
  });

  it("AC3 (#73): a genuine channel rename redraws in place and leaves axis scale bounds untouched", async () => {
    const { uplot } = await mountCapture();
    const xMinBefore = uplot.scales.x!.min!;
    const xMaxBefore = uplot.scales.x!.max!;
    const yBefore = yScaleSnapshot(uplot);

    await act(async () => {
      useChannelNamesStore.getState().setName("A", "Vin");
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(uplot.series[1]?.label).toBe("A: Vin");
    // The axis heading keeps the stable descriptor identity (custom names
    // move series/legend labels, never the instrument axis).
    expect(uplot.axes.find((a) => a.scale === "y0")).toBeDefined();
    expect(uplot.scales.x?.min).toBe(xMinBefore);
    expect(uplot.scales.x?.max).toBe(xMaxBefore);
    expectYScalesUnchanged(uplot, yBefore);
    expect(axisShow(uplot, 0)).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Issue #119: per-channel Y axes (separate vertical axes, selected grid,
  // compacting, click-selection)
  // ---------------------------------------------------------------------

  async function mountMixed(): Promise<{
    capture: NonNullable<
      ReturnType<typeof useCaptureStore.getState>["capture"]
    >;
    uplot: uPlot;
  }> {
    useViewportStore.getState().setActiveChannels(["A", "B"]);
    useViewportStore.getState().setSelectedChannel("A");
    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(mixedCurrentUrl), "mixed.fvf");
    const capture = useCaptureStore.getState().capture!;
    expect(capture.channels.map((channel) => channel.label)).toEqual([
      "Input A",
      "Input B",
    ]);

    let mountedUplot: uPlot | null = null;
    await act(async () => {
      root.render(
        <Oscilloscope
          capture={capture}
          onUPlotInit={(u) => {
            mountedUplot = u;
          }}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(mountedUplot).not.toBeNull();
    return { capture, uplot: mountedUplot! };
  }

  function flatSampleIdx(uplot: uPlot, seriesIdx: number): number {
    const lane = uplot.data[seriesIdx] as Float32Array;
    let best = -1;
    let bestSlope = Number.POSITIVE_INFINITY;
    for (let i = 1000; i < lane.length - 1000; i += 13) {
      if (!Number.isFinite(lane[i])) continue;
      const slope = Math.abs(lane[i + 5]! - lane[i - 5]!);
      if (slope < bestSlope) {
        bestSlope = slope;
        best = i;
      }
    }
    if (best < 0) throw new Error("no finite trace sample found");
    return best;
  }

  function traceClientPoint(
    uplot: uPlot,
    seriesIdx: number,
    sampleIdx: number,
    mounted?: { timestamps: Float32Array },
  ): { clientX: number; clientY: number } {
    const timestamps =
      mounted?.timestamps ?? useCaptureStore.getState().capture!.timestamps;
    const rect = uplot.over.getBoundingClientRect();
    const lane = uplot.data[seriesIdx] as Float32Array;
    const key = uplot.series[seriesIdx]?.scale as string;
    return {
      clientX: rect.left + uplot.valToPos(timestamps[sampleIdx]!, "x"),
      clientY: rect.top + uplot.valToPos(lane[sampleIdx]!, key),
    };
  }

  async function clickPlot(
    uplot: uPlot,
    point: { clientX: number; clientY: number },
  ): Promise<void> {
    await act(async () => {
      dispatchMouse(uplot.over, "mousedown", point.clientX, point.clientY, 1);
      dispatchMouse(uplot.over, "mouseup", point.clientX, point.clientY, 0);
      await new Promise((r) => setTimeout(r, 60));
    });
  }

  interface AxisInspect {
    show?: boolean;
    grid?: { show?: boolean };
    label?: string | ((u: uPlot) => string);
  }

  function inspectAxis(axis: uPlot.Axis | undefined): AxisInspect {
    return (axis ?? {}) as AxisInspect;
  }

  it("AC: per-channel Y axes are shown for each active channel with selected channel grid", async () => {
    const { uplot } = await mountMixed();
    const activeChannels = useViewportStore.getState().activeChannels;
    expect(activeChannels).toEqual(["A", "B"]);
    const selectedChannel = useViewportStore.getState().selectedChannel;
    expect(selectedChannel).toBe("A");

    // Left axes are registered in reverse order: [xAxis, axisB, axisA]
    // Outermost column is A (first visible), next is B.
    const axisB = uplot.axes.find((a) => a.scale === "y1");
    const axisA = uplot.axes.find((a) => a.scale === "y0");
    expect(axisA).toBeDefined();
    expect(axisB).toBeDefined();

    expect(inspectAxis(axisA).show).toBe(true);
    expect(inspectAxis(axisB).show).toBe(true);

    // Selected channel (A) owns the grid lines; unselected (B) does not
    expect(inspectAxis(axisA).grid?.show).toBe(true);
    expect(inspectAxis(axisB).grid?.show).toBe(false);

    // Dynamic label from adapter
    const labelA =
      typeof axisA!.label === "function"
        ? (axisA!.label as (u: uPlot) => string)(uplot)
        : axisA!.label;
    expect(labelA).toBe("A (A)");
    const labelB =
      typeof axisB!.label === "function"
        ? (axisB!.label as (u: uPlot) => string)(uplot)
        : axisB!.label;
    expect(labelB).toBe("B (A)");
  });

  it("AC: toggling a channel off compacts remaining axis columns and reassigns grid ownership", async () => {
    const { uplot } = await mountMixed();
    const axisA = uplot.axes.find((a) => a.scale === "y0")!;
    const axisB = uplot.axes.find((a) => a.scale === "y1")!;

    expect(inspectAxis(axisA).show).toBe(true);
    expect(inspectAxis(axisB).show).toBe(true);

    // Toggle off channel A
    await act(async () => {
      useViewportStore.getState().toggleChannel("A");
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(useViewportStore.getState().activeChannels).toEqual(["B"]);
    expect(useViewportStore.getState().selectedChannel).toBe("B");

    // Axis A is hidden, Axis B is shown and owns the grid
    expect(inspectAxis(axisA).show).toBe(false);
    expect(inspectAxis(axisB).show).toBe(true);
    expect(inspectAxis(axisB).grid?.show).toBe(true);
  });

  it("AC: trace click selects the clicked channel; clicking far from traces keeps current selection", async () => {
    const { uplot } = await mountMixed();
    expect(useViewportStore.getState().selectedChannel).toBe("A");

    const axisA = uplot.axes.find((a) => a.scale === "y0")!;
    const axisB = uplot.axes.find((a) => a.scale === "y1")!;

    // Trace click on channel B (series 2)
    await clickPlot(uplot, traceClientPoint(uplot, 2, flatSampleIdx(uplot, 2)));
    expect(useViewportStore.getState().selectedChannel).toBe("B");
    expect(inspectAxis(axisB).grid?.show).toBe(true);
    expect(inspectAxis(axisA).grid?.show).toBe(false);

    // Far click outside snap radius preserves current selection
    const rect = uplot.over.getBoundingClientRect();
    const sample = flatSampleIdx(uplot, 2);
    const time = (uplot.data[0] as Float32Array)[sample]!;
    const posX = uplot.valToPos(time, "x");
    const laneA = uplot.data[1] as Float32Array;
    const laneB = uplot.data[2] as Float32Array;
    const yA = uplot.valToPos(laneA[sample]!, "y0");
    const yB = uplot.valToPos(laneB[sample]!, "y1");
    const farY = Math.min(yA, yB) > 70 ? 10 : rect.height - 10;
    await clickPlot(uplot, {
      clientX: rect.left + posX,
      clientY: rect.top + farY,
    });
    expect(useViewportStore.getState().selectedChannel).toBe("B");
    expect(inspectAxis(axisB).grid?.show).toBe(true);
  });

  it("AC: clicking an axis column selects that channel", async () => {
    await mountMixed();
    // Select channel B first
    await act(async () => {
      useViewportStore.getState().setSelectedChannel("B");
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(useViewportStore.getState().selectedChannel).toBe("B");

    const container = hostElement.querySelector(
      "[data-testid='oscilloscope-container']",
    ) as HTMLElement;

    // Click inside the leftmost column (channel A's axis column, around x=20)
    const rect = container.getBoundingClientRect();
    await act(async () => {
      container.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: rect.left + 20,
          clientY: rect.top + 200,
        }),
      );
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(useViewportStore.getState().selectedChannel).toBe("A");
  });

  it("AC: zero active channels leaves axes compacted without errors", async () => {
    const { uplot } = await mountMixed();

    await act(async () => {
      useViewportStore.getState().setActiveChannels([]);
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(useViewportStore.getState().activeChannels).toEqual([]);
    expect(useViewportStore.getState().selectedChannel).toBeNull();

    const axisA = uplot.axes.find((a) => a.scale === "y0")!;
    const axisB = uplot.axes.find((a) => a.scale === "y1")!;
    expect(inspectAxis(axisA).show).toBe(false);
    expect(inspectAxis(axisB).show).toBe(false);
    expect(inspectAxis(axisA).grid?.show).toBe(false);
    expect(inspectAxis(axisB).grid?.show).toBe(false);
  });

  it("AC: renaming channel dynamically updates its Y-axis title", async () => {
    const { uplot } = await mountMixed();
    const axisA = uplot.axes.find((a) => a.scale === "y0")!;

    await act(async () => {
      useChannelNamesStore.getState().setName("A", "Battery");
      await new Promise((r) => setTimeout(r, 60));
    });

    const labelA =
      typeof axisA.label === "function"
        ? (axisA.label as (u: uPlot) => string)(uplot)
        : axisA.label;
    expect(labelA).toBe("Battery (A)");
  });

  it("AC3 (#73): a names store update with unchanged content (fresh object identity) does not trigger a redundant redraw", async () => {
    const { uplot } = await mountCapture();
    const xMinBefore = uplot.scales.x!.min!;

    // App dispatches setFileKey() after ingestion; the store always swaps
    // the names object to a fresh identity (identical content for an
    // unnamed file). The signature guard must suppress the redraw.
    const redrawSpy = vi.spyOn(uplot, "redraw");
    await act(async () => {
      useChannelNamesStore.getState().setFileKey("four.fvf::(undated)");
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(redrawSpy).not.toHaveBeenCalled();
    expect(uplot.scales.x?.min).toBe(xMinBefore);
    expect(axisShow(uplot, 0)).toBe(true);
  });
});
