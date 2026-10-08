import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type uPlot from "uplot";
import fourChUrlQ from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import twoChMinUrlQ from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-2ch-10000-1min-div.fvf.bin?url";
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
import {
  composePrintSnapshot,
  composeSnapshotCanvas,
  type PrintSeriesSpec,
} from "../export/pngSnapshot";

/**
 * Issue #249 acceptance: the draggable ground-marker flags live on each
 * channel's OWN left y-axis column (not inside the plot — the reported
 * defect was trace occlusion), stay canvas-drawn with PNG export parity
 * on both export paths, keep every #98 interaction path verbatim, and
 * clamp to the band edge with a directional cue when a large offset
 * pushes 0V out of view.
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

interface AxisLayout {
  _pos: number;
  _size: number;
  _lpos: number;
}

function axisFor(u: uPlot, scaleKey: string): AxisLayout {
  const axis = u.axes.find(
    (a) => a.scale === scaleKey,
  ) as unknown as AxisLayout;
  expect(axis, `axis for ${scaleKey}`).toBeDefined();
  return axis;
}

/** True when the canvas holds a pixel of the color within the rect (CSS px, root-relative). */
function canvasHasColor(
  u: uPlot,
  color: string,
  rect: { x0: number; x1: number; y0: number; y1: number },
): boolean {
  const pxRatio = u.width > 0 ? u.ctx.canvas.width / u.width : 1;
  const ctx = u.ctx;
  const [r, g, b] = hexToRgb(color);
  const x0 = Math.max(0, Math.floor(rect.x0 * pxRatio));
  const x1 = Math.min(ctx.canvas.width - 1, Math.ceil(rect.x1 * pxRatio));
  const y0 = Math.max(0, Math.floor(rect.y0 * pxRatio));
  const y1 = Math.min(ctx.canvas.height - 1, Math.ceil(rect.y1 * pxRatio));
  const data = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
  for (let i = 0; i < data.length; i += 4) {
    if (
      Math.abs(data[i]! - r) < 40 &&
      Math.abs(data[i + 1]! - g) < 40 &&
      Math.abs(data[i + 2]! - b) < 40
    ) {
      return true;
    }
  }
  return false;
}

function compositeHasColor(
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
      Math.abs(data[i]! - r) < 40 &&
      Math.abs(data[i + 1]! - g) < 40 &&
      Math.abs(data[i + 2]! - b) < 40
    ) {
      return true;
    }
  }
  return false;
}

describe("Ground flags on per-channel y-axis columns (issue #249)", () => {
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

  const settle = async (ms = 40): Promise<void> => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  };

  const stripFor = (key: string): HTMLElement =>
    document.querySelector(
      `[data-testid='ground-marker-${key}']`,
    ) as HTMLElement;

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

  it("AC1: every visible channel's flag renders inside its own axis column — nothing inside the plot area", async () => {
    const uplot = await mountFullUi();
    const capture = useCaptureStore.getState().capture!;
    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const plotLeftCss = uplot.bbox.left / pxRatio;
    const rootRect = uplot.root.getBoundingClientRect();

    expect(capture.channels.length).toBe(4);
    for (const name of ["A", "B", "C", "D"]) {
      const strip = stripFor(name);
      expect(strip, `strip for ${name}`).not.toBeNull();
      const idx = capture.channels.findIndex((c) => c.name === name);
      const axis = axisFor(uplot, yScaleKey(idx));
      const rect = strip.getBoundingClientRect();
      // Entirely inside the channel's own column…
      expect(rect.left).toBeGreaterThanOrEqual(
        rootRect.left + axis._lpos - 20 - 1,
      );
      expect(rect.right).toBeLessThanOrEqual(rootRect.left + axis._pos + 1);
      // …whose right edge never crosses into the plot area (the
      // plot-adjacent column touches the border exactly).
      expect(rect.right).toBeLessThanOrEqual(rootRect.left + plotLeftCss + 1);
    }

    // Canvas ink: the A flag (gold #FFD700) paints inside A's column
    // near the displayed 0V baseline; the plot area itself holds no
    // flag ink — only the trace, whose pixels belong to the plot, not
    // the column. The column check proves the flag geometry.
    const axisA = axisFor(uplot, yScaleKey(0));
    const zeroY = uplot.valToPos(0, yScaleKey(0));
    const plotTopCss = uplot.bbox.top / pxRatio;
    expect(
      canvasHasColor(uplot, "#FFD700", {
        x0: axisA._lpos - 20,
        x1: axisA._pos,
        y0: plotTopCss + zeroY - 12,
        y1: plotTopCss + zeroY + 12,
      }),
    ).toBe(true);
  });

  it("AC2: PNG snapshots composite the column flags on both export paths", async () => {
    const uplot = await mountFullUi();
    const capture = useCaptureStore.getState().capture!;
    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const axisA = axisFor(uplot, yScaleKey(0));
    const zeroY = uplot.valToPos(0, yScaleKey(0));
    const plotTopCss = uplot.bbox.top / pxRatio;
    const flagRect = {
      x0: axisA._lpos - 20,
      x1: axisA._pos,
      y0: plotTopCss + zeroY - 12,
      y1: plotTopCss + zeroY + 12,
    };

    // Screen path: the composited raster keeps the column flag.
    const screen = composeSnapshotCanvas(uplot, capture, {
      cursor1: "#FFD700",
      cursor2: "#00BFFF",
      background: "#0C0C0C",
      legend: [],
      selected: null,
    });
    expect(
      compositeHasColor(screen.canvas, screen.pixelRatio, "#FFD700", flagRect),
    ).toBe(true);

    // Print (inverted) path: the offscreen render composites the flag
    // with the print strokes on the same column geometry.
    const series: PrintSeriesSpec[] = capture.channels.map((channel) => ({
      label: channel.name,
      color: "#FFD700",
      show: true,
    }));
    const print = await composePrintSnapshot(
      uplot,
      capture,
      {
        cursor1: "#FFD700",
        cursor2: "#00BFFF",
        background: "#FFFFFF",
        legend: [],
        selected: null,
      },
      { series },
    );
    expect(
      compositeHasColor(print.canvas, print.pixelRatio, "#FFD700", flagRect),
    ).toBe(true);
  });

  it("AC3+AC4: strip drag adjusts the offset at rAF cadence; reset paths unchanged", async () => {
    const uplot = await mountFullUi();
    const strip = stripFor("A");
    const rect = strip.getBoundingClientRect();

    await act(async () => {
      strip.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: rect.left + 10,
          clientY: rect.top + 10,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          buttons: 1,
          clientX: rect.left + 10,
          clientY: rect.top + 40,
        }),
      );
    });
    await settle();
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: rect.left + 10,
          clientY: rect.top + 40,
        }),
      );
    });

    const offset = useChannelDisplayStore.getState().keyConfigs.A?.offset;
    expect(offset).toBeDefined();
    expect(offset!).toBeLessThan(0);

    // Double-click reset still works (verbatim #98 path).
    await act(async () => {
      strip.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });
    expect(
      useChannelDisplayStore.getState().keyConfigs.A?.offset,
    ).toBeUndefined();

    // Enter on the focused strip resets after a fresh offset.
    act(() => {
      useChannelDisplayStore.getState().setOffset("A", 2);
    });
    await settle();
    await act(async () => {
      strip.focus();
      strip.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(useChannelDisplayStore.getState().keyConfigs.A?.offset ?? 0).toBe(0);

    // Arrow-key nudging (Shift = ×10) survives verbatim.
    await act(async () => {
      strip.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(useChannelDisplayStore.getState().keyConfigs.A?.offset).toBe(10);
    void uplot;
  });

  it("AC5: a plain click on the strip selects the channel; a real drag does not re-select", async () => {
    await mountFullUi();
    const strip = stripFor("A");
    const rect = strip.getBoundingClientRect();

    act(() => {
      useViewportStore.getState().setSelectedChannel("B");
    });
    await settle();
    expect(useViewportStore.getState().selectedChannel).toBe("B");

    // Plain click (press + release, no movement): bubbles to the
    // axis-column click-to-select and selects channel A.
    await act(async () => {
      strip.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: rect.left + 10,
          clientY: rect.top + 10,
        }),
      );
      strip.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: rect.left + 10,
          clientY: rect.top + 10,
        }),
      );
      strip.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: rect.left + 10,
          clientY: rect.top + 10,
        }),
      );
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(useViewportStore.getState().selectedChannel).toBe("A");

    // A real drag on the strip adjusts the offset and swallows its
    // trailing click — the selection stays as-is.
    act(() => {
      useViewportStore.getState().setSelectedChannel("C");
      useChannelDisplayStore.getState().setOffset("A", 0);
    });
    await settle();
    await act(async () => {
      strip.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: rect.left + 10,
          clientY: rect.top + 10,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          buttons: 1,
          clientX: rect.left + 10,
          clientY: rect.top + 25,
        }),
      );
    });
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: rect.left + 10,
          clientY: rect.top + 25,
        }),
      );
      strip.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: rect.left + 10,
          clientY: rect.top + 25,
        }),
      );
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(
      useChannelDisplayStore.getState().keyConfigs.A?.offset ?? 0,
    ).toBeLessThan(0);
    expect(useViewportStore.getState().selectedChannel).toBe("C");
  });

  it("AC6: a baseline pushed out of the band clamps to the column edge with a cue and stays draggable", async () => {
    const uplot = await mountFullUi();
    const strip = stripFor("A");
    expect(strip.dataset.clamped).toBe("");

    act(() => {
      useChannelDisplayStore.getState().setOffset("A", 12000);
    });
    await settle();

    // The displayed 0V left the visible band: cue set, strip pinned at
    // the band edge (top edge here — the offset moves the baseline up).
    expect(strip.dataset.clamped === "up").toBe(true);
    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const plotTopCss = uplot.bbox.top / pxRatio;
    const rootRect = uplot.root.getBoundingClientRect();
    const stripCenter =
      strip.getBoundingClientRect().top + strip.offsetHeight / 2;
    expect(stripCenter).toBeLessThanOrEqual(rootRect.top + plotTopCss + 8 + 1);

    // Still draggable: dragging down pulls the baseline back into view.
    const rect = strip.getBoundingClientRect();
    await act(async () => {
      strip.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: rect.left + 10,
          clientY: rect.top + 10,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          buttons: 1,
          clientX: rect.left + 10,
          clientY: rect.top + 120,
        }),
      );
    });
    await settle();
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: rect.left + 10,
          clientY: rect.top + 120,
        }),
      );
    });
    const after = useChannelDisplayStore.getState().keyConfigs.A?.offset ?? 0;
    // Dragging down from the clamped flag pulled the baseline back
    // toward the view: 110 px at ~11.5 display units/px ≈ 1270 units.
    expect(after).toBeLessThan(12000 - 1000);
  });

  it("AC7: in Stack mode the flag renders within its channel's lane band", async () => {
    const uplot = await mountFullUi();
    const capture = useCaptureStore.getState().capture!;
    act(() => {
      useChannelDisplayStore.getState().setStackMode(true);
    });
    await settle(250);

    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const plotTopCss = uplot.bbox.top / pxRatio;
    const plotHeightCss = uplot.bbox.height / pxRatio;
    const laneCount = 4;
    const rootTop = uplot.root.getBoundingClientRect().top;
    capture.channels.forEach((channel, laneIndex) => {
      const strip = stripFor(channel.name);
      expect(strip, `strip for ${channel.name}`).not.toBeNull();
      const center = strip.getBoundingClientRect().top + strip.offsetHeight / 2;
      const laneTop =
        rootTop + plotTopCss + (laneIndex / laneCount) * plotHeightCss;
      const laneBottom =
        rootTop + plotTopCss + ((laneIndex + 1) / laneCount) * plotHeightCss;
      expect(center).toBeGreaterThanOrEqual(laneTop - 1);
      expect(center).toBeLessThanOrEqual(laneBottom + 1);
    });
  });

  it("AC8: degenerate states — all channels hidden leaves no flags; comparison teardown drops reference flags with their columns", async () => {
    await useReferenceStore
      .getState()
      .parseReferenceBuffer(await fixture(twoChMinUrlQ), "file2.fvf");
    const uplot = await mountFullUi();
    const capture = useCaptureStore.getState().capture!;

    // File 2 loaded: Ref-A owns an axis column and a flag on it.
    const refScaleKey = yScaleKey(capture.channels.length);
    const refAxis = uplot.axes.find((a) => a.scale === refScaleKey);
    expect(refAxis).toBeDefined();
    const refStrip = stripFor("Ref-A");
    expect(refStrip).not.toBeNull();
    const refAxisLayout = refAxis as unknown as AxisLayout;
    const rootRect = uplot.root.getBoundingClientRect();
    const refRect = refStrip.getBoundingClientRect();
    expect(refRect.left).toBeGreaterThanOrEqual(
      rootRect.left + refAxisLayout._lpos - 20 - 1,
    );
    expect(refRect.right).toBeLessThanOrEqual(
      rootRect.left + refAxisLayout._pos + 1,
    );

    // Teardown: reference flags (and columns) disappear with the lanes.
    await act(async () => {
      useReferenceStore.getState().clear();
      await new Promise((r) => setTimeout(r, 120));
    });
    expect(
      document.querySelector("[data-testid='ground-marker-Ref-A']"),
    ).toBeNull();

    // All channels hidden: no axis columns, no flags at all.
    act(() => {
      useViewportStore.getState().setActiveChannels([]);
    });
    await settle();
    for (const name of ["A", "B", "C", "D"]) {
      expect(
        document.querySelector(`[data-testid='ground-marker-${name}']`),
      ).toBeNull();
    }
  }, 60_000);

  it("review finding-1: with File 2 columns active, primary column clicks select the right channel and reference columns select nothing", async () => {
    await useReferenceStore
      .getState()
      .parseReferenceBuffer(await fixture(twoChMinUrlQ), "file2.fvf");
    const uplot = await mountFullUi();
    const capture = useCaptureStore.getState().capture!;

    act(() => {
      useViewportStore.getState().setSelectedChannel("B");
    });
    await settle();

    const container = document.querySelector(
      "[data-testid='oscilloscope-container']",
    ) as HTMLElement;
    const containerRect = container.getBoundingClientRect();
    const axisOf = (scaleKey: string) =>
      uplot.axes.find((a) => a.scale === scaleKey) as unknown as {
        _pos: number;
      };
    const clickColumn = (axis: { _pos: number }): void => {
      container.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: Math.round(containerRect.left + axis._pos - 20),
          clientY: Math.round(containerRect.top + 200),
        }),
      );
    };

    // The Ref columns shifted every primary column right; clicking inside
    // A's actual column still selects A (not D, whose column A's old
    // accumulated math would have matched).
    await act(async () => {
      clickColumn(axisOf(yScaleKey(0)));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(useViewportStore.getState().selectedChannel).toBe("A");

    // A reference column click leaves the selection untouched
    // (selection stays a primary concern, #96).
    const refScale = yScaleKey(capture.channels.length);
    await act(async () => {
      clickColumn(axisOf(refScale));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(useViewportStore.getState().selectedChannel).toBe("A");
  }, 60_000);
});
