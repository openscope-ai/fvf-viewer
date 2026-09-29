import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import "../../index.css";
import Oscilloscope from "./Oscilloscope";
import MetadataBanner from "../banner/MetadataBanner";
import WaveformToolbar from "../toolbar/WaveformToolbar";
import SiteFooter from "../footer/SiteFooter";
import { useCaptureStore } from "../../state/captureStore";
import { useViewportStore } from "../../state/viewportStore";
import { useCursorStore } from "../../state/cursorStore";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import type { ParsedCapture } from "../../types/capture";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createTestCapture(sampleCount = 1000): ParsedCapture {
  const timestamps = new Float32Array(sampleCount);
  const ch1Data = new Float32Array(sampleCount);
  const center = sampleCount / 2;
  for (let i = 0; i < sampleCount; i += 1) {
    timestamps[i] = (i - center) * 1e-5;
    ch1Data[i] = Math.sin(i * 0.05) * 3;
  }
  return {
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "10 us/Div",
      secondsPerDiv: 1e-5,
      timestamp14: "12300020260912",
      samples: sampleCount,
      deltaT: 1e-5,
      channels: [
        {
          name: "A",
          label: "Input A",
          derived: false,
          samples: sampleCount,
          deltaT: 1e-5,
        },
      ],
    },
    channels: [{ name: "A", label: "Input A", derived: false, data: ch1Data }],
    derivedChannels: [],
    timestamps,
    warnings: [],
  };
}

/**
 * Issue #62: zero-scroll workspace layout test. The real component chain
 * (app-frame > shell > ingestion-container > banner + toolbar + plot, then
 * footer) mounts inside a host of a fixed simulated viewport size; the
 * frame's viewport-bound 100vh height is applied inline so the CSS floor
 * and flex rules are exercised against known geometry.
 */
describe("Zero-scroll viewport layout (Issue #62)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
    hostElement = document.createElement("div");
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
    useCursorStore.getState().reset();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
  });

  interface Geometry {
    scrollOverflow: number;
    canvasRect: DOMRect;
    footerTop: number;
    canvasTop: number;
  }

  function mountWorkspace(viewportWidth: number, viewportHeight: number) {
    hostElement.style.width = `${viewportWidth}px`;
    hostElement.style.height = `${viewportHeight}px`;
    hostElement.style.overflow = "auto";
    const capture = createTestCapture();
    act(() => {
      root.render(
        <div className="app-frame" style={{ height: viewportHeight }}>
          <main className="shell">
            <div className="ingestion-container">
              <MetadataBanner capture={capture} fileName="layout.fvf" />
              <WaveformToolbar />
              <Oscilloscope capture={capture} />
            </div>
          </main>
          <SiteFooter />
        </div>,
      );
    });
  }

  function measure(): Geometry {
    const canvas = hostElement.querySelector(
      "[data-testid='oscilloscope-container'] canvas",
    ) as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    const footer = hostElement.querySelector(
      "[data-testid='site-footer']",
    ) as HTMLElement;
    return {
      scrollOverflow: hostElement.scrollHeight - hostElement.clientHeight,
      canvasRect: canvas.getBoundingClientRect(),
      footerTop: footer.getBoundingClientRect().top,
      canvasTop: canvas.getBoundingClientRect().top,
    };
  }

  it("AC1/AC2: 1080p workspace fits with zero vertical scroll, X-axis above the footer", async () => {
    mountWorkspace(1920, 1080);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const geo = measure();
    // Zero vertical overflow: no scrollbar anywhere in the simulated frame.
    expect(geo.scrollOverflow).toBeLessThanOrEqual(0);
    // The plot (with its X-axis labels) ends above the pinned footer.
    expect(geo.canvasRect.bottom).toBeLessThanOrEqual(geo.footerTop + 0.5);
  });

  it("AC3: the canvas flexes to fill the space between toolbar and footer", async () => {
    mountWorkspace(1920, 1080);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const geo = measure();
    const banner = hostElement.querySelector(".metadata-banner")!;
    const toolbar = hostElement.querySelector(
      "[data-testid='waveform-toolbar']",
    )!;
    const footer = hostElement.querySelector("[data-testid='site-footer']")!;
    const occupied =
      banner.getBoundingClientRect().height +
      toolbar.getBoundingClientRect().height +
      footer.getBoundingClientRect().height;
    const expectedCanvas = 1080 - occupied;
    // The canvas absorbs the entire remaining vertical space (within
    // layout rounding).
    expect(geo.canvasRect.height).toBeGreaterThanOrEqual(expectedCanvas - 2);
    expect(geo.canvasRect.top).toBeGreaterThanOrEqual(
      banner.getBoundingClientRect().top,
    );
  });

  it("AC4: window resizes resync the canvas without scrollbars", async () => {
    mountWorkspace(1920, 1080);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const before = measure();
    expect(before.scrollOverflow).toBeLessThanOrEqual(0);

    // Shrink the simulated viewport; the ResizeObserver-driven setSize
    // must track it without inducing overflow (feedback loops would show
    // as a growing canvas height across frames).
    hostElement.style.height = "800px";
    const frame = hostElement.querySelector(".app-frame") as HTMLElement;
    frame.style.height = "800px";
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    const after = measure();
    expect(after.canvasRect.height).toBeLessThan(before.canvasRect.height);
    expect(after.scrollOverflow).toBeLessThanOrEqual(0);
    expect(after.canvasRect.bottom).toBeLessThanOrEqual(after.footerTop + 0.5);
  });

  it("AC5: extremely short viewports floor the canvas at 400px and permit scrolling", async () => {
    mountWorkspace(1920, 500);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const geo = measure();
    // Canvas keeps its usability floor...
    expect(geo.canvasRect.height).toBeGreaterThanOrEqual(399);
    // ...and the frame overflows the simulated viewport: the page scrolls
    // gracefully instead of crushing the plot.
    expect(geo.scrollOverflow).toBeGreaterThan(0);
  });

  it("AC6: the footer keeps a compact 6px vertical footprint", () => {
    mountWorkspace(1920, 1080);
    const footer = hostElement.querySelector(
      "[data-testid='site-footer']",
    ) as HTMLElement;
    const style = getComputedStyle(footer);
    expect(style.paddingTop).toBe("6px");
    expect(style.paddingBottom).toBe("6px");
  });
});
