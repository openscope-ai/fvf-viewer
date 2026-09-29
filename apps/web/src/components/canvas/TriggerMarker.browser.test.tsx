import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import uPlot from "uplot";
import Oscilloscope from "./Oscilloscope";
import "../../index.css";
import { useThemeStore } from "../../state/themeStore";
import { useCaptureStore } from "../../state/captureStore";
import { useViewportStore } from "../../state/viewportStore";
import type { ParsedCapture } from "../../types/capture";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** Symmetric capture: t = 0 sits at the sample midpoint => plot center. */
function createTestCapture(sampleCount = 800): ParsedCapture {
  const timestamps = new Float32Array(sampleCount);
  const ch1Data = new Float32Array(sampleCount);
  const center = sampleCount / 2;
  for (let i = 0; i < sampleCount; i += 1) {
    timestamps[i] = (i - center) * 1e-3;
    ch1Data[i] = Math.sin(i * 0.05) * 2;
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

function countNear(
  canvas: HTMLCanvasElement,
  x0: number,
  y0: number,
  w: number,
  h: number,
  target: [number, number, number],
  tol = 10,
): number {
  const ctx = canvas.getContext("2d")!;
  const d = ctx.getImageData(
    Math.round(x0),
    Math.round(y0),
    Math.round(w),
    Math.round(h),
  ).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (
      Math.abs(d[i]! - target[0]) <= tol &&
      Math.abs(d[i + 1]! - target[1]) <= tol &&
      Math.abs(d[i + 2]! - target[2]) <= tol
    ) {
      n += 1;
    }
  }
  return n;
}

const DARK_ACCENT: [number, number, number] = [85, 85, 85]; // #555555
const LIGHT_ACCENT: [number, number, number] = [136, 136, 136]; // #888888

describe("t=0 trigger reference (Issue #61)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;

  async function mount(): Promise<{
    uplot: uPlot;
    canvas: HTMLCanvasElement;
  }> {
    act(() => {
      root.render(<Oscilloscope capture={createTestCapture()} />);
    });
    // uPlot defers scale commits and the initial draw to a scheduled task.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const container = hostElement.querySelector(
      "[data-testid='oscilloscope-container']",
    ) as HTMLElement & { __uplot?: uPlot };
    expect(container.__uplot).toBeDefined();
    const uplot = container.__uplot!;
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    return { uplot, canvas };
  }

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

  it("AC2: the t=0 graticule line renders in the brighter accent tone", async () => {
    const { uplot, canvas } = await mount();
    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const plotLeft = uplot.bbox.left / pxRatio;
    const x0 = plotLeft + uplot.valToPos(0, "x");
    // The accent line (with antialiased edges) sits on the t=0 position...
    expect(
      countNear(
        canvas,
        x0 - 2,
        uplot.bbox.top / pxRatio + 150,
        5,
        40,
        DARK_ACCENT,
      ),
    ).toBeGreaterThan(0);
    // ...while a regular graticule column does not.
    const xGrid = plotLeft + uplot.valToPos(-0.2, "x");
    expect(
      countNear(
        canvas,
        xGrid - 2,
        uplot.bbox.top / pxRatio + 150,
        5,
        40,
        DARK_ACCENT,
      ),
    ).toBe(0);
  });

  it("AC3: the rising-edge glyph is pinned to the top border over t=0", async () => {
    const { uplot, canvas } = await mount();
    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const plotLeft =
      uplot.bbox.top === undefined ? 0 : uplot.bbox.left / pxRatio;
    const x0 = plotLeft + uplot.valToPos(0, "x");
    const topCss = uplot.bbox.top / pxRatio;
    // Accent-colored glyph pixels exist in the top margin band centered on t=0...
    const glyphBand = countNear(
      canvas,
      x0 - 14,
      topCss - 15,
      28,
      15,
      DARK_ACCENT,
    );
    expect(glyphBand).toBeGreaterThan(0);
    // ...and none in the equivalent band far from t=0.
    const quietBand = countNear(
      canvas,
      plotLeft + uplot.valToPos(-0.3, "x") - 14,
      topCss - 15,
      28,
      15,
      DARK_ACCENT,
    );
    expect(quietBand).toBe(0);
  });

  it("AC4: the accent line and glyph track zoom and hide when t=0 leaves the window", async () => {
    const { uplot, canvas } = await mount();
    // Zoom to a window entirely right of t = 0; uPlot defers the commit
    // and redraw to a scheduled task, so wait before sampling pixels.
    act(() => {
      uplot.setScale("x", { min: 0.05, max: 0.1 });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const accentPixels = countNear(
      canvas,
      uplot.bbox.left / pxRatio,
      uplot.bbox.top / pxRatio,
      uplot.bbox.width / pxRatio,
      uplot.bbox.height / pxRatio,
      DARK_ACCENT,
    );
    expect(accentPixels).toBe(0);
    // Zoom back so t = 0 is inside: the accent returns and tracks position.
    act(() => {
      uplot.setScale("x", { min: -0.05, max: 0.05 });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const plotLeft = uplot.bbox.left / pxRatio;
    const x0 = plotLeft + uplot.valToPos(0, "x");
    // The crisp line occupies the single device column nearest x0.
    expect(
      countNear(
        canvas,
        x0 - 4,
        uplot.bbox.top / pxRatio + 200,
        9,
        1,
        DARK_ACCENT,
      ),
    ).toBe(1);
  });

  it("AC2/AC5: the accent tone follows the Light/Lab theme", async () => {
    act(() => {
      useThemeStore.getState().setTheme("light");
    });
    const { uplot, canvas } = await mount();
    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const plotLeft = uplot.bbox.left / pxRatio;
    const x0 = plotLeft + uplot.valToPos(0, "x");
    expect(
      countNear(
        canvas,
        x0 - 4,
        uplot.bbox.top / pxRatio + 200,
        9,
        1,
        LIGHT_ACCENT,
      ),
    ).toBe(1);
  });

  // ---------------------------------------------------------------------
  // Issue #85: collinear rising edge, top margin placement, unbroken border
  // ---------------------------------------------------------------------

  it("AC1 (#85): the vertical reference line at t=0 spans continuously from the top border to the bottom border", async () => {
    const { uplot, canvas } = await mount();
    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const plotLeft = uplot.bbox.left / pxRatio;
    const x0 = plotLeft + uplot.valToPos(0, "x");
    const topCss = uplot.bbox.top / pxRatio;

    // The reference line begins right at topDev (no truncation gap below topDev).
    // The band immediately below topDev (topCss + 2 to topCss + 22) contains the accent line.
    expect(
      countNear(canvas, x0 - 2, topCss + 2, 5, 20, DARK_ACCENT),
    ).toBeGreaterThan(0);
    // Sanity: the line continues down through the center of the plot.
    expect(
      countNear(canvas, x0 - 2, topCss + 150, 5, 40, DARK_ACCENT),
    ).toBeGreaterThan(0);
  });

  it("AC2 (#85): the topmost horizontal gridline and reference line remain continuous across t=0 without clear-zone cuts", async () => {
    const { uplot, canvas } = await mount();
    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const plotLeft = uplot.bbox.left / pxRatio;
    const x0 = plotLeft + uplot.valToPos(0, "x");
    const topCss = uplot.bbox.top / pxRatio;

    // In issue #77, the clear zone fill painted over topDev inside the plot area,
    // erasing the top graticule and creating an unsightly break across t=0.
    // In issue #85, the glyph is in the top margin and clear-zone fill is strictly
    // confined above topDev. The vertical reference line begins at topDev and
    // meets the trigger marker without any clear-zone cut.
    expect(
      countNear(canvas, x0 - 2, topCss, 5, 2, DARK_ACCENT),
    ).toBeGreaterThan(0);

    // Any horizontal gridline inside the plot area across t=0 is unbroken:
    // At the topmost horizontal graticule split in this capture,
    // the gridline is present across the t=0 column (e.g. x0 + 5).
    const axisY = uplot.axes.find((a) => a.scale === "y0");
    const splits = (axisY as unknown as { _splits?: number[] })?._splits ?? [];
    const topSplit = splits.length > 0 ? Math.max(...splits) : 2;
    const splitY = topCss + uplot.valToPos(topSplit, "y0");
    expect(
      countNear(canvas, x0 + 5, splitY, 10, 2, [34, 34, 34]),
    ).toBeGreaterThan(0);
  });

  it("AC3 (#85): the vertical rising edge and arrow head align collinearly with the t=0 vertical line", async () => {
    const { uplot, canvas } = await mount();
    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const plotLeft = uplot.bbox.left / pxRatio;
    const x0 = plotLeft + uplot.valToPos(0, "x");
    const topCss = uplot.bbox.top / pxRatio;

    // In the top margin, the vertical rising edge and arrow stem run along x0:
    // At y = topCss - 3 (between low level and high level):
    // Column x0 contains the accent stroke (rising edge / arrow stem)...
    expect(
      countNear(canvas, x0 - 2, topCss - 4, 5, 2, DARK_ACCENT),
    ).toBeGreaterThan(0);
    // ...while columns to the left (x0 - 6) and right (x0 + 6) at y = topCss - 3 do not.
    expect(countNear(canvas, x0 - 8, topCss - 4, 4, 2, DARK_ACCENT)).toBe(0);
    expect(countNear(canvas, x0 + 4, topCss - 4, 4, 2, DARK_ACCENT)).toBe(0);

    // At y = topCss - 9 (the arrow stem above the high level):
    // Column x0 contains the arrow stem...
    expect(
      countNear(canvas, x0 - 2, topCss - 10, 5, 2, DARK_ACCENT),
    ).toBeGreaterThan(0);
    // ...while columns to the left (x0 - 6) and right (x0 + 6) do not.
    expect(countNear(canvas, x0 - 8, topCss - 10, 4, 2, DARK_ACCENT)).toBe(0);
    expect(countNear(canvas, x0 + 4, topCss - 10, 4, 2, DARK_ACCENT)).toBe(0);
  });

  it("AC4 (#85): the trigger icon sits in the top margin with comfortable headroom without clipping", async () => {
    const { uplot, canvas } = await mount();
    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const plotLeft = uplot.bbox.left / pxRatio;
    const x0 = plotLeft + uplot.valToPos(0, "x");
    const topCss = uplot.bbox.top / pxRatio;

    // Top padding allocates 18px of headroom.
    expect(topCss).toBe(18);

    // The glyph sits between topCss - 12 (arrow tip) and topCss (base).
    // The margin near the canvas top edge (y = 0 to 3 css px) has clear headroom.
    expect(countNear(canvas, x0 - 10, 0, 20, 3, DARK_ACCENT)).toBe(0);

    // The glyph itself is clearly rendered within the top margin (y = 5 to 17 css px).
    expect(countNear(canvas, x0 - 10, 5, 20, 12, DARK_ACCENT)).toBeGreaterThan(
      0,
    );
  });

  it("AC5 (#85): print exports composite the trigger reference with live parity and unbroken graticule", async () => {
    const { composePrintSnapshot } = await import("../export/pngSnapshot");
    const capture = createTestCapture();
    const { uplot } = await mount();
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
    const pr = composed.pixelRatio;
    const plotTopDev = uplot.bbox.top;

    // 1. Glyph is present in the top margin in the export.
    const glyphHits = countNear(
      composed.canvas,
      0,
      0,
      composed.cssWidth * pr,
      plotTopDev,
      LIGHT_ACCENT,
    );
    expect(glyphHits).toBeGreaterThan(0);

    // 2. Full-height vertical line is present immediately below the top border (no truncation gap).
    const lineNearTopHits = countNear(
      composed.canvas,
      0,
      plotTopDev + 2 * pr,
      composed.cssWidth * pr,
      20 * pr,
      LIGHT_ACCENT,
    );
    expect(lineNearTopHits).toBeGreaterThan(0);

    // 3. Full-height vertical line continues through the plot.
    const lineMidHits = countNear(
      composed.canvas,
      0,
      plotTopDev + 50 * pr,
      composed.cssWidth * pr,
      50 * pr,
      LIGHT_ACCENT,
    );
    expect(lineMidHits).toBeGreaterThan(0);
  });
});
