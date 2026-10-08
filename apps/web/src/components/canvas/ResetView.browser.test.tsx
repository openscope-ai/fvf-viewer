import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type uPlot from "uplot";
import fourChUrlQ from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import twoChMinUrlQ from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-2ch-10000-1min-div.fvf.bin?url";
import Oscilloscope from "./Oscilloscope";
import WaveformToolbar from "../toolbar/WaveformToolbar";
import { computeCaptureFit } from "./Oscilloscope";
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

/**
 * Issue #248 acceptance: the toolbar action (previously "Fit Waveform
 * (100%)") is a one-click **Reset View** — every channel's display
 * transforms (Y-scale %, vertical offset, invert) snap to defaults for
 * visible *and* hidden channels, primary *and* reference; the channel
 * popovers reflect the defaults immediately; the File 2 time slip is
 * zeroed while a comparison is active; and the viewport re-frames to
 * the physical capture fit. Solo, Stack/Overlay mode, measurement
 * cursors, channel visibility, theme, and custom channel names are
 * untouched. The reset follows the #245 paint discipline: the mutated
 * series' path cache is invalidated and the repaint is immediate.
 */

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching ${url}`).toBeTruthy();
  return response.arrayBuffer();
}

interface PathCachedSeries {
  _paths: unknown | null;
}

function pathCache(u: uPlot, seriesIndex: number): unknown | null {
  return (u.series[seriesIndex] as unknown as PathCachedSeries)._paths;
}

/** Freeze uPlot's setSize for the (synchronous) callback window. */
async function withFrozenSetSize(
  u: uPlot,
  run: () => Promise<void>,
): Promise<void> {
  const instance = u as unknown as { setSize: (size: unknown) => void };
  const original = instance.setSize;
  instance.setSize = () => undefined;
  try {
    await run();
  } finally {
    instance.setSize = original;
  }
}

function pixels(u: uPlot): string {
  return u.ctx.canvas.toDataURL();
}

describe("Reset View (issue #248)", () => {
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

  const clickResetView = async (): Promise<void> => {
    await act(async () => {
      (
        document.querySelector(
          "[data-testid='reset-view-button']",
        ) as HTMLButtonElement
      ).click();
    });
  };

  const openPopover = async (gear: string): Promise<HTMLElement> => {
    await act(async () => {
      (
        document.querySelector(`[data-testid='${gear}']`) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    const popover = document.body.querySelector(
      "[data-testid='badge-config-popover']",
    ) as HTMLElement;
    expect(popover).not.toBeNull();
    return popover;
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

  it("AC1: the toolbar action is labeled Reset View (label + tooltip)", async () => {
    await mountFullUi();
    const button = document.querySelector(
      "[data-testid='reset-view-button']",
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.textContent).toContain("Reset View");
    expect(button.getAttribute("aria-label")).toContain("Reset View");
    expect(button.getAttribute("title")).toContain("Reset View");
    expect(
      document.querySelector("[data-testid='fit-waveform-button']"),
    ).toBeNull();
  });

  it("AC2: one click resets transforms for every channel — visible, hidden, and reference — and the popover shows defaults immediately", async () => {
    await useReferenceStore
      .getState()
      .parseReferenceBuffer(await fixture(twoChMinUrlQ), "file2.fvf");
    const uplot = await mountFullUi();

    // Dirty transforms: visible A (scale), hidden B (offset), visible C
    // (invert), and a reference channel (scale).
    useViewportStore.getState().setActiveChannels(["A", "C", "D"]);
    useChannelDisplayStore.getState().setYScale("A", 200);
    useChannelDisplayStore.getState().setOffset("B", 3);
    useChannelDisplayStore.getState().setInverted("C", true);
    useChannelDisplayStore.getState().setYScale("Ref-A", 150);
    await settle();

    const popover = await openPopover("channel-gear-A");
    const scaleInput = popover.querySelector(
      "[data-testid='scale-scrub-input']",
    ) as HTMLInputElement;
    expect(scaleInput.value).toBe("200");

    await clickResetView();

    // Every transform record is gone — visible, hidden, reference.
    expect(useChannelDisplayStore.getState().keyConfigs).toEqual({});

    // The open popover reflects the defaults with no further
    // interaction (live store subscription).
    expect(scaleInput.value).toBe("100");
    const offsetInput = popover.querySelector(
      "[data-testid='offset-scrub-input']",
    ) as HTMLInputElement;
    expect(offsetInput.value).toBe("0");
    const invert = popover.querySelector(
      "[data-testid='invert-toggle']",
    ) as HTMLButtonElement;
    expect(invert.getAttribute("aria-pressed")).toBe("false");
    expect(invert.textContent).toContain("Off");

    // Hidden B's popover also reads defaults after the reset.
    await openPopover("channel-gear-B");
    const offsetB = document.body.querySelector(
      "[data-testid='badge-config-popover'] [data-testid='offset-scrub-input']",
    ) as HTMLInputElement;
    expect(offsetB.value).toBe("0");

    // Defaulted lanes render identity values again (A's first sample
    // equals the physical capture buffer).
    const capture = useCaptureStore.getState().capture!;
    expect(uplot.data[1]![0]).toBe(capture.channels[0]!.data[0]);
  });

  it("AC3: one click zeroes the File 2 time slip while a comparison is active and the T₂ glyph repositions", async () => {
    await useReferenceStore
      .getState()
      .parseReferenceBuffer(await fixture(twoChMinUrlQ), "file2.fvf");
    await mountFullUi();

    act(() => {
      useReferenceStore.getState().setTimeSlip(6.25);
    });
    await settle();
    expect(useReferenceStore.getState().timeSlipSamples).toBe(6.25);
    const strip = document.querySelector(
      "[data-testid='t2-trigger-handle']",
    ) as HTMLElement;
    expect(strip.dataset.slipSamples).toBe("6.25");

    await clickResetView();

    expect(useReferenceStore.getState().timeSlipSamples).toBe(0);
    // The T₂ handle repositioned to the unslipped trigger position.
    expect(strip.dataset.slipSamples).toBe("0");
  });

  it("AC4+AC6: one click re-frames the physical capture fit and repaints immediately through the #245 path-cache discipline", async () => {
    const uplot = await mountFullUi();
    const capture = useCaptureStore.getState().capture!;

    // Dirty: transforms on A + a zoomed viewport.
    act(() => {
      useChannelDisplayStore.getState().setYScale("A", 200);
      useChannelDisplayStore.getState().setOffset("A", 2);
    });
    await act(async () => {
      uplot.batch(() => {
        uplot.setScale("x", { min: -0.01, max: 0.01 });
        uplot.setScale("y0", { min: -0.5, max: 0.5 });
      });
      await new Promise((r) => setTimeout(r, 60));
    });
    await settle();
    const pathsBefore = pathCache(uplot, 1);
    expect(pathsBefore).not.toBeNull();

    await withFrozenSetSize(uplot, async () => {
      await clickResetView();
      // Path object renewed synchronously with the click (#245
      // discipline): the stale pre-transform geometry is dropped.
      expect(pathCache(uplot, 1)).not.toBe(pathsBefore);
    });

    // Transforms at defaults compose to the identity, so the fit
    // bounds equal the physical capture fit exactly.
    const expected = computeCaptureFit(capture);
    expect(uplot.scales.x!.min!).toBe(expected.xMin);
    expect(uplot.scales.x!.max!).toBe(expected.xMax);
    capture.channels.forEach((_channel, index) => {
      const key = yScaleKey(index);
      expect(uplot.scales[key]!.min!).toBe(expected.channels[index]!.min);
      expect(uplot.scales[key]!.max!).toBe(expected.channels[index]!.max);
    });

    // Immediate canvas application: the settled pixels are
    // byte-identical to a forced full redraw's ground truth.
    await settle();
    const committed = pixels(uplot);
    uplot.redraw();
    expect(pixels(uplot)).toBe(committed);
  });

  it("AC5: Solo, Stack/Overlay mode, cursors, visibility, theme, and custom names are untouched", async () => {
    await mountFullUi();

    act(() => {
      useChannelDisplayStore.getState().setStackMode(true);
      useCursorStore.getState().toggleCursor("C1", 1000);
      useThemeStore.getState().setTheme("light");
      useChannelNamesStore.setState({
        names: { A: "Custom A" },
      });
      // Solo A: saves the visibility set and isolates A.
      useChannelDisplayStore.getState().toggleSolo("A");
      useChannelDisplayStore.getState().setYScale("A", 200);
    });
    await settle();

    const cursorBefore = {
      c1Active: useCursorStore.getState().c1Active,
      c1SampleIndex: useCursorStore.getState().c1SampleIndex,
    };
    expect(cursorBefore.c1Active).toBe(true);
    expect(useChannelDisplayStore.getState().solo?.key).toBe("A");
    expect(useViewportStore.getState().activeChannels).toEqual(["A"]);

    await clickResetView();

    // Solo survives (visibility isolation intact)…
    expect(useChannelDisplayStore.getState().solo?.key).toBe("A");
    expect(useViewportStore.getState().activeChannels).toEqual(["A"]);
    // …so does the Stack/Overlay mode…
    expect(useChannelDisplayStore.getState().stackMode).toBe(true);
    // …the measurement cursors (position + active state)…
    expect(useCursorStore.getState().c1Active).toBe(true);
    expect(useCursorStore.getState().c1SampleIndex).toBe(
      cursorBefore.c1SampleIndex,
    );
    // …the theme…
    expect(useThemeStore.getState().theme).toBe("light");
    // …and the custom channel names.
    expect(useChannelNamesStore.getState().names).toEqual({ A: "Custom A" });
  });
});
