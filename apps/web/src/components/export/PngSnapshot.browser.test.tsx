import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import uPlot from "uplot";
import fourChUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import Oscilloscope from "../canvas/Oscilloscope";
import { useCaptureStore } from "../../state/captureStore";
import { useViewportStore } from "../../state/viewportStore";
import { useCursorStore } from "../../state/cursorStore";
import {
  composePrintSnapshot,
  composeSnapshotCanvas,
  snapshotToBlob,
  type SnapshotOverlayState,
} from "./pngSnapshot";
import { useSnapshotStore } from "./snapshotStore";
import PngSnapshotButton, { snapshotFileName } from "./PngSnapshotButton";
import * as canvasPermission from "./canvasPermission";
import type { ParsedCapture } from "../../types/capture";

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
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
    useSnapshotStore.getState().registerExporter(null);

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

  it("toggle drives the exporter's inverted flag end-to-end (F1/F2 regression)", async () => {
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
    const toggle = secondHost.querySelector(
      "[data-testid='png-invert-toggle']",
    ) as HTMLInputElement;
    const button = secondHost.querySelector(
      "[data-testid='png-export-button']",
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();

    // Inverted export under the dark live theme: white corner proves the
    // print path ran.
    await act(async () => {
      toggle.click();
    });
    expect(toggle.checked).toBe(true);
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
      toggle.click();
    });
    expect(toggle.checked).toBe(false);
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
      // toBlob resolves asynchronously — let the export chain finish.
      await new Promise((resolve) => setTimeout(resolve, 60));
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
});
