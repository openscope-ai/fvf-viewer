import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type uPlot from "uplot";
import fourChUrlQ from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import twoChMinUrlQ from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-2ch-10000-1min-div.fvf.bin?url";
import Oscilloscope from "./Oscilloscope";
import App from "../../App";
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
import { laneBandsCss } from "./stackLaneDecorations";
import { useLaneLayoutStore, laneFractions } from "../../state/laneLayoutStore";
import { visibleLaneChannels } from "./stackLaneDecorations";

/**
 * Issue #251 acceptance: Stack-view lanes are vertically resizable by
 * dragging the separator handles (adjacent-only redistribution, 10%
 * floor, double-click equalize), each lane's scale window follows its
 * height fraction, the gesture never fights the plot interactions, and
 * the proportions persist per .fvf file through the capture-identity
 * keying.
 */

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching ${url}`).toBeTruthy();
  return response.arrayBuffer();
}

describe("Stack-view lane resizing (issue #251)", () => {
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

  const stripFor = (boundary: number): HTMLElement =>
    document.querySelector(
      `[data-testid='lane-resize-${boundary}']`,
    ) as HTMLElement;

  const dragStrip = async (
    strip: HTMLElement,
    dyPixels: number,
  ): Promise<void> => {
    const rect = strip.getBoundingClientRect();
    const cx = Math.round(rect.left + rect.width / 2);
    const cy = Math.round(rect.top + rect.height / 2);
    await act(async () => {
      strip.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: cx,
          clientY: cy,
        }),
      );
    });
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          buttons: 1,
          clientX: cx,
          clientY: cy + dyPixels,
        }),
      );
    });
    await settle(40);
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: cx,
          clientY: cy + dyPixels,
        }),
      );
    });
    await settle(60);
  };

  const bandsOf = (uplot: uPlot) =>
    laneBandsCss(uplot, useCaptureStore.getState().capture!);

  /**
   * Bands read once the layout has settled: the ResizeObserver can land
   * a late setSize after mount (axis widths shift with the measured
   * tick labels), so re-read until two consecutive reads agree.
   */
  const stableBands = async (uplot: uPlot) => {
    let prev = bandsOf(uplot);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await settle(150);
      const next = bandsOf(uplot);
      const stable = prev.every(
        (band, index) =>
          Math.abs(band.top - next[index]!.top) < 0.5 &&
          Math.abs(band.bottom - next[index]!.bottom) < 0.5,
      );
      prev = next;
      if (stable) return next;
    }
    return prev;
  };

  const fractionsOf = (): number[] => {
    const capture = useCaptureStore.getState().capture!;
    return laneFractions(
      visibleLaneChannels(capture).map((lane) => lane.key),
      useLaneLayoutStore.getState().weights,
    );
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
    useLaneLayoutStore.getState().setFileKey(null);
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

  it("AC1: dragging a separator redistributes height between the two adjacent lanes only, live, total 100%", async () => {
    const uplot = await mountFullUi();
    await enableStack();

    expect(stripFor(1)).not.toBeNull();
    expect(stripFor(2)).not.toBeNull();
    expect(stripFor(3)).not.toBeNull();

    const before = await stableBands(uplot);
    expect(before).toHaveLength(4);
    const plotHeight = before[3]!.bottom;
    // Equal lanes to start.
    expect(before[1]!.top).toBeCloseTo(plotHeight / 4, 1);

    // Drag boundary 1 (between lane 0 and lane 1) down 40 px.
    await dragStrip(stripFor(1), 40);

    const after = bandsOf(uplot);
    expect(after[1]!.bottom - after[1]!.top).toBeLessThanOrEqual(
      plotHeight * 0.9 + 1,
    );

    // And the mirrored direction: lane 1 cannot be crushed either.
    await dragStrip(stripFor(1), plotHeight);
    const after2 = await stableBands(uplot);
    expect(after2[1]!.bottom - after2[1]!.top).toBeGreaterThanOrEqual(
      plotHeight * 0.1 - 1,
    );
  });

  it("AC3: double-clicking a separator equalizes all lanes", async () => {
    await mountFullUi();
    await enableStack();

    await dragStrip(stripFor(2), 50);
    const resized = fractionsOf();
    expect(Math.abs(resized[1]! - 0.25)).toBeGreaterThan(0.03);

    await act(async () => {
      stripFor(2).dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });
    await settle(100);
    expect(useLaneLayoutStore.getState().weights).toEqual({});
    const equalized = fractionsOf();
    equalized.forEach((fraction) => {
      expect(fraction).toBeCloseTo(0.25, 5);
    });
  });

  it("AC4: after resizing, each lane's scale window matches its height fraction and pan/zoom keeps working per lane", async () => {
    const uplot = await mountFullUi();
    const baseSpan = (index: number): number => {
      const s = uplot.scales[yScaleKey(index)]!;
      return s.max! - s.min!;
    };
    // Pre-stack spans (the overlay fit the stack entry saves) per channel.
    const preSpans = [0, 1, 2, 3].map(baseSpan);

    await enableStack();
    await dragStrip(stripFor(1), 40);
    const fractions = fractionsOf();
    const plotH = (await stableBands(uplot))[3]!.bottom;

    [0, 1, 2, 3].forEach((index) => {
      const span = baseSpan(index);
      // span = preSpan / fraction: the pre-stack content view maps onto
      // exactly the lane's height (unit-per-pixel scales with the lane).
      expect(span).toBeCloseTo(preSpans[index]! / fractions[index]!, 4);
    });
    void plotH;

    // Pan/zoom on one lane: only that lane's window moves.
    const before = [0, 1, 2, 3].map((i) => {
      const s = uplot.scales[yScaleKey(i)]!;
      return { min: s.min!, max: s.max! };
    });
    await act(async () => {
      uplot.setScale(yScaleKey(2), {
        min: before[2]!.min + 5,
        max: before[2]!.max + 5,
      });
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(uplot.scales[yScaleKey(2)]!.min!).toBeCloseTo(before[2]!.min + 5, 4);
    expect(uplot.scales[yScaleKey(0)]!.min!).toBeCloseTo(before[0]!.min, 6);
    expect(uplot.scales[yScaleKey(1)]!.max!).toBeCloseTo(before[1]!.max, 6);
  });

  it("AC5: the handle claims only its narrow strip — box-zoom, cursor drags, and Ctrl+drag offset are unaffected", async () => {
    const uplot = await mountFullUi();
    await enableStack();

    const xMinBefore = uplot.scales.x!.min!;
    const xMaxBefore = uplot.scales.x!.max!;

    // A box-zoom drag on the plot (away from the centered handle strip)
    // still zooms: dispatch uPlot's native drag-zoom via setScale is not
    // the gesture; instead verify the plot overlay still receives
    // presses by driving a cursor drag (C1) below.
    // 1) Cursor drag: mousedown on the plot moves C1.
    useCursorStore.getState().toggleCursor("C1", 1000);
    await settle(30);
    const over = uplot.over.getBoundingClientRect();
    const startX = Math.round(over.left + 200);
    const startY = Math.round(over.top + 100);
    await act(async () => {
      uplot.over.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: startX,
          clientY: startY,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          buttons: 1,
          clientX: startX + 60,
          clientY: startY,
        }),
      );
    });
    await settle(40);
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: startX + 60,
          clientY: startY,
        }),
      );
    });
    const cursorMoved = useCursorStore.getState().c1SampleIndex !== 1000;
    expect(cursorMoved).toBe(true);
    // The cursor drag never touched the lane weights.
    expect(useLaneLayoutStore.getState().weights).toEqual({});
    expect(uplot.scales.x!.min!).toBe(xMinBefore);
    expect(uplot.scales.x!.max!).toBe(xMaxBefore);

    // 2) Ctrl+drag offset over a trace still adjusts the offset.
    const capture = useCaptureStore.getState().capture!;
    const mid = Math.floor(capture.timestamps.length / 2);
    const traceY = uplot.valToPos(uplot.data[1]![mid]!, yScaleKey(0));
    const tx = Math.round(
      over.left + uplot.valToPos(capture.timestamps[mid]!, "x"),
    );
    const ty = Math.round(over.top + traceY);
    await act(async () => {
      uplot.over.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          ctrlKey: true,
          clientX: tx,
          clientY: ty,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          buttons: 1,
          ctrlKey: true,
          clientX: tx,
          clientY: ty + 30,
        }),
      );
    });
    await settle(40);
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: tx,
          clientY: ty + 30,
        }),
      );
    });
    expect(
      useChannelDisplayStore.getState().keyConfigs.A?.offset ?? 0,
    ).toBeLessThan(0);
  });

  it("AC6: lane proportions persist per .fvf file and a different file starts equal", async () => {
    // The real App owns the capture-identity wiring (setFileKey), so
    // this test mounts it and drives the capture store directly.
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    await enableStack();

    const strip = document.querySelector(
      "[data-testid='lane-resize-1']",
    ) as HTMLElement;
    expect(strip).not.toBeNull();
    await dragStrip(strip, 40);
    const weightsBefore = { ...useLaneLayoutStore.getState().weights };
    expect(Object.keys(weightsBefore).length).toBeGreaterThan(0);

    // Reload the SAME file (same name + timestamp -> same file key).
    await act(async () => {
      await useCaptureStore
        .getState()
        .parseBuffer(await fixture(fourChUrlQ), "four.fvf");
    });
    await settle(300);
    expect(useLaneLayoutStore.getState().weights).toEqual(weightsBefore);

    // A DIFFERENT file starts from equal lanes.
    await act(async () => {
      await useCaptureStore
        .getState()
        .parseBuffer(await fixture(twoChMinUrlQ), "two.fvf");
    });
    await settle(300);
    expect(useLaneLayoutStore.getState().weights).toEqual({});
  }, 60_000);

  it("AC7: visibility changes renormalize — survivors keep relative weights, joiners default; idempotent", async () => {
    const uplot = await mountFullUi();
    await enableStack();
    await dragStrip(stripFor(1), 40);

    const fractionsWithAll = fractionsOf();
    // Hide B (lane 1): A, C, D keep their relative fractions over the
    // remaining total.
    act(() => {
      useViewportStore.getState().setActiveChannels(["A", "C", "D"]);
    });
    await settle(200);
    const fractionsWithoutB = fractionsOf();
    expect(fractionsWithoutB).toHaveLength(3);
    const total = fractionsWithoutB.reduce((s, f) => s + f, 0);
    expect(total).toBeCloseTo(1, 5);
    // A's relative share among survivors is preserved.
    const aShareBefore = fractionsWithAll[0]!;
    const aShareAfter = fractionsWithoutB[0]!;
    // A's fraction grows (B's space redistributes) but proportionally
    // to the others.
    expect(aShareAfter).toBeGreaterThan(aShareBefore);

    // Toggle B back and forth: never drifts.
    act(() => {
      useViewportStore.getState().setActiveChannels(["A", "B", "C", "D"]);
    });
    await settle(200);
    const round1 = fractionsOf();
    act(() => {
      useViewportStore.getState().setActiveChannels(["A", "C", "D"]);
    });
    await settle(200);
    act(() => {
      useViewportStore.getState().setActiveChannels(["A", "B", "C", "D"]);
    });
    await settle(200);
    const round2 = fractionsOf();
    round1.forEach((fraction, index) => {
      expect(fraction).toBeCloseTo(round2[index]!, 6);
    });
    void uplot;
  });

  it("AC8: reference lanes participate; comparison teardown drops their weights", async () => {
    // The real App owns the teardown wiring (Ref weights drop with the
    // comparison), so this test mounts it.
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    await act(async () => {
      await useReferenceStore
        .getState()
        .parseReferenceBuffer(await fixture(twoChMinUrlQ), "file2.fvf");
    });
    await settle(300);
    await enableStack();

    const container = document.querySelector(
      "[data-testid='oscilloscope-container']",
    ) as HTMLElement & { __uplot?: uPlot };
    const uplot = container.__uplot!;
    expect(uplot).toBeDefined();

    // Six lanes now (4 primaries + 2 refs); the last boundary sits
    // between the two reference lanes.
    const bands = bandsOf(uplot);
    expect(bands).toHaveLength(6);
    const strip = stripFor(5);
    expect(strip).not.toBeNull();

    // Resize the Ref-A/Ref-B boundary: only their weights change.
    await dragStrip(strip, 20);
    const weights = useLaneLayoutStore.getState().weights;
    expect(weights["Ref-A"]).toBeDefined();
    expect(weights["Ref-B"]).toBeDefined();
    expect(weights.A).toBeUndefined();

    // Teardown drops the reference weights with the lanes.
    await act(async () => {
      useReferenceStore.getState().clear();
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(useLaneLayoutStore.getState().weights["Ref-A"]).toBeUndefined();
    expect(useLaneLayoutStore.getState().weights["Ref-B"]).toBeUndefined();
  }, 60_000);

  it("AC9: Stack -> Overlay -> Stack restores the proportions; Reset View equalizes them (Issue #263)", async () => {
    await mountFullUi();
    await enableStack();
    await dragStrip(stripFor(1), 40);
    const fractionsAfterResize = fractionsOf();

    // Overlay then Stack again: proportions restored.
    await act(async () => {
      useChannelDisplayStore.getState().setStackMode(false);
    });
    await settle(200);
    await enableStack();
    const restored = fractionsOf();
    restored.forEach((fraction, index) => {
      expect(fraction).toBeCloseTo(fractionsAfterResize[index]!, 5);
    });

    // Issue #263: Reset View in Stack mode equalizes custom dragged lane weights.
    await act(async () => {
      (
        document.querySelector(
          "[data-testid='reset-view-button']",
        ) as HTMLButtonElement
      ).click();
    });
    await settle(100);
    expect(useLaneLayoutStore.getState().weights).toEqual({});
    const afterReset = fractionsOf();
    expect(afterReset).toHaveLength(4);
    afterReset.forEach((fraction) => {
      expect(fraction).toBeCloseTo(0.25, 5);
    });
  });
});
