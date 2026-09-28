import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import uPlot from "uplot";
import Oscilloscope from "./Oscilloscope";
import "../../index.css";
import {
  AXIS_FONT,
  AXIS_GAP_PX,
  AXIS_LABEL_GAP_PX,
  AXIS_SIZE_X_PX,
  measureYAxisSize,
} from "./axesConfig";
import { useThemeStore } from "../../state/themeStore";
import { useCaptureStore } from "../../state/captureStore";
import { useViewportStore } from "../../state/viewportStore";
import type { ParsedCapture } from "../../types/capture";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createTestCapture(sampleCount = 800): ParsedCapture {
  const timestamps = new Float32Array(sampleCount);
  const ch1Data = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    timestamps[i] = i * 1e-3;
    ch1Data[i] = Math.sin(i * 0.05) * 120.5;
  }
  return {
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "1 ms/Div",
      secondsPerDiv: 1e-3,
      timestamp14: "12300020260912",
      samples: sampleCount,
      deltaT: 1e-3,
      channels: [
        {
          name: "A",
          label: "Input A",
          derived: false,
          samples: sampleCount,
          deltaT: 1e-3,
        },
      ],
    },
    channels: [{ name: "A", label: "Input A", derived: false, data: ch1Data }],
    derivedChannels: [],
    timestamps,
    warnings: [],
  };
}

function createFourChannelCapture(sampleCount = 800): ParsedCapture {
  const timestamps = new Float32Array(sampleCount);
  const tags = ["A", "B", "C", "D"];
  const amplitudes = [120.5, 60.25, 8.4, 1.1];
  const channels = tags.map((name, index) => {
    const data = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      timestamps[i] = i * 1e-3;
      data[i] = Math.sin(i * 0.05 + index) * amplitudes[index]!;
    }
    return { name, label: `Input ${name}`, derived: false, data };
  });
  return {
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "1 ms/Div",
      secondsPerDiv: 1e-3,
      timestamp14: "12300020260912",
      samples: sampleCount,
      deltaT: 1e-3,
      channels: tags.map((name) => ({
        name,
        label: `Input ${name}`,
        derived: false,
        samples: sampleCount,
        deltaT: 1e-3,
      })),
    },
    channels,
    derivedChannels: [],
    timestamps,
    warnings: [],
  };
}

describe("Y-axis width and axis geometry (Issue #60)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useThemeStore.getState().setTheme("dark");
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
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
    useThemeStore.getState().setTheme("dark");
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
  });

  function mountUPlot(capture = createTestCapture()): uPlot {
    // Issue #62: the plot sizes through the app's flex column; mirror it
    // so the standalone mount gets real flex geometry.
    act(() => {
      root.render(
        <div
          style={{ display: "flex", flexDirection: "column", height: "600px" }}
        >
          <Oscilloscope capture={capture} />
        </div>,
      );
    });
    const container = hostElement.querySelector(
      "[data-testid='oscilloscope-container']",
    ) as HTMLElement & { __uplot?: uPlot };
    expect(container.__uplot).toBeDefined();
    return container.__uplot!;
  }

  /** uPlot normalizes numeric sizes into resolver functions at init. */
  function resolvedSize(axis: uPlot.Axis): number {
    const size = axis.size as unknown;
    if (typeof size === "number") return size;
    return (size as (...args: unknown[]) => number)(
      null as never,
      null as never,
      0,
      0,
    );
  }

  it("AC1/AC2: measured text extents determine Y-axis column width", () => {
    const measure = document.createElement("canvas").getContext("2d")!;
    const font = "11px system-ui, -apple-system, sans-serif";
    measure.font = font;
    const ticks = ["-120.50", "0.00", "120.50"];
    const measuredSize = measureYAxisSize(ticks, measure, font);
    const tick = measure.measureText("-120.50");
    const requiredMin = tick.width + AXIS_GAP_PX;
    expect(measuredSize).toBeGreaterThanOrEqual(requiredMin);
  });

  it("AC1/AC3: the live Y axis uses dynamic sizing and shared padding", () => {
    const uplot = mountUPlot();
    const yAxis = uplot.axes[1]!;
    const xAxis = uplot.axes[0]!;
    expect(typeof yAxis.size).toBe("function");
    const size = (yAxis.size as (u: uPlot, values: string[]) => number)(uplot, [
      "-120.50",
      "0.00",
      "120.50",
    ]);
    expect(size).toBeGreaterThan(30);
    expect(resolvedSize(xAxis)).toBe(AXIS_SIZE_X_PX);
    expect(yAxis.gap).toBe(AXIS_GAP_PX);
    expect(yAxis.labelGap).toBe(AXIS_LABEL_GAP_PX);
    const instancePxRatio =
      uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const plotLeftCss = uplot.bbox.left / instancePxRatio;
    expect(plotLeftCss).toBeGreaterThan(0);
  });

  it("AC5: the same geometry holds in the Light/Lab theme", () => {
    act(() => {
      useThemeStore.getState().setTheme("light");
    });
    const uplot = mountUPlot();
    const yAxis = uplot.axes[1]!;
    expect(typeof yAxis.size).toBe("function");
    expect(yAxis.gap).toBe(AXIS_GAP_PX);
    expect(yAxis.labelGap).toBe(AXIS_LABEL_GAP_PX);
    const instancePxRatio =
      uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    expect(uplot.bbox.left / instancePxRatio).toBeGreaterThan(0);
  });

  it("AC4: exported print snapshots share the live axis geometry", async () => {
    const { composePrintSnapshot } = await import("../export/pngSnapshot");
    const capture = createTestCapture();
    const uplot = mountUPlot(capture);
    const composed = await composePrintSnapshot(
      uplot,
      capture,
      {
        cursor1: "#6A1B9A",
        cursor2: "#4B5563",
        background: "#FFFFFF",
        legend: [],
        selected: null,
      },
      { series: [{ label: "A", color: "#B8860B", show: true }] },
    );
    // Same CSS dimensions as the live instance (identical axis geometry,
    // shared builder => identical margins by construction).
    expect(composed.cssWidth).toBe(uplot.width);
    expect(composed.cssHeight).toBe(uplot.height);

    const pr = composed.pixelRatio;
    const traceColor: [number, number, number] = [184, 134, 11];
    const isTrace = (r: number, g: number, b: number) =>
      Math.abs(r - traceColor[0]) <= 12 &&
      Math.abs(g - traceColor[1]) <= 12 &&
      Math.abs(b - traceColor[2]) <= 12;

    const ctx = composed.canvas.getContext("2d")!;
    const gutterWidthDev = Math.round(8 * pr);
    const gutterHeightDev = Math.round(composed.cssHeight * pr);
    const gutter = ctx.getImageData(0, 0, gutterWidthDev, gutterHeightDev).data;
    for (let i = 0; i < gutter.length; i += 4) {
      expect(
        isTrace(gutter[i]!, gutter[i + 1]!, gutter[i + 2]!),
        "trace pixel inside the widened Y-axis gutter",
      ).toBe(false);
    }

    // The trace is present inside the plot area (full-height scan of a
    // band just right of the axis).
    const instancePxRatio =
      uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const plotLeftCss = uplot.bbox.left / instancePxRatio;
    const bandX = Math.round((plotLeftCss + 2) * pr);
    const band = ctx.getImageData(
      bandX,
      0,
      Math.round(40 * pr),
      gutterHeightDev,
    ).data;
    let found = false;
    for (let i = 0; i < band.length; i += 4) {
      if (isTrace(band[i]!, band[i + 1]!, band[i + 2]!)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("AC (Issue #144): channel titles clear the tick marks of the neighboring axis", () => {
    const uplot = mountUPlot(createFourChannelCapture());
    // Axis order is [x, ...reversed channels]; every title except the
    // outermost sits immediately right of the next axis outward.
    const yAxes = uplot.axes.slice(1);
    expect(yAxes.length).toBe(4);

    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = AXIS_FONT;
    // uPlot internal layout fields are `_pos`/`_lpos`; read them loosely.
    const rawOf = (axis: uPlot.Axis): { _pos: number; _lpos: number } =>
      axis as unknown as { _pos: number; _lpos: number };

    for (let i = 0; i < yAxes.length - 1; i += 1) {
      const inner = yAxes[i]!;
      const outer = yAxes[i + 1]!;
      const title = String(inner.label);
      const metrics = measure.measureText(title);
      // Rotated side-3 titles render with textBaseline "bottom" at
      // _lpos - AXIS_LABEL_GAP_PX, so glyph ink extends left of that
      // origin by up to the font ascent (+1px antialiasing margin).
      const extent = Math.ceil(metrics.actualBoundingBoxAscent + 1);
      const titleLeft = rawOf(inner)._lpos - AXIS_LABEL_GAP_PX - extent;
      // Neighbor tick marks occupy the rightmost AXIS_TICK_SIZE_PX of
      // the neighboring tick zone, ending at its _pos.
      const neighborTickRight = rawOf(outer)._pos;
      expect(
        titleLeft,
        `title "${title}" overlaps the neighboring tick marks`,
      ).toBeGreaterThanOrEqual(neighborTickRight);
    }
  });

  it("AC1: zooming and resizing maintains consistent axis font and does not shrink tick labels", () => {
    const uplot = mountUPlot();
    const yAxis = uplot.axes[1]!;
    const assertFont = (font: unknown) => {
      if (Array.isArray(font)) {
        expect(font[0]).toBe(AXIS_FONT);
        expect(font[1]).toBe(11);
      } else {
        expect(font).toBe(AXIS_FONT);
      }
    };

    assertFont(yAxis.font);
    assertFont(yAxis.labelFont);

    // Zoom via setScale
    act(() => {
      uplot.setScale("x", { min: 0.1, max: 0.3 });
      uplot.setScale("y0", { min: -50, max: 50 });
      uplot.redraw();
    });

    assertFont(yAxis.font);
    assertFont(yAxis.labelFont);

    // Resize
    act(() => {
      uplot.setSize({ width: 600, height: 400 });
      uplot.redraw();
    });

    assertFont(yAxis.font);
    assertFont(yAxis.labelFont);
  });

  it("AC2: resetting zoom via Fit Waveform and toggling channel visibility maintains consistent font sizing", () => {
    const uplot = mountUPlot();
    const yAxis = uplot.axes[1]!;
    const assertFont = (font: unknown) => {
      if (Array.isArray(font)) {
        expect(font[0]).toBe(AXIS_FONT);
        expect(font[1]).toBe(11);
      } else {
        expect(font).toBe(AXIS_FONT);
      }
    };

    // Zoom then reset via requestFit
    act(() => {
      uplot.setScale("x", { min: 0.2, max: 0.4 });
      useViewportStore.getState().requestFit();
    });

    assertFont(yAxis.font);
    assertFont(yAxis.labelFont);

    // Toggle channel visibility
    act(() => {
      useViewportStore.getState().toggleChannel("A");
    });

    assertFont(yAxis.font);
    assertFont(yAxis.labelFont);
  });

  it("AC3: axis size callback does not mutate or override uPlot.ctx.font on the main render canvas", () => {
    const uplot = mountUPlot();
    const yAxis = uplot.axes[1]!;
    expect(typeof yAxis.size).toBe("function");

    // Set a distinct font on uplot.ctx simulating high-DPI scaled font
    const highDpiFont = "22px system-ui, -apple-system, sans-serif";
    uplot.ctx.font = highDpiFont;

    // Invoke axis.size
    const sizeFn = yAxis.size as (self: uPlot, values: string[]) => number;
    const computedSize = sizeFn(uplot, ["-120.50", "0.00", "120.50"]);

    expect(computedSize).toBeGreaterThan(30);
    // Crucial: uPlot's main canvas ctx.font must remain completely unpolluted
    expect(uplot.ctx.font).toBe(highDpiFont);
  });
});
