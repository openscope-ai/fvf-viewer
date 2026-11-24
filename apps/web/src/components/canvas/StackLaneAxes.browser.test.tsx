import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type uPlot from "uplot";
import fourChUrlQ from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import Oscilloscope from "./Oscilloscope";
import WaveformToolbar from "../toolbar/WaveformToolbar";
import { yScaleKey } from "../../capture/channelUnits";
import { useCaptureStore } from "../../state/captureStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useThemeStore } from "../../state/themeStore";
import { useViewportStore } from "../../state/viewportStore";
import { useBadgePopoverStore } from "../toolbar/badgeConfig/anchoredPopover";
import { laneBandCss, laneBandsCss } from "./stackLaneDecorations";
import {
  TICK_LABEL_COLLISION_HEIGHT_PX,
  TICK_LABEL_HALF_HEIGHT_PX,
} from "./axesConfig";
import { getLiveRenderState } from "./liveRenderState";
import { useLaneLayoutStore } from "../../state/laneLayoutStore";
import { stackLaneBoundsWeighted } from "./viewportController";
import {
  composePrintSnapshot,
  composeSnapshotCanvas,
  type PrintSeriesSpec,
} from "../export/pngSnapshot";
import { buildPrintRenderContext } from "../export/snapshotExporter";
import { resetSession } from "../../state/captureSession";

/**
 * Issue #250 acceptance: in Stack view each channel's y-axis column
 * renders its ticks, rotated title, and ground flag ONLY inside that
 * channel's lane band, with subtle lane separators (theme grid color,
 * low alpha) spanning the plot width between adjacent lanes; Overlay
 * mode keeps today's full-height columns and draws no separators; the
 * lane partitioning, selection gestures, themes, and PNG export paths
 * all behave.
 */

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching ${url}`).toBeTruthy();
  return response.arrayBuffer();
}

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

interface AxisInternals {
  show?: boolean;
  _pos?: number;
  _size?: number;
  _lpos?: number;
  label?: unknown;
  labelSize?: number;
  _splits?: number[];
  _values?: (string | null)[];
}

function axisOf(u: uPlot, scaleKey: string): AxisInternals {
  const axis = u.axes.find(
    (a) => a.scale === scaleKey,
  ) as unknown as AxisInternals;
  expect(axis, `axis for ${scaleKey}`).toBeDefined();
  return axis;
}

function pxRatioOf(u: uPlot): number {
  return u.width > 0 ? u.ctx.canvas.width / u.width : 1;
}

/** True when the canvas holds a pixel near `color` inside the rect (CSS px, root-relative). */
function canvasHasColor(
  u: uPlot,
  color: string,
  rect: { x0: number; x1: number; y0: number; y1: number },
): boolean {
  const pxRatio = pxRatioOf(u);
  const ctx = u.ctx;
  const [r, g, b] = hexToRgb(color);
  const x0 = Math.max(0, Math.floor(rect.x0 * pxRatio));
  const x1 = Math.min(ctx.canvas.width - 1, Math.ceil(rect.x1 * pxRatio));
  const y0 = Math.max(0, Math.floor(rect.y0 * pxRatio));
  const y1 = Math.min(ctx.canvas.height - 1, Math.ceil(rect.y1 * pxRatio));
  const data = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
  for (let i = 0; i < data.length; i += 4) {
    if (
      Math.abs(data[i]! - r) < 60 &&
      Math.abs(data[i + 1]! - g) < 60 &&
      Math.abs(data[i + 2]! - b) < 60
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Modal pixel color along a horizontal row (CSS-px y, root-relative;
 * ~48 samples across [x0, x1]). A lane separator spans the full plot
 * width, so its blended color dominates the boundary row; trace
 * crossings are a minority.
 */
function rowMode(
  ctx: CanvasRenderingContext2D,
  pxRatio: number,
  x0: number,
  x1: number,
  y: number,
): [number, number, number] {
  const counts = new Map<
    string,
    { n: number; rgb: [number, number, number] }
  >();
  const samples = 48;
  for (let i = 0; i < samples; i += 1) {
    const x = Math.round((x0 + ((x1 - x0) * i) / samples) * pxRatio);
    const px = ctx.getImageData(x, Math.round(y * pxRatio), 1, 1).data;
    const key = `${px[0]},${px[1]},${px[2]}`;
    const entry = counts.get(key);
    if (entry) entry.n += 1;
    else counts.set(key, { n: 1, rgb: [px[0]!, px[1]!, px[2]!] });
  }
  let best: { n: number; rgb: [number, number, number] } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.n > best.n) best = entry;
  }
  return best!.rgb;
}

describe("Stack-view lane-scoped axis columns + separators (issue #250)", () => {
  let host: HTMLDivElement;
  let root: Root;

  const mountFullUi = async (): Promise<uPlot> => {
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
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(mounted).not.toBeNull();
    return mounted!;
  };

  const settle = async (ms = 60): Promise<void> => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  };

  const enableStack = async (): Promise<void> => {
    await act(async () => {
      useChannelDisplayStore.getState().setStackMode(true);
    });
    await settle(250);
  };

  /**
   * Deterministic separator probe: a lane separator spans the full plot
   * width and y-axis column at a band boundary, so among the candidate
   * device rows one row's modal color equals the expected dedicated
   * separator color within tolerance.
   */
  const axisTitleStripRange = (u: uPlot): [number, number] => {
    const axis = axisOf(u, yScaleKey(0));
    const lpos = axis._lpos ?? (axis._pos ?? 0) - (axis._size ?? 0);
    const labelSize = typeof axis.labelSize === "number" ? axis.labelSize : 20;
    const left = Math.max(0, lpos - labelSize);
    return [left + 2, Math.max(left + 6, lpos - 2)];
  };

  const separatorRowInRange = (
    ctx: CanvasRenderingContext2D,
    pxRatio: number,
    yBoundary: number,
    x0: number,
    x1: number,
    expected: [number, number, number],
  ): boolean => {
    for (const dy of [-1.5, -1, -0.5, 0, 0.5, 1, 1.5]) {
      const mode = rowMode(ctx, pxRatio, x0, x1, Math.floor(yBoundary) + dy);
      if (
        Math.abs(mode[0] - expected[0]) < 14 &&
        Math.abs(mode[1] - expected[1]) < 14 &&
        Math.abs(mode[2] - expected[2]) < 14
      ) {
        return true;
      }
    }
    return false;
  };

  const separatorRow = (
    u: uPlot,
    fraction: number,
    expected: [number, number, number],
  ): boolean => {
    const pxRatio = pxRatioOf(u);
    const plotLeft = u.bbox.left / pxRatio;
    const plotRight = plotLeft + u.bbox.width / pxRatio;
    const yBoundary =
      u.bbox.top / pxRatio + fraction * (u.bbox.height / pxRatio);
    return separatorRowInRange(
      u.ctx,
      pxRatio,
      yBoundary,
      plotLeft + 20,
      plotRight - 20,
      expected,
    );
  };

  const axisColumnSeparatorRow = (
    u: uPlot,
    fraction: number,
    expected: [number, number, number],
  ): boolean => {
    const pxRatio = pxRatioOf(u);
    const [x0, x1] = axisTitleStripRange(u);
    const yBoundary =
      u.bbox.top / pxRatio + fraction * (u.bbox.height / pxRatio);
    return separatorRowInRange(u.ctx, pxRatio, yBoundary, x0, x1, expected);
  };

  beforeEach(async () => {
    useBadgePopoverStore.getState().setOpen(null);
    window.localStorage.clear();
    resetSession();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
    useChannelNamesStore.setState({ fileKey: null, names: {} });
    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(fourChUrlQ), "four.fvf");
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

  it("AC1: in Stack mode ticks, labels, and the rotated title render only inside each channel's lane band", async () => {
    const uplot = await mountFullUi();
    const capture = useCaptureStore.getState().capture!;
    await enableStack();

    const colors: Record<string, string> = {
      A: "#FFD700",
      B: "#00BFFF",
      C: "#FF4500",
      D: "#00FF7F",
    };
    const pxRatio = pxRatioOf(uplot);
    const plotMid = uplot.bbox.top / pxRatio + uplot.bbox.height / pxRatio / 2;
    capture.channels.forEach((channel, index) => {
      const scaleKey = yScaleKey(index);
      const axis = axisOf(uplot, scaleKey);
      const band = laneBandCss(uplot, getLiveRenderState(capture), scaleKey);
      expect(band, `band for ${channel.name}`).not.toBeNull();

      // Tick marks + labels: the axis filter nulls every split outside
      // the band; rendered (non-null) values keep index alignment.
      const splits = axis._splits ?? [];
      const values = axis._values ?? [];
      expect(values.length).toBe(splits.length);
      let rendered = 0;
      values.forEach((value, i) => {
        if (value == null) return;
        rendered += 1;
        const y = uplot.valToPos(splits[i]!, scaleKey);
        expect(
          y,
          `${channel.name} tick '${value}' outside its lane band`,
        ).toBeGreaterThanOrEqual(band!.top - 2);
        expect(y).toBeLessThanOrEqual(band!.bottom + 2);
      });
      expect(rendered).toBeGreaterThan(0);

      // Rotated title: channel-colored ink in the title strip exists at
      // the lane center…
      const stripX = {
        x0: (axis._lpos ?? 0) - (axis.labelSize ?? 0) - 1,
        x1: axis._lpos ?? 0,
      };
      const color = colors[channel.name]!;
      expect(
        canvasHasColor(uplot, color, {
          ...stripX,
          y0: (band!.top + band!.bottom) / 2 - 25,
          y1: (band!.top + band!.bottom) / 2 + 25,
        }),
        `${channel.name} title at its lane center`,
      ).toBe(true);
      // …and NOT at the plot mid-height when that lies outside the band
      // (the mid-height belongs to the lane-1/lane-2 boundary).
      if (index !== 1 && index !== 2) {
        expect(
          canvasHasColor(uplot, color, {
            ...stripX,
            y0: plotMid - 12,
            y1: plotMid + 12,
          }),
          `${channel.name} title bleeding to mid-height`,
        ).toBe(false);
      }
    });
  });

  it("AC2: full-opacity lane separators span the y-axis column and plot width between adjacent lanes in Stack mode", async () => {
    const uplot = await mountFullUi();
    await enableStack();

    // Dark theme laneSeparator: #4A5568 = (74, 85, 104).
    for (const fraction of [0.25, 0.5, 0.75]) {
      expect(
        separatorRow(uplot, fraction, [74, 85, 104]),
        `plot separator at boundary ${fraction}`,
      ).toBe(true);
      expect(
        axisColumnSeparatorRow(uplot, fraction, [74, 85, 104]),
        `axis-column separator at boundary ${fraction}`,
      ).toBe(true);
    }
  });

  it("AC3: Overlay mode keeps full-height columns and draws no separators", async () => {
    const uplot = await mountFullUi();
    await settle();
    const pxRatio = pxRatioOf(uplot);
    const plotMid = uplot.bbox.top / pxRatio + uplot.bbox.height / pxRatio / 2;

    for (const fraction of [0.25, 0.5, 0.75]) {
      expect(
        separatorRow(uplot, fraction, [74, 85, 104]),
        `no separator at ${fraction} in Overlay`,
      ).toBe(false);
      expect(
        axisColumnSeparatorRow(uplot, fraction, [74, 85, 104]),
        `no axis-column separator at ${fraction} in Overlay`,
      ).toBe(false);
    }

    // Full-height title: A's rotated title ink spans the mid-height
    // region in its own title strip (uPlot's own mid-height title).
    const axisA = axisOf(uplot, yScaleKey(0));
    expect(
      canvasHasColor(uplot, "#FFD700", {
        x0: (axisA._lpos ?? 0) - (axisA.labelSize ?? 0) - 1,
        x1: axisA._lpos ?? 0,
        y0: plotMid - 12,
        y1: plotMid + 12,
      }),
    ).toBe(true);
  });

  it("AC4: visibility toggles re-partition bands idempotently while stacked", async () => {
    const uplot = await mountFullUi();
    const capture = useCaptureStore.getState().capture!;
    await enableStack();
    const bandOf = (scaleKey: string) =>
      laneBandCss(uplot, getLiveRenderState(capture), scaleKey);

    const hideB = async (): Promise<void> => {
      act(() => {
        useViewportStore.getState().setActiveChannels(["A", "C", "D"]);
      });
      await settle(200);
    };

    await hideB();
    const checkThirds = (): void => {
      const plotH = uplot.bbox.height / pxRatioOf(uplot);
      expect(bandOf(yScaleKey(2))!.bottom).toBeCloseTo((2 / 3) * plotH, 0);
      expect(bandOf(yScaleKey(3))!.bottom).toBeCloseTo(plotH, 0);
    };
    checkThirds();

    // Toggle B back and forth: boundaries never drift (idempotent).
    act(() => {
      useViewportStore.getState().setActiveChannels(["A", "B", "C", "D"]);
    });
    await settle(200);
    await hideB();
    checkThirds();
  });

  it("AC5: axis-column click and trace-click selection keep working while stacked", async () => {
    const uplot = await mountFullUi();
    const capture = useCaptureStore.getState().capture!;
    await enableStack();

    const container = document.querySelector(
      "[data-testid='oscilloscope-container']",
    ) as HTMLElement;
    const rect = container.getBoundingClientRect();
    const bands = laneBandsCss(uplot, getLiveRenderState(capture));
    const bandA = bands.find((b) => b.key === "A")!;
    const pxRatio = pxRatioOf(uplot);
    const plotTop = uplot.bbox.top / pxRatio;
    const axisA = axisOf(uplot, yScaleKey(0));
    await act(async () => {
      container.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: Math.round(rect.left + (axisA._pos ?? 60) - 20),
          clientY: Math.round(
            rect.top + plotTop + (bandA.top + bandA.bottom) / 2,
          ),
        }),
      );
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(useViewportStore.getState().selectedChannel).toBe("A");

    // Trace-click selection: click on channel C's trace inside its lane.
    act(() => {
      useViewportStore.getState().setSelectedChannel("A");
    });
    await settle();
    const seriesC = 3; // [time, A, B, C, ...]
    const mid = Math.floor(capture.timestamps.length / 2);
    const pointY = uplot.valToPos(
      uplot.data[seriesC]![mid]!,
      yScaleKey(seriesC - 1),
    );
    const over = uplot.over.getBoundingClientRect();
    const clientX = Math.round(
      over.left + uplot.valToPos(capture.timestamps[mid]!, "x"),
    );
    const clientY = Math.round(over.top + pointY);
    await act(async () => {
      uplot.over.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX,
          clientY,
        }),
      );
      uplot.over.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX,
          clientY,
        }),
      );
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(useViewportStore.getState().selectedChannel).toBe("C");
  });

  it("AC6: both themes render separators with their palette's dedicated laneSeparator color across axis and plot", async () => {
    const uplot = await mountFullUi();
    await enableStack();

    // Dark theme laneSeparator: #4A5568 = (74, 85, 104), distinct from grid #222222 = (34, 34, 34).
    expect(separatorRow(uplot, 0.25, [74, 85, 104])).toBe(true);
    expect(axisColumnSeparatorRow(uplot, 0.25, [74, 85, 104])).toBe(true);
    expect(separatorRow(uplot, 0.25, [34, 34, 34])).toBe(false);

    act(() => {
      useThemeStore.getState().setTheme("light");
    });
    await settle(200);
    // Light theme laneSeparator: #64748B = (100, 116, 139), distinct from grid #C8C8C8 = (200, 200, 200).
    expect(separatorRow(uplot, 0.25, [100, 116, 139])).toBe(true);
    expect(axisColumnSeparatorRow(uplot, 0.25, [100, 116, 139])).toBe(true);
    expect(separatorRow(uplot, 0.25, [200, 200, 200])).toBe(false);
    expect(separatorRow(uplot, 0.25, [74, 85, 104])).toBe(false);
  });

  it("AC7: PNG snapshots composite the full-width separators across axis and plot on both export paths with no drag tint", async () => {
    const uplot = await mountFullUi();
    const capture = useCaptureStore.getState().capture!;
    await enableStack();
    const pxRatio = pxRatioOf(uplot);
    const yBoundary =
      uplot.bbox.top / pxRatio + 0.25 * (uplot.bbox.height / pxRatio);
    const plotLeft = uplot.bbox.left / pxRatio;
    const plotRight = plotLeft + uplot.bbox.width / pxRatio;
    const [axisLeft, axisRight] = axisTitleStripRange(uplot);

    const screen = composeSnapshotCanvas(uplot, capture, {
      cursor1: "#E040FB",
      cursor2: "#B0B0B0",
      background: "#000000",
      legend: [],
      selected: null,
    });
    // Screen path: dark laneSeparator (#4A5568) across both plot and y-axis column.
    expect(
      separatorRowInRange(
        screen.canvas.getContext("2d")!,
        screen.pixelRatio,
        yBoundary,
        plotLeft + 20,
        plotRight - 20,
        [74, 85, 104],
      ),
    ).toBe(true);
    expect(
      separatorRowInRange(
        screen.canvas.getContext("2d")!,
        screen.pixelRatio,
        yBoundary,
        axisLeft,
        axisRight,
        [74, 85, 104],
      ),
    ).toBe(true);

    // Active Stack box-zoom drag must never paint its lane tint onto PNG exports.
    const rect = uplot.over.getBoundingClientRect();
    const bands = laneBandsCss(uplot, getLiveRenderState(capture));
    const lane0 = bands[0]!;
    const dragY = (lane0.top + lane0.bottom) / 2;
    await act(async () => {
      uplot.over.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          buttons: 1,
          clientX: rect.left + 80,
          clientY: rect.top + dragY,
        }),
      );
      uplot.over.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          buttons: 1,
          clientX: rect.left + 200,
          clientY: rect.top + dragY + 20,
        }),
      );
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    const tintEl = host.querySelector(
      '[data-testid="box-zoom-lane-tint"]',
    ) as HTMLElement | null;
    expect(tintEl?.style.display).toBe("block");

    const screenDuringDrag = composeSnapshotCanvas(uplot, capture, {
      cursor1: "#E040FB",
      cursor2: "#B0B0B0",
      background: "#000000",
      legend: [],
      selected: null,
    });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(tintEl?.style.display).toBe("none");

    const screenAfterCancel = composeSnapshotCanvas(uplot, capture, {
      cursor1: "#E040FB",
      cursor2: "#B0B0B0",
      background: "#000000",
      legend: [],
      selected: null,
    });
    expect(screenDuringDrag.canvas.width).toBe(screenAfterCancel.canvas.width);
    expect(screenDuringDrag.canvas.height).toBe(
      screenAfterCancel.canvas.height,
    );
    const afterCancelBytes = screenAfterCancel.canvas
      .getContext("2d")!
      .getImageData(
        0,
        0,
        screenAfterCancel.canvas.width,
        screenAfterCancel.canvas.height,
      ).data;
    const dragBytes = screenDuringDrag.canvas
      .getContext("2d")!
      .getImageData(
        0,
        0,
        screenDuringDrag.canvas.width,
        screenDuringDrag.canvas.height,
      ).data;
    let diffBytes = 0;
    for (let i = 0; i < afterCancelBytes.length; i += 1) {
      if (afterCancelBytes[i] !== dragBytes[i]) diffBytes += 1;
    }
    expect(diffBytes).toBe(0);

    const series: PrintSeriesSpec[] = capture.channels.map((channel) => ({
      label: channel.name,
      color: "#FFD700",
      show: true,
    }));
    const printPxRatio = pxRatioOf(uplot);
    const printYBoundary =
      uplot.bbox.top / printPxRatio + 0.25 * (uplot.bbox.height / printPxRatio);
    const printPlotLeft = uplot.bbox.left / printPxRatio;
    const printPlotRight = printPlotLeft + uplot.bbox.width / printPxRatio;
    const [printAxisLeft, printAxisRight] = axisTitleStripRange(uplot);
    const print = await composePrintSnapshot(
      uplot,
      capture,
      {
        cursor1: "#E040FB",
        cursor2: "#B0B0B0",
        background: "#FFFFFF",
        legend: [],
        selected: null,
      },
      {
        series,
        renderContext: buildPrintRenderContext(capture, series, "light"),
      },
    );
    // Print path: light laneSeparator (#64748B) across both plot and y-axis column.
    expect(
      separatorRowInRange(
        print.canvas.getContext("2d")!,
        print.pixelRatio,
        printYBoundary,
        printPlotLeft + 20,
        printPlotRight - 20,
        [100, 116, 139],
      ),
    ).toBe(true);
    expect(
      separatorRowInRange(
        print.canvas.getContext("2d")!,
        print.pixelRatio,
        printYBoundary,
        printAxisLeft,
        printAxisRight,
        [100, 116, 139],
      ),
    ).toBe(true);
  });
});

describe("Stack-view boundary tick-label collision suppression (issue #371)", () => {
  let host: HTMLDivElement;
  let root: Root;

  const mountFullUi = async (): Promise<uPlot> => {
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
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(mounted).not.toBeNull();
    return mounted!;
  };

  const settle = async (ms = 80): Promise<void> => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  };

  const enableStack = async (): Promise<void> => {
    await act(async () => {
      useChannelDisplayStore.getState().setStackMode(true);
    });
    await settle(250);
  };

  function hasNonNullCollision(u: uPlot): boolean {
    const capture = useCaptureStore.getState().capture!;
    const bands = laneBandsCss(u, getLiveRenderState(capture));
    for (let i = 0; i < bands.length - 1; i += 1) {
      const upperAxis = axisOf(u, bands[i]!.scaleKey);
      const lowerAxis = axisOf(u, bands[i + 1]!.scaleKey);
      const upperSplits = upperAxis._splits ?? [];
      const upperVals = upperAxis._values ?? [];
      const lowerSplits = lowerAxis._splits ?? [];
      const lowerVals = lowerAxis._values ?? [];

      let upperMaxY = -Infinity;
      upperVals.forEach((v, k) => {
        if (v == null) return;
        const y = u.valToPos(upperSplits[k]!, bands[i]!.scaleKey);
        if (y > upperMaxY) upperMaxY = y;
      });
      let lowerMinY = Infinity;
      lowerVals.forEach((v, k) => {
        if (v == null) return;
        const y = u.valToPos(lowerSplits[k]!, bands[i + 1]!.scaleKey);
        if (y < lowerMinY) lowerMinY = y;
      });

      if (
        Number.isFinite(upperMaxY) &&
        Number.isFinite(lowerMinY) &&
        lowerMinY - upperMaxY < TICK_LABEL_COLLISION_HEIGHT_PX
      ) {
        return true;
      }
    }
    return false;
  }

  function hasCanvasInk(
    canvas: HTMLCanvasElement,
    pixelRatio: number,
    color: string,
    rect: { x0: number; x1: number; y0: number; y1: number },
  ): boolean {
    const ctx = canvas.getContext("2d")!;
    const [r, g, b] = hexToRgb(color);
    const x0 = Math.max(0, Math.floor(rect.x0 * pixelRatio));
    const x1 = Math.min(canvas.width - 1, Math.ceil(rect.x1 * pixelRatio));
    const y0 = Math.max(0, Math.floor(rect.y0 * pixelRatio));
    const y1 = Math.min(canvas.height - 1, Math.ceil(rect.y1 * pixelRatio));
    const data = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
    for (let i = 0; i < data.length; i += 4) {
      if (
        Math.abs(data[i]! - r) < 60 &&
        Math.abs(data[i + 1]! - g) < 60 &&
        Math.abs(data[i + 2]! - b) < 60
      ) {
        return true;
      }
    }
    return false;
  }

  beforeEach(async () => {
    useBadgePopoverStore.getState().setOpen(null);
    window.localStorage.clear();
    resetSession();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
    useChannelNamesStore.setState({ fileKey: null, names: {} });
    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(fourChUrlQ), "four-371.fvf");
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

  it("AC1-AC5 & AC7: hides upper colliding label, preserves lower label + ticks/grid + outer edges + overlay + PNG parity", async () => {
    const uplot = await mountFullUi();
    await act(async () => {
      useViewportStore.getState().setActiveChannels(["A", "B"]);
    });
    await settle(150);
    await enableStack();

    // Force exact boundary ticks: A has -1 at y=0.5*H, B has 2 at y=0.5*H.
    const lanedA = stackLaneBoundsWeighted({ min: -1, max: 1 }, 0, 0.5);
    const lanedB = stackLaneBoundsWeighted({ min: -2, max: 2 }, 0.5, 0.5);
    await act(async () => {
      uplot.batch(() => {
        uplot.setScale("y0", { min: lanedA.min, max: lanedA.max });
        uplot.setScale("y1", { min: lanedB.min, max: lanedB.max });
      });
    });
    await settle(150);

    const axisA = axisOf(uplot, "y0");
    const axisB = axisOf(uplot, "y1");
    const splitsA = axisA._splits ?? [];
    const valuesA = axisA._values ?? [];
    const splitsB = axisB._splits ?? [];
    const valuesB = axisB._values ?? [];

    const idxABoundary = splitsA.findIndex((s) => Math.abs(s - -1) < 1e-6);
    const idxATop = splitsA.findIndex((s) => Math.abs(s - 1) < 1e-6);
    const idxBBoundary = splitsB.findIndex((s) => Math.abs(s - 2) < 1e-6);
    const idxBBottom = splitsB.findIndex((s) => Math.abs(s - -2) < 1e-6);

    expect(idxABoundary).toBeGreaterThanOrEqual(0);
    expect(idxATop).toBeGreaterThanOrEqual(0);
    expect(idxBBoundary).toBeGreaterThanOrEqual(0);
    expect(idxBBottom).toBeGreaterThanOrEqual(0);

    // AC2 + AC5: upper boundary label suppressed, lower boundary label kept, outer edges kept.
    expect(valuesA[idxABoundary]).toBeNull();
    expect(valuesA[idxATop]).not.toBeNull();
    expect(valuesB[idxBBoundary]).not.toBeNull();
    expect(valuesB[idxBBottom]).not.toBeNull();
    expect(hasNonNullCollision(uplot)).toBe(false);

    // AC4: tick marks and grid lines still include the boundary splits.
    const rawAxisA = uplot.axes.find((a) => a.scale === "y0") as unknown as {
      ticks: { filter: (u: uPlot, splits: number[]) => (number | null)[] };
      grid: { filter: (u: uPlot, splits: number[]) => (number | null)[] };
    };
    expect(rawAxisA.ticks.filter(uplot, splitsA)[idxABoundary]).not.toBeNull();
    expect(rawAxisA.grid.filter(uplot, splitsA)[idxABoundary]).not.toBeNull();

    // AC7: PNG export parity (screen + print paths).
    const capture = useCaptureStore.getState().capture!;
    const pxRatio = pxRatioOf(uplot);
    const plotTop = uplot.bbox.top / pxRatio;
    const yBoundary = plotTop + 0.5 * (uplot.bbox.height / pxRatio);
    const labelRect = {
      x0: (axisA._pos ?? 60) - (axisA._size ?? 40) + 1,
      x1: (axisA._pos ?? 60) - 16,
      y0: yBoundary - TICK_LABEL_HALF_HEIGHT_PX,
      y1: yBoundary + TICK_LABEL_HALF_HEIGHT_PX,
    };

    const screen = composeSnapshotCanvas(uplot, capture, {
      cursor1: "#E040FB",
      cursor2: "#B0B0B0",
      background: "#000000",
      legend: [],
      selected: null,
    });
    expect(
      hasCanvasInk(screen.canvas, screen.pixelRatio, "#FFD700", labelRect),
    ).toBe(false);
    expect(
      hasCanvasInk(screen.canvas, screen.pixelRatio, "#00BFFF", labelRect),
    ).toBe(true);

    const series: PrintSeriesSpec[] = capture.channels.map((channel, i) => ({
      label: channel.name,
      color: ["#B8860B", "#1E90FF", "#B22222", "#228B22"][i]!,
      show: i < 2,
    }));
    const print = await composePrintSnapshot(
      uplot,
      capture,
      {
        cursor1: "#6A1B9A",
        cursor2: "#4B5563",
        background: "#FFFFFF",
        legend: [],
        selected: null,
      },
      {
        series,
        omitGrid: true,
        renderContext: buildPrintRenderContext(capture, series, "light"),
      },
    );
    expect(
      hasCanvasInk(print.canvas, print.pixelRatio, "#B8860B", labelRect),
    ).toBe(false);
    expect(
      hasCanvasInk(print.canvas, print.pixelRatio, "#1E90FF", labelRect),
    ).toBe(true);

    // AC5: switching back to Overlay leaves every non-ground-flag label visible.
    await act(async () => {
      useChannelDisplayStore.getState().setStackMode(false);
    });
    await settle(200);
    const overlayA = axisOf(uplot, "y0");
    const overlaySplitsA = overlayA._splits ?? [];
    expect(overlaySplitsA.length).toBeGreaterThan(0);
    expect(
      (overlayA._values ?? []).every(
        (v, idx) => Math.abs(overlaySplitsA[idx] ?? 0) < 1e-6 || v != null,
      ),
    ).toBe(true);
  });

  it("AC2 & AC8: leaves all labels intact at a non-colliding boundary", async () => {
    const uplot = await mountFullUi();
    await act(async () => {
      useViewportStore.getState().setActiveChannels(["A", "B"]);
    });
    await settle(150);
    await enableStack();

    // A's bottom edge is -1.2 (last tick -1 sits ~18px above boundary), B's top edge is 2 (tick 2 sits on boundary).
    const lanedA = stackLaneBoundsWeighted({ min: -1.2, max: 1 }, 0, 0.5);
    const lanedB = stackLaneBoundsWeighted({ min: -2, max: 2 }, 0.5, 0.5);
    await act(async () => {
      uplot.batch(() => {
        uplot.setScale("y0", { min: lanedA.min, max: lanedA.max });
        uplot.setScale("y1", { min: lanedB.min, max: lanedB.max });
      });
    });
    await settle(150);

    const axisA = axisOf(uplot, "y0");
    const axisB = axisOf(uplot, "y1");
    const splitsA = axisA._splits ?? [];
    const valuesA = axisA._values ?? [];
    const splitsB = axisB._splits ?? [];
    const valuesB = axisB._values ?? [];

    const idxABottom = splitsA.findIndex((s) => Math.abs(s - -1) < 1e-6);
    const idxBTop = splitsB.findIndex((s) => Math.abs(s - 2) < 1e-6);
    expect(idxABottom).toBeGreaterThanOrEqual(0);
    expect(idxBTop).toBeGreaterThanOrEqual(0);
    expect(valuesA[idxABottom]).not.toBeNull();
    expect(valuesB[idxBTop]).not.toBeNull();
    expect(hasNonNullCollision(uplot)).toBe(false);
  });

  it("AC6: no boundary label collisions across 3/4 lanes, lane resize (including min height), and lane zoom/pan", async () => {
    const uplot = await mountFullUi();
    await enableStack();
    expect(hasNonNullCollision(uplot)).toBe(false);

    // 3 lanes
    await act(async () => {
      useViewportStore.getState().setActiveChannels(["A", "B", "C"]);
    });
    await settle(200);
    expect(hasNonNullCollision(uplot)).toBe(false);

    // Back to 4 lanes, resize B to minimum 10% fraction
    await act(async () => {
      useViewportStore.getState().setActiveChannels(["A", "B", "C", "D"]);
      useLaneLayoutStore.getState().setWeights({ A: 3, B: 1, C: 3, D: 3 });
    });
    await settle(200);
    expect(hasNonNullCollision(uplot)).toBe(false);

    // Zoom/pan lanes to exact colliding boundary ticks after resize
    const lanedA = stackLaneBoundsWeighted({ min: -1, max: 1 }, 0, 0.3);
    const lanedB = stackLaneBoundsWeighted({ min: -5, max: 5 }, 0.3, 0.1);
    const lanedC = stackLaneBoundsWeighted({ min: -2, max: 2 }, 0.4, 0.3);
    await act(async () => {
      uplot.batch(() => {
        uplot.setScale("y0", { min: lanedA.min, max: lanedA.max });
        uplot.setScale("y1", { min: lanedB.min, max: lanedB.max });
        uplot.setScale("y2", { min: lanedC.min, max: lanedC.max });
      });
    });
    await settle(150);
    expect(hasNonNullCollision(uplot)).toBe(false);
  });
});
