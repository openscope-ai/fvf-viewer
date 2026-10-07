import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type uPlot from "uplot";
import fourChUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import Oscilloscope, { computeCaptureFit } from "./Oscilloscope";
import { useCaptureStore } from "../../state/captureStore";
import { useViewportStore } from "../../state/viewportStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";

/**
 * Issue #224 canvas integration: the per-channel display transforms
 * (Y-scale %, offset, invert ±) rewrite the rendered uPlot lanes in
 * place — never re-creating the plot, never touching the physical
 * capture buffers — and Fit Waveform frames the *displayed* trace.
 */

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching ${url}`).toBeTruthy();
  return response.arrayBuffer();
}

describe("Channel display transforms on canvas (issue #224)", () => {
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

  beforeEach(async () => {
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
    useChannelNamesStore.setState({ fileKey: null, names: {} });
    useChannelDisplayStore.getState().reset();
    window.localStorage.clear();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(fourChUrl), "four.fvf");

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
    useViewportStore.getState().reset();
    useChannelDisplayStore.getState().reset();
    useChannelNamesStore.setState({ fileKey: null, names: {} });
    window.localStorage.clear();
  });

  it("rewrites rendered lanes in place (no plot re-creation, physical buffers untouched)", async () => {
    const uplot = await mountOscilloscope();
    const capture = useCaptureStore.getState().capture!;
    const physicalCopy = Float32Array.from(capture.channels[0]!.data);
    const laneBefore = Float32Array.from(uplot.data[1]!);

    await act(async () => {
      useChannelDisplayStore.getState().setYScale("A", 200);
      useChannelDisplayStore.getState().setOffset("A", 1);
      useChannelDisplayStore.getState().setInverted("A", true);
      await new Promise((r) => setTimeout(r, 30));
    });

    // Same uPlot instance — scrubbing never re-creates the plot.
    const container = hostElement.querySelector(
      ".oscilloscope-container",
    ) as HTMLElement & { __uplot?: uPlot };
    expect(container.__uplot).toBe(uplot);

    // Lane carries sign * physical * 200% + 1 for every finite sample of
    // the rail-clipped display lane.
    const lane = uplot.data[1]!;
    expect(lane.length).toBe(laneBefore.length);
    for (let i = 0; i < lane.length; i += 97) {
      const before = laneBefore[i]!;
      if (Number.isFinite(before)) {
        expect(lane[i]).toBeCloseTo(-(before * 2) + 1, 5);
      } else {
        expect(lane[i]).toBeNaN();
      }
    }

    // The physical capture buffer is untouched (readouts keep truth).
    expect([...capture.channels[0]!.data]).toEqual([...physicalCopy]);
  });

  it("Fit Waveform frames the displayed trace through the transform", async () => {
    const uplot = await mountOscilloscope();
    const capture = useCaptureStore.getState().capture!;

    await act(async () => {
      useChannelDisplayStore.getState().setYScale("A", 150);
      useChannelDisplayStore.getState().setOffset("A", 2);
      await new Promise((r) => setTimeout(r, 30));
    });
    await act(async () => {
      useViewportStore.getState().requestFit();
      await new Promise((r) => setTimeout(r, 30));
    });

    const physical = computeCaptureFit(capture).channels[0]!;
    // Symmetric fit bounds scale by 150% and recenter on the +2 offset.
    const expectedSpan = (physical.max - physical.min) * 1.5;
    const scale = uplot.scales.y0!;
    expect(scale.max! - scale.min!).toBeCloseTo(expectedSpan, 6);
    expect((scale.max! + scale.min!) / 2).toBeCloseTo(2, 6);
  });

  it("capture ingestion clears solo state and restores the visibility set", async () => {
    await mountOscilloscope();
    await act(async () => {
      useChannelDisplayStore.getState().toggleSolo("B");
    });
    expect(useViewportStore.getState().activeChannels).toEqual(["B"]);
    expect(useChannelDisplayStore.getState().solo).not.toBeNull();

    // Ingesting a replacement capture clears solo (issue #224).
    await act(async () => {
      await useCaptureStore
        .getState()
        .parseBuffer(await fixture(fourChUrl), "four.fvf");
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(useChannelDisplayStore.getState().solo).toBeNull();
    expect(useViewportStore.getState().activeChannels).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });
});
