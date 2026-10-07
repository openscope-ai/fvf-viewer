import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type uPlot from "uplot";
import fourChUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import twoChMinUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-2ch-10000-1min-div.fvf.bin?url";
import Oscilloscope from "./Oscilloscope";
import { useCaptureStore } from "../../state/captureStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useViewportStore } from "../../state/viewportStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";

/**
 * Issue #96 canvas rendering: reference lanes append as trailing series
 * with their own scales and secondary-palette strokes, visibility is
 * independent of the primary set, and the #224 display transforms apply
 * to reference lanes exactly like primary ones.
 */

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching ${url}`).toBeTruthy();
  return response.arrayBuffer();
}

describe("Reference lanes on canvas (issue #96)", () => {
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
    useChannelDisplayStore.getState().reset();
    useChannelNamesStore.setState({ fileKey: null, names: {} });
    window.localStorage.clear();
  });

  it("renders trailing reference series with own scales and secondary strokes", async () => {
    const uplot = await mountOscilloscope();
    const primaryCount = useCaptureStore.getState().capture!.channels.length;

    // 1 Time + 4 primary + 2 reference series.
    expect(uplot.series).toHaveLength(1 + primaryCount + 2);

    const refA = uplot.series[primaryCount + 1]!;
    expect(refA.label).toContain("Ref-A");
    expect(refA.scale).toBe(`y${primaryCount}`);
    const stroke =
      typeof refA.stroke === "function"
        ? refA.stroke(uplot, primaryCount + 1)
        : String(refA.stroke);
    // Dark-theme secondary palette default for Ref-A.
    expect(stroke).toBe("#FF6EC7");

    // Lanes align with File 1's time grid (Wasm resampling).
    const gridLen = useCaptureStore.getState().capture!.timestamps.length;
    expect(uplot.data[primaryCount + 1]!.length).toBe(gridLen);

    // Pinned reference scale exists with symmetric bounds.
    const scale = uplot.scales[`y${primaryCount}`]!;
    expect(scale.min).toBeLessThan(0);
    expect(scale.max).toBeGreaterThan(0);
  });

  it("toggles reference visibility independently of the primary set", async () => {
    const uplot = await mountOscilloscope();
    const primaryCount = useCaptureStore.getState().capture!.channels.length;
    const refAIdx = primaryCount + 1;

    expect(uplot.series[refAIdx]!.show).toBe(true);
    await act(async () => {
      useReferenceStore.getState().toggleRefChannel("Ref-A");
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(uplot.series[refAIdx]!.show).toBe(false);
    // Primary channels keep rendering.
    expect(uplot.series[1]!.show).toBe(true);
  });

  it("applies the #224 display transforms to reference lanes in place", async () => {
    const uplot = await mountOscilloscope();
    const primaryCount = useCaptureStore.getState().capture!.channels.length;
    const refAIdx = primaryCount + 1;
    const laneBefore = Float32Array.from(uplot.data[refAIdx]!);

    await act(async () => {
      useChannelDisplayStore.getState().setYScale("Ref-A", 200);
      useChannelDisplayStore.getState().setInverted("Ref-A", true);
      await new Promise((r) => setTimeout(r, 30));
    });

    const lane = uplot.data[refAIdx]!;
    for (let i = 0; i < lane.length; i += 41) {
      const before = laneBefore[i]!;
      if (Number.isFinite(before)) {
        expect(lane[i]).toBeCloseTo(-(before * 2), 4);
      } else {
        expect(lane[i]).toBeNaN();
      }
    }
    // The raw resampled lane stays untouched (physical truth).
    const rawLane = useReferenceStore.getState().lanes![0]!;
    expect([...rawLane]).toEqual([...laneBefore]);
  });
});
