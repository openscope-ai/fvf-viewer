import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import uPlot from "uplot";
import fourChUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import twoChMinUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-2ch-10000-1min-div.fvf.bin?url";
import Oscilloscope from "../canvas/Oscilloscope";
import { useCaptureStore } from "../../state/captureStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import { useViewportStore } from "../../state/viewportStore";
import { useCursorStore } from "../../state/cursorStore";
import { useCursorDisplayStore } from "../../state/cursorDisplayStore";
import {
  composePrintSnapshot,
  composeSnapshotCanvas,
  snapshotToBlob,
  type SnapshotOverlayState,
} from "./pngSnapshot";
import { useSnapshotStore } from "./snapshotStore";
import { usePngExportStore } from "../../state/pngExportStore";
import PngSnapshotButton, { snapshotFileName } from "./PngSnapshotButton";
import * as canvasPermission from "./canvasPermission";
import type { ParsedCapture } from "../../types/capture";
import { laneBandCss } from "../canvas/stackLaneDecorations";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching ${url}`).toBeTruthy();
  return response.arrayBuffer();
}

function colorAt(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
): [number, number, number] {
  const ctx = canvas.getContext("2d")!;
  const data = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
  return [data[0]!, data[1]!, data[2]!];
}

function hexToBytes(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function colorPresentInRegion(
  canvas: HTMLCanvasElement,
  x0: number,
  y0: number,
  width: number,
  height: number,
  target: [number, number, number],
): boolean {
  const ctx = canvas.getContext("2d")!;
  const image = ctx.getImageData(
    Math.round(x0),
    Math.round(y0),
    Math.round(width),
    Math.round(height),
  ).data;
  for (let index = 0; index < image.length; index += 4) {
    if (
      Math.abs(image[index]! - target[0]) <= 8 &&
      Math.abs(image[index + 1]! - target[1]) <= 8 &&
      Math.abs(image[index + 2]! - target[2]) <= 8
    ) {
      return true;
    }
  }
  return false;
}

function plotTopCss(bbox: uPlot.BBox, pixelRatio: number): number {
  return bbox.top / pixelRatio;
}

describe("PNG snapshot export (browser, issue #18)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;
  let capture: ParsedCapture;
  let mountedUplot: uPlot | null;

  beforeEach(async () => {
    useCaptureStore.getState().reset();
    useReferenceStore.getState().clear();
    useChannelDisplayStore.getState().reset();
    useChannelNamesStore.setState({ fileKey: null, names: {} });
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
    useSnapshotStore.getState().registerExporter(null);
    window.localStorage.clear();
    // Review F2: reset every settings field — non-default values written
    // by tests (theme light, etc.) must not leak into the next one.
    usePngExportStore.getState().setTheme("dark");
    usePngExportStore.getState().setBackground("opaque");
    usePngExportStore.getState().setReadoutCard("full");
    usePngExportStore.getState().setCursors(true);
    usePngExportStore.getState().setGrid(true);
    usePngExportStore.getState().setFileName("");

    hostElement = document.createElement("div");
    hostElement.style.width = "800px";
    hostElement.style.height = "600px";
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);

    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(fourChUrl), "four.fvf");
    capture = useCaptureStore.getState().capture!;
    mountedUplot = null;

    await act(async () => {
      root.render(
        <div
          style={{ display: "flex", flexDirection: "column", height: "600px" }}
        >
          <Oscilloscope
            capture={capture}
            onUPlotInit={(u) => {
              mountedUplot = u;
            }}
          />
        </div>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(mountedUplot).not.toBeNull();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    hostElement.remove();
    useCaptureStore.getState().reset();
    useReferenceStore.getState().clear();
    useChannelDisplayStore.getState().reset();
    useChannelNamesStore.setState({ fileKey: null, names: {} });
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
    useSnapshotStore.getState().registerExporter(null);
  });

  function overlay(
    legend: Array<{ label: string; color: string }>,
  ): SnapshotOverlayState {
    return {
      cursor1: "#E040FB",
      cursor2: "#B0B0B0",
      background: "#000000",
      legend,
      selected: "C1",
    };
  }

  it("composites cursor lines, handles, and legend on top of the base canvas (dpr 1)", async () => {
    const uplot = mountedUplot!;
    const total = capture.timestamps.length;
    useCursorStore.getState().initForCapture(total);
    useCursorStore.getState().toggleCursor("C1", total);
    useCursorStore
      .getState()
      .setCursorSample("C1", Math.floor(total / 4), total);

    const legend = capture.channels.map((channel) => ({
      label: channel.label,
      color: ["#FFD700", "#00BFFF", "#FF4500", "#00FF7F"][
        capture.channels.indexOf(channel)
      ]!,
    }));
    const composite = composeSnapshotCanvas(uplot, capture, overlay(legend), {
      pixelRatio: 1,
      cursor: {
        c1Active: true,
        c1SampleIndex: Math.floor(total / 4),
        c2Active: false,
        c2SampleIndex: 0,
      },
    });

    expect(composite.cssWidth).toBe(uplot.width);
    expect(composite.canvas.width).toBe(uplot.width); // dpr 1
    expect(composite.canvas.height).toBe(uplot.height);

    const bbox = uplot.bbox;
    const c1 = hexToBytes("#E040FB");
    // The base canvas alone has NO cursor pixels (the live cursor is a DOM
    // overlay) — finding C1 color on the composite proves the explicit
    // overlay re-draw happened.
    expect(
      colorPresentInRegion(
        composite.canvas,
        bbox.left,
        bbox.top,
        bbox.width,
        bbox.height,
        c1,
      ),
    ).toBe(true);

    // The live base canvas has no such column.
    expect(
      colorPresentInRegion(
        uplot.ctx.canvas,
        bbox.left,
        bbox.top,
        bbox.width,
        bbox.height,
        c1,
      ),
    ).toBe(false);

    // Cursor line sits at plotLeft + valToPos(C1 time) in composite
    // coordinates: valToPos is plot-area-relative, bbox.left offsets it
    // into the full chart (F1 regression: bare valToPos must NOT match).
    const x1 = uplot.valToPos(capture.timestamps[Math.floor(total / 4)]!, "x");
    const plotLeftCss = bbox.left / composite.pixelRatio;
    const trueX = plotLeftCss + x1;
    const midY =
      plotTopCss(bbox, composite.pixelRatio) +
      bbox.height / composite.pixelRatio / 2;
    const near = (x: number) => {
      const [r, g, b] = colorAt(composite.canvas, x, midY);
      return (
        Math.abs(r - c1[0]) <= 8 &&
        Math.abs(g - c1[1]) <= 8 &&
        Math.abs(b - c1[2]) <= 8
      );
    };
    expect([trueX - 2, trueX - 1, trueX, trueX + 1, trueX + 2].some(near)).toBe(
      true,
    );
    // The plot-relative-only column (40 CSS px left of the true line) has
    // no cursor color — the offset bug would paint there instead.
    if (trueX - x1 > 4) {
      expect([x1 - 2, x1 - 1, x1, x1 + 1, x1 + 2].some(near)).toBe(false);
    }

    // Legend swatch for channel A drawn at the top-left of the plot area.
    const channelA = hexToBytes("#FFD700");
    expect(
      colorPresentInRegion(
        composite.canvas,
        bbox.left + 4,
        bbox.top,
        40,
        30,
        channelA,
      ),
    ).toBe(true);
  });

  it("pins recovery badges at the margins for out-of-view cursors and skips their lines", async () => {
    const uplot = mountedUplot!;
    const total = capture.timestamps.length;
    useCursorStore.getState().initForCapture(total);

    // Zoom to the middle half so sample 0 and sample N-1 are outside view.
    // uPlot defers scale commits to a microtask — let it flush before the
    // composite reads scales.
    uplot.setScale("x", {
      min: capture.timestamps[Math.floor(total * 0.25)]!,
      max: capture.timestamps[Math.floor(total * 0.75)]!,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    const composite = composeSnapshotCanvas(uplot, capture, overlay([]), {
      pixelRatio: 1,
      cursor: {
        c1Active: true,
        c1SampleIndex: 0,
        c2Active: true,
        c2SampleIndex: total - 1,
      },
    });

    const bbox = uplot.bbox;
    const c1 = hexToBytes("#E040FB");
    const c2 = hexToBytes("#B0B0B0");

    // C1 badge pinned top-left, C2 badge pinned top-right.
    expect(
      colorPresentInRegion(composite.canvas, bbox.left, bbox.top, 80, 56, c1),
    ).toBe(true);
    expect(
      colorPresentInRegion(
        composite.canvas,
        bbox.left + bbox.width - 80,
        bbox.top,
        80,
        56,
        c2,
      ),
    ).toBe(true);

    // No cursor line pixels mid-plot: both cursors are outside the window.
    const midY = bbox.top + bbox.height / 2;
    const imageData = composite.canvas
      .getContext("2d")!
      .getImageData(
        Math.round(bbox.left),
        Math.round(midY),
        Math.round(bbox.width),
        1,
      ).data;
    let matches = 0;
    for (let index = 0; index < imageData.length; index += 4) {
      if (
        (Math.abs(imageData[index]! - c1[0]) <= 8 &&
          Math.abs(imageData[index + 1]! - c1[1]) <= 8 &&
          Math.abs(imageData[index + 2]! - c1[2]) <= 8) ||
        (Math.abs(imageData[index]! - c2[0]) <= 8 &&
          Math.abs(imageData[index + 1]! - c2[1]) <= 8 &&
          Math.abs(imageData[index + 2]! - c2[2]) <= 8)
      ) {
        matches += 1;
      }
    }
    expect(matches).toBe(0);
  });

  it("renders both cursors inside the window as full-height lines", async () => {
    const uplot = mountedUplot!;
    const total = capture.timestamps.length;
    useCursorStore.getState().initForCapture(total);

    const composite = composeSnapshotCanvas(uplot, capture, overlay([]), {
      pixelRatio: 1,
      cursor: {
        c1Active: true,
        c1SampleIndex: Math.floor(total * 0.25),
        c2Active: true,
        c2SampleIndex: Math.floor(total * 0.75),
      },
    });

    const bbox = uplot.bbox;
    const midY = bbox.top + bbox.height / 2; // dpr 1: bbox is CSS px
    const c1 = hexToBytes("#E040FB");
    const c2 = hexToBytes("#B0B0B0");
    // valToPos is plot-area-relative; bbox.left offsets into the chart.
    const plotLeftCss = bbox.left; // dpr 1
    const x1 =
      plotLeftCss +
      uplot.valToPos(capture.timestamps[Math.floor(total * 0.25)]!, "x");
    const x2 =
      plotLeftCss +
      uplot.valToPos(capture.timestamps[Math.floor(total * 0.75)]!, "x");

    const near = (x: number, target: [number, number, number]) =>
      [x - 2, x - 1, x, x + 1, x + 2].some((xi) => {
        const [r, g, b] = colorAt(composite.canvas, xi, midY);
        return (
          Math.abs(r - target[0]) <= 8 &&
          Math.abs(g - target[1]) <= 8 &&
          Math.abs(b - target[2]) <= 8
        );
      });

    expect(near(x1, c1)).toBe(true);
    expect(near(x2, c2)).toBe(true);
  });

  it("exports at device pixel ratio (backing store scaled, overlay crisp)", async () => {
    const uplot = mountedUplot!;
    const total = capture.timestamps.length;

    const composite = composeSnapshotCanvas(uplot, capture, overlay([]), {
      pixelRatio: 2,
      cursor: {
        c1Active: true,
        c1SampleIndex: Math.floor(total / 4),
        c2Active: false,
        c2SampleIndex: 0,
      },
    });

    expect(composite.canvas.width).toBe(uplot.width * 2);
    expect(composite.canvas.height).toBe(uplot.height * 2);

    // Native-resolution overlay: the C1 line lands exactly at
    // bbox.left*(2/1) + 2*valToPos on the 2x backing store with
    // full-intensity color (no interpolation wash-out). Here the uPlot
    // instance renders at dpr 1 (headless), so bbox is CSS px and the
    // export ratio doubles both offsets.
    const bbox = uplot.bbox;
    const c1 = hexToBytes("#E040FB");
    const x1 =
      bbox.left * 2 +
      uplot.valToPos(capture.timestamps[Math.floor(total / 4)]!, "x") * 2;
    const midY = (bbox.top + bbox.height / 2) * 2;
    const scaled = [x1 - 4, x1 - 2, x1, x1 + 2, x1 + 4].some((x) => {
      const [r, g, b] = colorAt(composite.canvas, x, midY);
      return (
        Math.abs(r - c1[0]) <= 8 &&
        Math.abs(g - c1[1]) <= 8 &&
        Math.abs(b - c1[2]) <= 8
      );
    });
    expect(scaled).toBe(true);

    const blob = await snapshotToBlob(composite.canvas);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("print variant renders white background, dark graticule, contrast traces (AC #39)", async () => {
    const uplot = mountedUplot!;
    const total = capture.timestamps.length;
    const printOverlay: SnapshotOverlayState = {
      cursor1: "#6A1B9A",
      cursor2: "#4B5563",
      background: "#FFFFFF",
      legend: [{ label: "Input A", color: "#B8860B" }],
      selected: "C1",
    };

    const composite = await composePrintSnapshot(uplot, capture, printOverlay, {
      pixelRatio: 1,
      cursor: {
        c1Active: true,
        c1SampleIndex: Math.floor(total / 4),
        c2Active: false,
        c2SampleIndex: 0,
      },
      series: capture.channels.map((channel, index) => ({
        label: channel.label,
        color: ["#B8860B", "#1E90FF", "#B22222", "#228B22"][index]!,
        show: index < 4,
      })),
    });

    // White background fills the axis margins too (corner + near-corner).
    const corner = colorAt(composite.canvas, 2, 2);
    expect(corner).toEqual([255, 255, 255]);

    // Dark graticule lines (#C8C8C8) present inside the plot area.
    const bbox = uplot.bbox;
    expect(
      colorPresentInRegion(
        composite.canvas,
        bbox.left,
        bbox.top,
        bbox.width,
        bbox.height,
        hexToBytes("#C8C8C8"),
      ),
    ).toBe(true);

    // Contrast-adapted trace stroke (#B8860B) rendered.
    expect(
      colorPresentInRegion(
        composite.canvas,
        bbox.left,
        bbox.top,
        bbox.width,
        bbox.height,
        hexToBytes("#B8860B"),
      ),
    ).toBe(true);

    // Accurate C1 cursor overlay (light cursor color) at chart coordinates.
    const c1Light = hexToBytes("#6A1B9A");
    const x1 =
      bbox.left / 1 +
      uplot.valToPos(capture.timestamps[Math.floor(total / 4)]!, "x") * 1;
    const midY = bbox.top + bbox.height / 2;
    expect(
      [x1 - 2, x1 - 1, x1, x1 + 1, x1 + 2].some((x) => {
        const [r, g, b] = colorAt(composite.canvas, x, midY);
        return (
          Math.abs(r - c1Light[0]) <= 8 &&
          Math.abs(g - c1Light[1]) <= 8 &&
          Math.abs(b - c1Light[2]) <= 8
        );
      }),
    ).toBe(true);
  });

  it("leaves the live viewport completely unchanged while generating the print snapshot", async () => {
    const uplot = mountedUplot!;
    const total = capture.timestamps.length;
    useCursorStore.getState().initForCapture(total);
    useCursorStore.getState().toggleCursor("C1", total);
    useCursorStore
      .getState()
      .setCursorSample("C1", Math.floor(total / 4), total);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    const liveBefore = uplot.ctx.canvas.toDataURL();
    const cursorLineBefore = hostElement.querySelector(
      "[data-testid='cursor-line-c1']",
    ) as HTMLElement;
    expect(cursorLineBefore).not.toBeNull();

    await composePrintSnapshot(
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
        pixelRatio: 1,
        cursor: {
          c1Active: true,
          c1SampleIndex: Math.floor(total / 4),
          c2Active: false,
          c2SampleIndex: 0,
        },
        series: capture.channels.map((channel) => ({
          label: channel.label,
          color: "#B8860B",
          show: true,
        })),
      },
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(uplot.ctx.canvas.toDataURL()).toBe(liveBefore);
    expect(uplot.scales.x?.min).not.toBeNull();
    const cursorLineAfter = hostElement.querySelector(
      "[data-testid='cursor-line-c1']",
    ) as HTMLElement;
    expect(cursorLineAfter).toBe(cursorLineBefore);
    expect(cursorLineAfter.style.display).toBe("block");
  });

  it("maintains device pixel ratio fidelity in the print variant", async () => {
    const uplot = mountedUplot!;
    const total = capture.timestamps.length;

    const composite = await composePrintSnapshot(
      uplot,
      capture,
      {
        cursor1: "#6A1B9A",
        cursor2: "#4B5563",
        background: "#FFFFFF",
        legend: [],
        selected: "C1",
      },
      {
        pixelRatio: 2,
        cursor: {
          c1Active: true,
          c1SampleIndex: Math.floor(total / 4),
          c2Active: false,
          c2SampleIndex: 0,
        },
        series: capture.channels.map((channel) => ({
          label: channel.label,
          color: "#B8860B",
          show: true,
        })),
      },
    );

    expect(composite.canvas.width).toBe(uplot.width * 2);
    expect(composite.canvas.height).toBe(uplot.height * 2);
    // White corners at 2x.
    expect(colorAt(composite.canvas, 2, 2)).toEqual([255, 255, 255]);
    // Cursor line at doubled chart coordinates (instance dpr 1, export 2).
    const bbox = uplot.bbox;
    const c1Light = hexToBytes("#6A1B9A");
    const xDev =
      bbox.left * 2 +
      uplot.valToPos(capture.timestamps[Math.floor(total / 4)]!, "x") * 2;
    const midYDev = bbox.top + bbox.height / 2;
    expect(
      [xDev - 4, xDev - 2, xDev, xDev + 2, xDev + 4].some((x) => {
        const [r, g, b] = colorAt(composite.canvas, x, midYDev);
        return (
          Math.abs(r - c1Light[0]) <= 8 &&
          Math.abs(g - c1Light[1]) <= 8 &&
          Math.abs(b - c1Light[2]) <= 8
        );
      }),
    ).toBe(true);
  });

  it("the theme setting drives the print/screen paths end-to-end (F1/F2 regression, issue #252)", async () => {
    const capturedBlobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      (blob: Blob | MediaSource) => {
        capturedBlobs.push(blob as Blob);
        return `blob:test-${capturedBlobs.length}`;
      },
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const secondHost = document.createElement("div");
    document.body.appendChild(secondHost);
    const secondRoot = createRoot(secondHost);
    await act(async () => {
      secondRoot.render(<PngSnapshotButton />);
    });
    const button = secondHost.querySelector(
      "[data-testid='png-export-button']",
    ) as HTMLButtonElement;

    // Light (print) theme export under the dark live theme: the white
    // corner proves the print path ran.
    await act(async () => {
      usePngExportStore.getState().setTheme("light");
    });
    await act(async () => {
      button.click();
      // Poll: the offscreen print render + toBlob resolve asynchronously.
      for (let i = 0; i < 40 && capturedBlobs.length < 1; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    });

    expect(capturedBlobs.length).toBe(1);
    const invertedBitmap = await createImageBitmap(capturedBlobs[0]!);
    const probe = document.createElement("canvas");
    probe.width = invertedBitmap.width;
    probe.height = invertedBitmap.height;
    const probeCtx = probe.getContext("2d")!;
    probeCtx.drawImage(invertedBitmap, 0, 0);
    expect(colorAt(probe, 2, 2)).toEqual([255, 255, 255]);

    // Default export: dark corner (live theme path).
    await act(async () => {
      usePngExportStore.getState().setTheme("dark");
    });
    await act(async () => {
      button.click();
      for (let i = 0; i < 40 && capturedBlobs.length < 2; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    });
    expect(capturedBlobs.length).toBe(2);
    const defaultBitmap = await createImageBitmap(capturedBlobs[1]!);
    const probe2 = document.createElement("canvas");
    probe2.width = defaultBitmap.width;
    probe2.height = defaultBitmap.height;
    probe2.getContext("2d")!.drawImage(defaultBitmap, 0, 0);
    expect(colorAt(probe2, 2, 2)).toEqual([0, 0, 0]);

    act(() => {
      secondRoot.unmount();
    });
    secondHost.remove();
  });

  it("exports dashed/dotted cursor lines with dash patterns (issue #226)", async () => {
    expect(useSnapshotStore.getState().exporter).not.toBeNull();

    useCursorDisplayStore.getState().reset();
    const total = useCaptureStore.getState().capture!.timestamps.length;
    act(() => {
      useCursorStore.getState().setCursorActive("C1", true, total);
      useCursorStore.getState().setCursorActive("C2", true, total);
      useCursorDisplayStore.getState().setLineStyle("C1", "dotted");
    });

    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click");
    const setLineDash = vi.spyOn(
      CanvasRenderingContext2D.prototype,
      "setLineDash",
    );
    const createdUrls: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const url = `blob:dash-${createdUrls.length}`;
      createdUrls.push(url);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const exportHost = document.createElement("div");
    document.body.appendChild(exportHost);
    const exportRoot = createRoot(exportHost);
    await act(async () => {
      exportRoot.render(<PngSnapshotButton />);
    });
    const button = exportHost.querySelector(
      "[data-testid='png-export-button']",
    ) as HTMLButtonElement;

    await act(async () => {
      button.click();
      for (let i = 0; i < 40 && anchorClick.mock.calls.length < 1; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    });
    expect(anchorClick).toHaveBeenCalledTimes(1);
    // The dotted C1 line stroked with its dash pattern (solid C2 kept
    // plain fills; nothing else uses the [1, 3] dotted pattern).
    expect(setLineDash).toHaveBeenCalledWith([1, 3]);

    act(() => {
      exportRoot.unmount();
    });
    exportHost.remove();
    vi.restoreAllMocks();
    useCursorDisplayStore.getState().reset();
  });

  it("registers the live exporter with the Oscilloscope and downloads via the toolbar button", async () => {
    // Before any Oscilloscope mount in this test: the store is clean.
    expect(useSnapshotStore.getState().exporter).not.toBeNull(); // registered by beforeEach mount

    const createdUrls: string[] = [];
    const revokedUrls = new Set<string>();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click");
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const url = `blob:test-${createdUrls.length}`;
      createdUrls.push(url);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
      revokedUrls.add(url);
    });

    const secondHost = document.createElement("div");
    document.body.appendChild(secondHost);
    const secondRoot = createRoot(secondHost);
    await act(async () => {
      secondRoot.render(<PngSnapshotButton />);
    });
    const button = secondHost.querySelector(
      "[data-testid='png-export-button']",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    await act(async () => {
      button.click();
      // toBlob resolves asynchronously — poll until the download anchor
      // fires. A fixed 60ms sleep flakes under CI load (issue #221): the
      // offscreen compositing + toBlob chain regularly outlives it there,
      // so the anchor-click spy is still at zero when the assertion runs.
      for (let i = 0; i < 40 && anchorClick.mock.calls.length < 1; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    });
    expect(anchorClick).toHaveBeenCalledTimes(1);
    const anchor = anchorClick.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toMatch(/^four-snapshot-\d{8}-\d{6}\.png$/);
    expect(revokedUrls.size).toBe(1);

    act(() => {
      secondRoot.unmount();
    });
    secondHost.remove();

    const fixedDate = new Date(2026, 8, 14, 10, 35, 22);
    expect(snapshotFileName(null, fixedDate)).toBe(
      "snapshot-20260914-103522.png",
    );
    expect(snapshotFileName("CAPTURE.FVF", fixedDate)).toBe(
      "CAPTURE-snapshot-20260914-103522.png",
    );
  });

  describe("canvas fingerprinting protection (LibreWolf / RFP) - Issue #84", () => {
    it("detects poisoned canvas, aborts export, and displays guidance modal with address bar instructions", async () => {
      canvasPermission.setCanvasReadbackOverride(() => false);

      const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click");
      anchorClick.mockClear();
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);

      await act(async () => {
        root.render(<PngSnapshotButton />);
      });

      const button = host.querySelector(
        "[data-testid='png-export-button']",
      ) as HTMLButtonElement;
      expect(button).not.toBeNull();

      // Click Export PNG while canvas is poisoned
      await act(async () => {
        button.click();
        await Promise.resolve();
      });

      // Export must be aborted: no download anchor clicked
      expect(anchorClick).not.toHaveBeenCalled();

      // Guidance modal must be visible
      const modal = document.body.querySelector(
        "[data-testid='canvas-blocked-modal']",
      );
      expect(modal).not.toBeNull();

      const title = document.body.querySelector(
        "[data-testid='canvas-blocked-modal-title']",
      );
      expect(title?.textContent).toContain(
        "Canvas Export Blocked by Browser Privacy Settings",
      );

      const steps = document.body.querySelector(".canvas-blocked-steps");
      expect(steps?.textContent).toContain("address bar");
      expect(steps?.textContent).toContain("canvas data extraction");

      // Dismiss modal via Got it button
      const dismissBtn = document.body.querySelector(
        "[data-testid='canvas-blocked-dismiss']",
      ) as HTMLButtonElement;
      await act(async () => {
        dismissBtn.click();
      });

      expect(
        document.body.querySelector("[data-testid='canvas-blocked-modal']"),
      ).toBeNull();

      // Unblock canvas (simulating user allowing permission in address bar)
      canvasPermission.setCanvasReadbackOverride(() => true);

      // Clicking Export PNG again now exports real snapshot
      await act(async () => {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 60));
      });

      expect(anchorClick).toHaveBeenCalledTimes(1);

      act(() => {
        root.unmount();
      });
      host.remove();
      anchorClick.mockRestore();
      canvasPermission.setCanvasReadbackOverride(null);
    });

    it("dismisses modal via Escape key and backdrop click", async () => {
      canvasPermission.setCanvasReadbackOverride(() => false);

      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);

      await act(async () => {
        root.render(<PngSnapshotButton />);
      });

      const button = host.querySelector(
        "[data-testid='png-export-button']",
      ) as HTMLButtonElement;

      // 1. Dismiss via Escape key
      await act(async () => {
        button.click();
      });
      expect(
        document.body.querySelector("[data-testid='canvas-blocked-modal']"),
      ).not.toBeNull();

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(
        document.body.querySelector("[data-testid='canvas-blocked-modal']"),
      ).toBeNull();

      // 2. Dismiss via backdrop click
      await act(async () => {
        button.click();
      });
      const backdrop = document.body.querySelector(
        "[data-testid='canvas-blocked-modal-backdrop']",
      ) as HTMLDivElement;
      expect(backdrop).not.toBeNull();

      await act(async () => {
        backdrop.click();
      });
      expect(
        document.body.querySelector("[data-testid='canvas-blocked-modal']"),
      ).toBeNull();

      act(() => {
        root.unmount();
      });
      host.remove();
      canvasPermission.setCanvasReadbackOverride(null);
    });
  });

  describe("comparison mode PNG export & clipboard copy (issue #333)", () => {
    async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
      return canvas;
    }

    async function loadReference(): Promise<void> {
      const refBuf = await fixture(twoChMinUrl);
      await act(async () => {
        await useReferenceStore
          .getState()
          .parseReferenceBuffer(refBuf, "file2.fvf");
        for (
          let i = 0;
          i < 80 && useReferenceStore.getState().parseState !== "success";
          i += 1
        ) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      expect(useReferenceStore.getState().parseState).toBe("success");
    }

    it("AC1+AC2+AC3+AC4+AC5: exports and copies both primary and comparison waveforms and legends in Overlay & Stack, light & dark modes", async () => {
      await loadReference();

      // Custom name on primary A and reference Ref-A to verify legend labels/swatches
      act(() => {
        useChannelNamesStore.getState().setName("A", "V_main");
        useChannelNamesStore.getState().setName("Ref-A", "V_ref");
        useViewportStore.getState().setActiveChannels(["A"]);
        useReferenceStore.getState().setRefActiveChannels(["Ref-A"]);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });

      const exportedBlobs: Blob[] = [];
      vi.spyOn(URL, "createObjectURL").mockImplementation(
        (blob: Blob | MediaSource) => {
          exportedBlobs.push(blob as Blob);
          return `blob:compare-${exportedBlobs.length}`;
        },
      );
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      const clipboardItems: ClipboardItem[] = [];
      vi.spyOn(navigator.clipboard, "write").mockImplementation(
        async (items: ClipboardItems) => {
          clipboardItems.push(...items);
        },
      );

      const btnHost = document.createElement("div");
      document.body.appendChild(btnHost);
      const btnRoot = createRoot(btnHost);
      await act(async () => {
        btnRoot.render(<PngSnapshotButton />);
      });
      const exportBtn = btnHost.querySelector(
        "[data-testid='png-export-button']",
      ) as HTMLButtonElement;
      const copyBtn = btnHost.querySelector(
        "[data-testid='png-copy-button']",
      ) as HTMLButtonElement;

      const triggerExportAndCopy = async (): Promise<{
        exportCanvas: HTMLCanvasElement;
        copyCanvas: HTMLCanvasElement;
        exportBytes: Uint8Array;
        copyBytes: Uint8Array;
      }> => {
        const prevExports = exportedBlobs.length;
        const prevCopies = clipboardItems.length;
        await act(async () => {
          exportBtn.click();
          for (
            let i = 0;
            i < 60 && exportedBlobs.length <= prevExports;
            i += 1
          ) {
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        });
        await act(async () => {
          copyBtn.click();
          for (
            let i = 0;
            i < 60 && clipboardItems.length <= prevCopies;
            i += 1
          ) {
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        });
        // Reset transient copied state so copyBtn is immediately clickable again
        const exportBlob = exportedBlobs[exportedBlobs.length - 1]!;
        const copyBlob =
          await clipboardItems[clipboardItems.length - 1]!.getType("image/png");
        const exportBytes = new Uint8Array(await exportBlob.arrayBuffer());
        const copyBytes = new Uint8Array(await copyBlob.arrayBuffer());
        return {
          exportCanvas: await blobToCanvas(exportBlob),
          copyCanvas: await blobToCanvas(copyBlob),
          exportBytes,
          copyBytes,
        };
      };

      const uplot = mountedUplot!;
      const bbox = uplot.bbox;
      const pxRatio = window.devicePixelRatio || 1;
      const instancePxRatio =
        uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
      const plotLeftDev = (bbox.left / instancePxRatio) * pxRatio;
      const plotTopDev = (bbox.top / instancePxRatio) * pxRatio;
      const plotWidDev = (bbox.width / instancePxRatio) * pxRatio;
      const plotHgtDev = (bbox.height / instancePxRatio) * pxRatio;

      // 1. Overlay + Dark mode (AC2, AC4, AC5)
      act(() => {
        useChannelDisplayStore.getState().setStackMode(false);
        usePngExportStore.getState().setTheme("dark");
      });
      const overlayDark = await triggerExportAndCopy();
      expect(overlayDark.exportBytes).toEqual(overlayDark.copyBytes);
      // Primary A (#FFD700) and Ref-A (#FF6EC7) trace pixels inside plot area
      expect(
        colorPresentInRegion(
          overlayDark.exportCanvas,
          plotLeftDev,
          plotTopDev + 36 * pxRatio,
          plotWidDev,
          plotHgtDev - 36 * pxRatio,
          hexToBytes("#FFD700"),
        ),
      ).toBe(true);
      expect(
        colorPresentInRegion(
          overlayDark.exportCanvas,
          plotLeftDev,
          plotTopDev + 36 * pxRatio,
          plotWidDev,
          plotHgtDev - 36 * pxRatio,
          hexToBytes("#FF6EC7"),
        ),
      ).toBe(true);
      // Legend swatches at top-left of plot area: row 0 = A (#FFD700), row 1 = Ref-A (#FF6EC7)
      expect(
        colorPresentInRegion(
          overlayDark.exportCanvas,
          plotLeftDev + 4 * pxRatio,
          plotTopDev,
          30 * pxRatio,
          16 * pxRatio,
          hexToBytes("#FFD700"),
        ),
      ).toBe(true);
      expect(
        colorPresentInRegion(
          overlayDark.exportCanvas,
          plotLeftDev + 4 * pxRatio,
          plotTopDev + 14 * pxRatio,
          30 * pxRatio,
          20 * pxRatio,
          hexToBytes("#FF6EC7"),
        ),
      ).toBe(true);

      // Re-mount button to clear copied cooldown timer between modes
      const remountButton = async () => {
        await act(async () => {
          btnRoot.render(<div />);
        });
        await act(async () => {
          btnRoot.render(<PngSnapshotButton />);
        });
      };

      // 2. Overlay + Light mode (AC1, AC4, AC5)
      await remountButton();
      const exportBtn2 = btnHost.querySelector(
        "[data-testid='png-export-button']",
      ) as HTMLButtonElement;
      const copyBtn2 = btnHost.querySelector(
        "[data-testid='png-copy-button']",
      ) as HTMLButtonElement;
      act(() => {
        usePngExportStore.getState().setTheme("light");
      });
      await act(async () => {
        exportBtn2.click();
        for (let i = 0; i < 60 && exportedBlobs.length < 2; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      });
      await act(async () => {
        copyBtn2.click();
        for (let i = 0; i < 60 && clipboardItems.length < 2; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      });
      const lightOverlayExportBlob = exportedBlobs[1]!;
      const lightOverlayCopyBlob =
        await clipboardItems[1]!.getType("image/png");
      expect(
        new Uint8Array(await lightOverlayExportBlob.arrayBuffer()),
      ).toEqual(new Uint8Array(await lightOverlayCopyBlob.arrayBuffer()));
      const overlayLightCanvas = await blobToCanvas(lightOverlayExportBlob);
      // White background
      expect(colorAt(overlayLightCanvas, 2, 2)).toEqual([255, 255, 255]);
      // Light theme Primary A (#B8860B) and Ref-A (#C2185B) traces in plot area
      expect(
        colorPresentInRegion(
          overlayLightCanvas,
          plotLeftDev,
          plotTopDev + 36 * pxRatio,
          plotWidDev,
          plotHgtDev - 36 * pxRatio,
          hexToBytes("#B8860B"),
        ),
      ).toBe(true);
      expect(
        colorPresentInRegion(
          overlayLightCanvas,
          plotLeftDev,
          plotTopDev + 36 * pxRatio,
          plotWidDev,
          plotHgtDev - 36 * pxRatio,
          hexToBytes("#C2185B"),
        ),
      ).toBe(true);
      // Light theme legend swatches for both A (#B8860B) and Ref-A (#C2185B)
      expect(
        colorPresentInRegion(
          overlayLightCanvas,
          0,
          plotTopDev,
          overlayLightCanvas.width,
          16 * pxRatio,
          hexToBytes("#B8860B"),
        ),
      ).toBe(true);
      expect(
        colorPresentInRegion(
          overlayLightCanvas,
          0,
          plotTopDev + 14 * pxRatio,
          overlayLightCanvas.width,
          20 * pxRatio,
          hexToBytes("#C2185B"),
        ),
      ).toBe(true);

      // 3. Stack + Dark mode (AC3, AC4, AC5)
      await remountButton();
      const exportBtn3 = btnHost.querySelector(
        "[data-testid='png-export-button']",
      ) as HTMLButtonElement;
      const copyBtn3 = btnHost.querySelector(
        "[data-testid='png-copy-button']",
      ) as HTMLButtonElement;
      act(() => {
        useChannelDisplayStore.getState().setStackMode(true);
        usePngExportStore.getState().setTheme("dark");
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      await act(async () => {
        exportBtn3.click();
        for (let i = 0; i < 60 && exportedBlobs.length < 3; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      });
      await act(async () => {
        copyBtn3.click();
        for (let i = 0; i < 60 && clipboardItems.length < 3; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      });
      const stackDarkExportBlob = exportedBlobs[2]!;
      const stackDarkCopyBlob = await clipboardItems[2]!.getType("image/png");
      expect(new Uint8Array(await stackDarkExportBlob.arrayBuffer())).toEqual(
        new Uint8Array(await stackDarkCopyBlob.arrayBuffer()),
      );
      const stackDarkCanvas = await blobToCanvas(stackDarkExportBlob);
      const stackBbox = mountedUplot!.bbox;
      const stackInstanceRatio =
        mountedUplot!.width > 0
          ? mountedUplot!.ctx.canvas.width / mountedUplot!.width
          : 1;
      const sLeft = (stackBbox.left / stackInstanceRatio) * pxRatio;
      const sTop = (stackBbox.top / stackInstanceRatio) * pxRatio;
      const sWid = (stackBbox.width / stackInstanceRatio) * pxRatio;
      const sHgt = (stackBbox.height / stackInstanceRatio) * pxRatio;
      // Top lane (0..sHgt/2) has Primary A (#FFD700); bottom lane (sHgt/2..sHgt) has Ref-A (#FF6EC7)
      expect(
        colorPresentInRegion(
          stackDarkCanvas,
          sLeft,
          sTop + 36 * pxRatio,
          sWid,
          sHgt / 2 - 36 * pxRatio,
          hexToBytes("#FFD700"),
        ),
      ).toBe(true);
      expect(
        colorPresentInRegion(
          stackDarkCanvas,
          sLeft,
          sTop + sHgt / 2,
          sWid,
          sHgt / 2,
          hexToBytes("#FF6EC7"),
        ),
      ).toBe(true);

      // 4. Stack + Light mode (AC3, AC4, AC5)
      await remountButton();
      const exportBtn4 = btnHost.querySelector(
        "[data-testid='png-export-button']",
      ) as HTMLButtonElement;
      const copyBtn4 = btnHost.querySelector(
        "[data-testid='png-copy-button']",
      ) as HTMLButtonElement;
      act(() => {
        usePngExportStore.getState().setTheme("light");
      });
      await act(async () => {
        exportBtn4.click();
        for (let i = 0; i < 60 && exportedBlobs.length < 4; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      });
      await act(async () => {
        copyBtn4.click();
        for (let i = 0; i < 60 && clipboardItems.length < 4; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      });
      const stackLightExportBlob = exportedBlobs[3]!;
      const stackLightCopyBlob = await clipboardItems[3]!.getType("image/png");
      expect(new Uint8Array(await stackLightExportBlob.arrayBuffer())).toEqual(
        new Uint8Array(await stackLightCopyBlob.arrayBuffer()),
      );
      const stackLightCanvas = await blobToCanvas(stackLightExportBlob);
      // Top lane has Primary A (#B8860B); bottom lane has Ref-A (#C2185B)
      expect(
        colorPresentInRegion(
          stackLightCanvas,
          sLeft,
          sTop + 36 * pxRatio,
          sWid,
          sHgt / 2 - 36 * pxRatio,
          hexToBytes("#B8860B"),
        ),
      ).toBe(true);
      expect(
        colorPresentInRegion(
          stackLightCanvas,
          sLeft,
          sTop + sHgt / 2,
          sWid,
          sHgt / 2,
          hexToBytes("#C2185B"),
        ),
      ).toBe(true);
      // Legend swatches for both channels in Stack + Light mode
      expect(
        colorPresentInRegion(
          stackLightCanvas,
          0,
          sTop,
          stackLightCanvas.width,
          16 * pxRatio,
          hexToBytes("#B8860B"),
        ),
      ).toBe(true);
      expect(
        colorPresentInRegion(
          stackLightCanvas,
          0,
          sTop + 14 * pxRatio,
          stackLightCanvas.width,
          20 * pxRatio,
          hexToBytes("#C2185B"),
        ),
      ).toBe(true);

      act(() => {
        btnRoot.unmount();
      });
      btnHost.remove();
      vi.restoreAllMocks();
    });

    it("issue #349: Stack mode PNG export with comparison waveforms renders correct Y-axis values and colors for all channels", async () => {
      // Load 2-channel capture as primary
      const primaryBuf = await fixture(twoChMinUrl);
      await useCaptureStore
        .getState()
        .parseBuffer(primaryBuf, "primary2ch.fvf");
      const primaryCapture = useCaptureStore.getState().capture!;

      await act(async () => {
        root.render(
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              height: "600px",
            }}
          >
            <Oscilloscope
              capture={primaryCapture}
              onUPlotInit={(u) => {
                mountedUplot = u;
              }}
            />
          </div>,
        );
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });

      // Load 2-channel capture as reference
      await loadReference();

      act(() => {
        useViewportStore.getState().setActiveChannels(["A", "B"]);
        useReferenceStore.getState().setRefActiveChannels(["Ref-A", "Ref-B"]);
        useChannelDisplayStore.getState().setStackMode(true);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });

      const uplot = mountedUplot!;
      const series = [
        { label: "A", color: "#B8860B", show: true },
        { label: "B", color: "#00838F", show: true },
        { label: "Ref-A", color: "#C2185B", show: true },
        { label: "Ref-B", color: "#2E7D32", show: true },
      ];
      const composite = await composePrintSnapshot(
        uplot,
        primaryCapture,
        {
          cursor1: "#6A1B9A",
          cursor2: "#4B5563",
          background: "#FFFFFF",
          legend: [],
          selected: null,
        },
        {
          pixelRatio: 1,
          series,
          palette: "light",
        },
      );

      const bbox = uplot.bbox;
      const sLeft = bbox.left;
      const sTop = bbox.top;
      const sHgt = bbox.height;
      const laneH = sHgt / 4;

      const gold = hexToBytes("#B8860B");
      const cyan = hexToBytes("#00838F");
      const magenta = hexToBytes("#C2185B");
      const green = hexToBytes("#2E7D32");

      // Verify each channel's axis tick filter and formatted tick values (AC1, AC4)
      const expectedLanes = [
        { key: "y0", name: "A", idx: 0 },
        { key: "y1", name: "B", idx: 1 },
        { key: "y2", name: "Ref-A", idx: 2 },
        { key: "y3", name: "Ref-B", idx: 3 },
      ];

      for (const lane of expectedLanes) {
        const axis = uplot.axes.find((a) => a.scale === lane.key);
        expect(axis, `axis for ${lane.key}`).toBeDefined();

        const band = laneBandCss(uplot, primaryCapture, lane.key);
        expect(band, `laneBandCss for ${lane.key}`).not.toBeNull();
        expect(band!.top).toBeCloseTo(lane.idx * laneH, 1);
        expect(band!.bottom).toBeCloseTo((lane.idx + 1) * laneH, 1);

        // Sample splits spanning the full scale bounds
        const scale = uplot.scales[lane.key]!;
        expect(scale.min).toBeLessThan(scale.max!);
        const step = (scale.max! - scale.min!) / 6;
        const testSplits = Array.from(
          { length: 7 },
          (_, i) => scale.min! + i * step,
        );

        if (typeof axis!.filter === "function") {
          const filtered = (
            axis!.filter as (u: uPlot, splits: number[]) => Array<number | null>
          )(uplot, testSplits);
          // In Stack mode, splits whose Y position falls within this lane's band must be preserved
          const kept = filtered.filter((v): v is number => v !== null);
          expect(kept.length, `kept splits for ${lane.key}`).toBeGreaterThan(0);

          for (const val of kept) {
            const pos = uplot.valToPos(val, lane.key);
            expect(pos).toBeGreaterThanOrEqual(band!.top - 1);
            expect(pos).toBeLessThanOrEqual(band!.bottom + 1);
          }

          if (typeof axis!.values === "function") {
            const formatted = (
              axis!.values as (
                u: uPlot,
                splits: number[],
              ) => Array<string | null>
            )(uplot, kept);
            expect(formatted.length).toBe(kept.length);
            for (const str of formatted) {
              expect(typeof str).toBe("string");
              expect(str!.trim().length).toBeGreaterThan(0);
              // Numeric tick value must parse as a valid number
              expect(Number.isNaN(parseFloat(str!))).toBe(false);
            }
          }
        }
      }

      // Check pixel presence in the tick number / mark strip (x between 25 and sLeft, excluding rotated title strip at x < 25)
      function getTickStripYRange(
        color: [number, number, number],
        minX = 25,
        maxX = sLeft,
      ) {
        const coords: number[] = [];
        const ctx = composite.canvas.getContext("2d")!;
        const imgData = ctx.getImageData(
          0,
          0,
          composite.canvas.width,
          composite.canvas.height,
        ).data;
        for (let y = 0; y < composite.canvas.height; y++) {
          for (let x = minX; x < maxX; x++) {
            const idx = (y * composite.canvas.width + x) * 4;
            if (
              Math.abs(imgData[idx]! - color[0]) <= 8 &&
              Math.abs(imgData[idx + 1]! - color[1]) <= 8 &&
              Math.abs(imgData[idx + 2]! - color[2]) <= 8
            ) {
              coords.push(y);
            }
          }
        }
        return {
          minY: Math.min(...coords),
          maxY: Math.max(...coords),
          count: coords.length,
        };
      }

      // 1. Ticks and tick numbers in the tick strip specifically (x in [25, sLeft])
      const goldTickRange = getTickStripYRange(gold, 25, sLeft);
      const cyanTickRange = getTickStripYRange(cyan, 25, sLeft);
      const magentaTickRange = getTickStripYRange(magenta, 25, sLeft);
      const greenTickRange = getTickStripYRange(green, 25, sLeft);

      // Gold (Channel A) tick labels strictly in Lane 0
      expect(goldTickRange.count).toBeGreaterThan(0);
      expect(goldTickRange.minY).toBeGreaterThanOrEqual(sTop - 2);
      expect(goldTickRange.maxY).toBeLessThanOrEqual(sTop + laneH + 2);

      // Cyan (Channel B) tick labels strictly in Lane 1
      expect(cyanTickRange.count).toBeGreaterThan(0);
      expect(cyanTickRange.minY).toBeGreaterThanOrEqual(sTop + laneH - 2);
      expect(cyanTickRange.maxY).toBeLessThanOrEqual(sTop + 2 * laneH + 2);

      // Magenta (Ref-A) tick labels strictly in Lane 2
      expect(magentaTickRange.count).toBeGreaterThan(0);
      expect(magentaTickRange.minY).toBeGreaterThanOrEqual(
        sTop + 2 * laneH - 2,
      );
      expect(magentaTickRange.maxY).toBeLessThanOrEqual(sTop + 3 * laneH + 2);

      // Green (Ref-B) tick labels strictly in Lane 3
      expect(greenTickRange.count).toBeGreaterThan(0);
      expect(greenTickRange.minY).toBeGreaterThanOrEqual(sTop + 3 * laneH - 2);
      expect(greenTickRange.maxY).toBeLessThanOrEqual(sTop + 4 * laneH + 2);

      // 2. Full Y-axis strip (x in [0, sLeft]) including channel titles
      const goldFullRange = getTickStripYRange(gold, 0, sLeft);
      const cyanFullRange = getTickStripYRange(cyan, 0, sLeft);
      const magentaFullRange = getTickStripYRange(magenta, 0, sLeft);
      const greenFullRange = getTickStripYRange(green, 0, sLeft);

      expect(goldFullRange.minY).toBeGreaterThanOrEqual(sTop - 2);
      expect(goldFullRange.maxY).toBeLessThanOrEqual(sTop + laneH + 2);
      expect(cyanFullRange.minY).toBeGreaterThanOrEqual(sTop + laneH - 2);
      expect(cyanFullRange.maxY).toBeLessThanOrEqual(sTop + 2 * laneH + 2);
      expect(magentaFullRange.minY).toBeGreaterThanOrEqual(
        sTop + 2 * laneH - 2,
      );
      expect(magentaFullRange.maxY).toBeLessThanOrEqual(sTop + 3 * laneH + 2);
      expect(greenFullRange.minY).toBeGreaterThanOrEqual(sTop + 3 * laneH - 2);
      expect(greenFullRange.maxY).toBeLessThanOrEqual(sTop + 4 * laneH + 2);
    });
  });
});
