import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type uPlot from "uplot";
import fourChUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import twoChMinUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-2ch-10000-1min-div.fvf.bin?url";
import Oscilloscope from "./Oscilloscope";
import { findNearestSampleIndex } from "../cursors/cursorPlugin";
import { slippedRefDisplayLane } from "./timeSlip";
import { useCaptureStore } from "../../state/captureStore";
import { yScaleKey } from "../../capture/channelUnits";
import { useCursorStore } from "../../state/cursorStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useViewportStore } from "../../state/viewportStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";

/**
 * Issue #97 acceptance: the T₂ trigger glyph handle pinned to the top
 * graticule border drags File 2 horizontally (Δt) with live lane
 * rewrites, the HUD Readout Card's "Align at Cursors" locks
 * Δt = t_C1 − t_C2 exactly, focused Left/Right arrows nudge by one
 * sample index (Shift = 10), and the slip persists across viewport
 * pans. Mouse coordinates are integer-rounded (synthetic events).
 */

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching ${url}`).toBeTruthy();
  return response.arrayBuffer();
}

function stripEl(): HTMLDivElement {
  const el = document.querySelector("[data-testid='t2-trigger-handle']");
  expect(el).toBeInstanceOf(HTMLElement);
  return el as HTMLDivElement;
}

/** Visible-window px-per-grid-sample, mirroring the plugin's mapping. */
function pxPerGridSample(u: uPlot): number {
  const ts = useCaptureStore.getState().capture!.timestamps;
  const xMin = u.scales.x?.min ?? ts[0]!;
  const xMax = u.scales.x?.max ?? ts[ts.length - 1]!;
  let i0 = findNearestSampleIndex(ts, xMin);
  let i1 = findNearestSampleIndex(ts, xMax);
  if (i1 < i0) [i0, i1] = [i1, i0];
  const px = Math.abs(u.valToPos(ts[i1]!, "x") - u.valToPos(ts[i0]!, "x"));
  return px / (i1 - i0);
}

function refSeriesIndex(u: uPlot, refIdx: number): number {
  const primaryCount = useCaptureStore.getState().capture!.channels.length;
  return 1 + primaryCount + refIdx;
}

describe("Time slip for File 2 (issue #97)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;

  const mountOscilloscope = async (): Promise<uPlot> => {
    let mounted: uPlot | null = null;
    await act(async () => {
      root.render(
        <Oscilloscope
          onUPlotInit={(u) => {
            mounted = u;
          }}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(mounted).not.toBeNull();
    return mounted!;
  };

  const loadBoth = async (): Promise<void> => {
    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(fourChUrl), "file1.fvf");
    await useReferenceStore
      .getState()
      .parseReferenceBuffer(await fixture(twoChMinUrl), "file2.fvf");
  };

  beforeEach(async () => {
    useCaptureStore.getState().reset();
    useReferenceStore.getState().clear();
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
    useChannelDisplayStore.getState().reset();
    useChannelNamesStore.setState({ fileKey: null, names: {} });
    window.localStorage.clear();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
    await loadBoth();
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
    useCaptureStore.getState().reset();
    useReferenceStore.getState().clear();
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
    useChannelDisplayStore.getState().reset();
    useChannelNamesStore.setState({ fileKey: null, names: {} });
    window.localStorage.clear();
  });

  it("AC1: renders the T2 handle pinned to the top graticule border at File 2's trigger", async () => {
    const uplot = await mountOscilloscope();
    const strip = stripEl();

    expect(strip.style.display).toBe("block");
    const rootRect = uplot.root.getBoundingClientRect();
    const stripRect = strip.getBoundingClientRect();
    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const plotTopCss = uplot.bbox.top / pxRatio;
    // The strip rides the top border: its bottom edge sits on bbox.top.
    expect(Math.abs(stripRect.bottom - rootRect.top - plotTopCss)).toBeLessThan(
      2,
    );

    // Horizontally centered on the (unslipped) trigger anchor position.
    const anchorTime = 0;
    const plotLeftCss = uplot.bbox.left / pxRatio;
    const expectedX = plotLeftCss + uplot.valToPos(anchorTime, "x");
    const stripCenter = stripRect.left + stripRect.width / 2 - rootRect.left;
    expect(Math.abs(stripCenter - expectedX)).toBeLessThan(2);
  });

  it("AC1: dragging the T2 handle shifts File 2's lanes by the dragged samples", async () => {
    const uplot = await mountOscilloscope();
    const base = useReferenceStore.getState().lanes![0]!;

    // Zoom to a ~100-sample window around the trigger anchor so a
    // 6-sample slip is tens of pixels of drag (deterministic mapping).
    const ts = useCaptureStore.getState().capture!.timestamps;
    const dt = (ts[ts.length - 1]! - ts[0]!) / (ts.length - 1);
    await act(async () => {
      uplot.setScale("x", { min: -50 * dt, max: 50 * dt });
    });
    const strip = stripEl();
    expect(strip.style.display).toBe("block");

    const startX = Math.round(strip.getBoundingClientRect().left + 15);
    const startY = Math.round(strip.getBoundingClientRect().top + 8);
    const dx = Math.round(pxPerGridSample(uplot) * 6);

    await act(async () => {
      strip.dispatchEvent(
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
          clientX: startX + dx,
          clientY: startY,
        }),
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: startX + dx,
          clientY: startY,
        }),
      );
    });

    const slip = useReferenceStore.getState().timeSlipSamples;
    // ~6 grid samples to the right (clientX rounding tolerance ±1 px).
    expect(slip).toBeGreaterThan(4.5);
    expect(slip).toBeLessThan(7.5);

    // The rendered lane is exactly the slipped base lane, in place
    // (same uPlot instance, no remount), with the display transform at
    // its defaults composing losslessly.
    const rendered = uplot.data[refSeriesIndex(uplot, 0)]! as Float32Array;
    const expected = slippedRefDisplayLane(base, slip, 100, 0, false);
    for (let i = 0; i < Math.min(rendered.length, expected.length); i += 1) {
      const a = rendered[i] ?? Number.NaN;
      const b = expected[i] ?? Number.NaN;
      if (Number.isNaN(b)) expect(Number.isNaN(a)).toBe(true);
      else expect(Math.abs(a - b)).toBeLessThan(1e-4);
    }
  });

  it("AC2: Align at Cursors locks File 2 so the feature under C2 lands exactly on C1", async () => {
    const uplot = await mountOscilloscope();
    const total = useCaptureStore.getState().capture!.timestamps.length;
    const c1 = Math.floor(total * 0.6);
    const c2 = Math.floor(total * 0.3);
    useCursorStore.setState({
      c1Active: true,
      c2Active: true,
      selectedCursor: "C1",
      c1SampleIndex: c1,
      c2SampleIndex: c2,
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    const button = document.querySelector(
      "[data-testid='align-at-cursors-btn']",
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button!.textContent).toContain("Align at Cursors");

    await act(async () => {
      button!.click();
    });

    // Δt = t_C1 − t_C2 exactly, in integer grid samples.
    expect(useReferenceStore.getState().timeSlipSamples).toBe(c1 - c2);

    // The File 2 sample that was under C2 now renders at C1's index:
    // slipped[i1] = base[i1 − slip] = base[i2].
    const base = useReferenceStore.getState().lanes![0]!;
    const rendered = uplot.data[refSeriesIndex(uplot, 0)]! as Float32Array;
    expect(Math.abs(rendered[c1]! - base[c2]!)).toBeLessThan(1e-4);
  });

  it("AC2: the align button is absent without a comparison (File 2 cleared)", async () => {
    await act(async () => {
      useReferenceStore.getState().clear();
    });
    await mountOscilloscope();
    useCursorStore.setState({
      c1Active: true,
      c2Active: true,
      selectedCursor: "C1",
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(
      document.querySelector("[data-testid='align-at-cursors-btn']"),
    ).toBeNull();
  });

  it("AC3: focused Left/Right arrows nudge by one sample (Shift = 10); other contexts do not", async () => {
    await mountOscilloscope();
    const strip = stripEl();

    // Unfocused: arrows do nothing.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(useReferenceStore.getState().timeSlipSamples).toBe(0);

    await act(async () => {
      strip.focus();
    });
    expect(document.activeElement).toBe(strip);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(useReferenceStore.getState().timeSlipSamples).toBe(1);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    expect(useReferenceStore.getState().timeSlipSamples).toBe(0);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(useReferenceStore.getState().timeSlipSamples).toBe(10);

    // Ctrl+arrows stay owned by the measurement cursors (#14).
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        ctrlKey: true,
        bubbles: true,
      }),
    );
    expect(useReferenceStore.getState().timeSlipSamples).toBe(10);

    // Typing in an editable target never nudges the slip.
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
      }),
    );
    expect(useReferenceStore.getState().timeSlipSamples).toBe(10);
    input.remove();
  });

  it("AC4: an applied slip persists across viewport pan and box-zoom", async () => {
    const uplot = await mountOscilloscope();
    useReferenceStore.getState().setTimeSlip(25);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    const before = [...(uplot.data[refSeriesIndex(uplot, 0)]! as Float32Array)];
    const xMin = uplot.scales.x!.min!;
    const xMax = uplot.scales.x!.max!;
    const quarter = (xMax - xMin) / 4;

    await act(async () => {
      // Box-zoom-shaped x window change (pan + zoom in).
      uplot.setScale("x", { min: xMin + quarter, max: xMax - quarter });
    });

    expect(useReferenceStore.getState().timeSlipSamples).toBe(25);
    const after = [...(uplot.data[refSeriesIndex(uplot, 0)]! as Float32Array)];
    expect(after).toEqual(before);
  });

  it("issue #150 coexistence: a shown hover tooltip hides when the slip changes", async () => {
    const uplot = await mountOscilloscope();
    const ts = useCaptureStore.getState().capture!.timestamps;
    const lane = uplot.data[1]! as Float32Array;
    const mid = Math.floor(ts.length / 2);
    const xCss = uplot.valToPos(ts[mid]!, "x");
    const yCss = uplot.valToPos(lane[mid]!, yScaleKey(0));
    const overRect = uplot.over.getBoundingClientRect();

    await act(async () => {
      uplot.over.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          clientX: Math.round(overRect.left + xCss),
          clientY: Math.round(overRect.top + yCss),
        }),
      );
    });
    // The client point pins over-relative plot coordinates; dwell
    // past HOVER_DWELL_MS (500 ms).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    const tooltip = document.querySelector(
      "[data-testid='hover-tooltip']",
    ) as HTMLElement | null;
    expect(tooltip).not.toBeNull();
    expect(tooltip!.style.display).toBe("block");

    await act(async () => {
      useReferenceStore.getState().nudgeTimeSlip(1);
    });
    expect(tooltip!.style.display).toBe("none");
  });
});
