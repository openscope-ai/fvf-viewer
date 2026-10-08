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
import { useCursorStore } from "../../state/cursorStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useThemeStore } from "../../state/themeStore";
import { useViewportStore } from "../../state/viewportStore";
import { useBadgePopoverStore } from "../toolbar/badgeConfig/anchoredPopover";
import { laneBandCss } from "./stackLaneDecorations";
import {
  composePrintSnapshot,
  composeSnapshotCanvas,
  type PrintSeriesSpec,
} from "../export/pngSnapshot";

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
   * width at a band boundary, so among the candidate device rows (the
   * boundary can land on a half-integer row) one row's modal color
   * equals the expected grid-over-background blend within tolerance.
   */
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
    for (const dy of [-1.5, -0.5, 0.5, 1.5]) {
      const mode = rowMode(
        u.ctx,
        pxRatio,
        plotLeft + 20,
        plotRight - 20,
        Math.floor(yBoundary) + dy,
      );
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

  beforeEach(async () => {
    useBadgePopoverStore.getState().setOpen(null);
    window.localStorage.clear();
    useChannelDisplayStore.getState().reset();
    useCaptureStore.getState().reset();
    useReferenceStore.getState().clear();
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
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
      const band = laneBandCss(uplot, capture, scaleKey);
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

  it("AC2: subtle lane separators span the plot width between adjacent lanes in Stack mode", async () => {
    const uplot = await mountFullUi();
    await enableStack();

    // Dark theme blend: #222222 at 50% over #000000 = (17,17,17).
    for (const fraction of [0.25, 0.5, 0.75]) {
      expect(
        separatorRow(uplot, fraction, [17, 17, 17]),
        `separator at boundary ${fraction}`,
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
        separatorRow(uplot, fraction, [17, 17, 17]),
        `no separator at ${fraction} in Overlay`,
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
    const bandOf = (scaleKey: string) => laneBandCss(uplot, capture, scaleKey);

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
    const axisA = axisOf(uplot, yScaleKey(0));
    await act(async () => {
      container.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: Math.round(rect.left + (axisA._pos ?? 60) - 20),
          clientY: Math.round(rect.top + 200),
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

  it("AC6: both themes render separators with their palette's grid color", async () => {
    const uplot = await mountFullUi();
    await enableStack();

    // Dark theme: #222222 at 50% over #000000 = (17,17,17).
    expect(separatorRow(uplot, 0.25, [17, 17, 17])).toBe(true);

    act(() => {
      useThemeStore.getState().setTheme("light");
    });
    await settle(200);
    // Light theme: #C8C8C8 at 50% over #FFFFFF = (230,230,230) — and
    // the dark blend is gone.
    expect(separatorRow(uplot, 0.25, [230, 230, 230])).toBe(true);
    expect(separatorRow(uplot, 0.25, [17, 17, 17])).toBe(false);
  });

  it("AC7: PNG snapshots composite the separators and band-scoped axes on both export paths", async () => {
    const uplot = await mountFullUi();
    const capture = useCaptureStore.getState().capture!;
    await enableStack();
    const pxRatio = pxRatioOf(uplot);
    const yBoundary =
      uplot.bbox.top / pxRatio + 0.25 * (uplot.bbox.height / pxRatio);
    const plotLeft = uplot.bbox.left / pxRatio;
    const plotRight = plotLeft + uplot.bbox.width / pxRatio;

    const hasSeparator = (
      canvas: HTMLCanvasElement,
      ratio: number,
      expected: [number, number, number],
    ): boolean => {
      const ctx = canvas.getContext("2d")!;
      for (const dy of [-1.5, -0.5, 0.5, 1.5]) {
        const mode = rowMode(
          ctx,
          ratio,
          plotLeft + 20,
          plotRight - 20,
          Math.floor(yBoundary) + dy,
        );
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

    const screen = composeSnapshotCanvas(uplot, capture, {
      cursor1: "#E040FB",
      cursor2: "#B0B0B0",
      background: "#000000",
      legend: [],
      selected: null,
    });
    // Screen path: dark blend over the #000000 composite background.
    expect(hasSeparator(screen.canvas, screen.pixelRatio, [17, 17, 17])).toBe(
      true,
    );

    const series: PrintSeriesSpec[] = capture.channels.map((channel) => ({
      label: channel.name,
      color: "#FFD700",
      show: true,
    }));
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
      { series },
    );
    // Print path: light grid over the white composite background.
    expect(hasSeparator(print.canvas, print.pixelRatio, [230, 230, 230])).toBe(
      true,
    );
  });
});
