import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type uPlot from "uplot";
import fourChUrlQ from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import twoChMinUrlQ from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-2ch-10000-1min-div.fvf.bin?url";
import Oscilloscope from "./Oscilloscope";
import WaveformToolbar from "../toolbar/WaveformToolbar";
import { useCaptureStore } from "../../state/captureStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useViewportStore } from "../../state/viewportStore";
import { useCursorStore } from "../../state/cursorStore";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import { useBadgePopoverStore } from "../toolbar/badgeConfig/anchoredPopover";
import { AXIS_LABEL_SIZE_PX } from "./axesConfig";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching ${url}`).toBeTruthy();
  return response.arrayBuffer();
}

interface AxisInternals {
  scale?: string;
  side?: number;
  show?: boolean;
  _pos?: number;
  _size?: number;
  _lpos?: number;
  label?: unknown;
  labelSize?: number;
}

describe("Issue #338: Real-world zoom, pan, hide, remove, switch sequence", () => {
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
    await settle(40);
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

  it("checks axes across zoom, pan, hide, compare, and mode toggling", async () => {
    const uplot = await mountFullUi();

    // 1. Zoom/pan primary
    await act(async () => {
      uplot.batch(() => {
        uplot.setScale("x", { min: -0.01, max: 0.02 });
        uplot.setScale("y0", { min: -2.5, max: 1.5 });
      });
      useViewportStore.getState().setActiveChannels(["A", "B", "C"]);
    });
    await settle();

    // 2. Load File 2
    await act(async () => {
      await useReferenceStore
        .getState()
        .parseReferenceBuffer(await fixture(twoChMinUrlQ), "file2.fvf");
    });
    await settle(100);

    const container = document.querySelector(
      "[data-testid='oscilloscope-container']",
    ) as HTMLElement & { __uplot?: uPlot };
    const curUplot = container.__uplot!;

    // 3. Switch to Stack
    await act(async () => {
      useChannelDisplayStore.getState().setStackMode(true);
    });
    await settle();

    // 4. Toggle Ref-A
    act(() => {
      useReferenceStore.getState().toggleRefChannel("Ref-A");
    });
    await settle();

    // 5. Reset View
    await clickResetView();
    await settle();

    // 6. Switch to Overlay
    await act(async () => {
      useChannelDisplayStore.getState().setStackMode(false);
    });
    await settle();

    const visibleAxes = (curUplot.axes as unknown as AxisInternals[]).filter(
      (a) => a.side === 3 && a.show !== false,
    );

    // AC3: All 6 channels (4 primary A-D + 2 reference Ref-A/Ref-B restored by Reset View)
    // are visible with cleanly staggered, non-overlapping columns and restored label sizes.
    expect(visibleAxes.length).toBe(6);
    visibleAxes.forEach((ax) => {
      expect(ax._pos).toBeGreaterThan(0);
      expect(ax.labelSize).toBe(AXIS_LABEL_SIZE_PX);
    });

    const positions = visibleAxes.map((a) => a._pos);
    const unique = new Set(positions);
    expect(unique.size).toBe(6);
  });
});
