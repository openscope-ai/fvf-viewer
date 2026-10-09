import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type uPlot from "uplot";
import fourChUrlQ from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
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
import { laneBandsCss } from "./stackLaneDecorations";
import { computeGroundFlags } from "./groundFlags";

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
  labelSize?: number;
}

function axisOf(u: uPlot, scaleKey: string): AxisInternals {
  const axis = u.axes.find(
    (a) => a.scale === scaleKey,
  ) as unknown as AxisInternals;
  expect(axis, `axis for ${scaleKey}`).toBeDefined();
  return axis;
}

function pxRatioOf(u: uPlot): number {
  return u.width > 0 ? u.ctx.canvas.width / u.width : 1;
}

describe("Issue #268: Stack view horizontally aligned Y-axes single column & reclaimed width", () => {
  let host: HTMLDivElement;
  let root: Root;

  const mountUi = async (): Promise<uPlot> => {
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

  it("AC1 & AC2: In Stack mode, all Y-axes horizontally align and bbox.left expands leftward reclaiming space", async () => {
    const uplot = await mountUi();
    const pxRatio = pxRatioOf(uplot);

    // Initial Overlay mode: 4 active channels have staggered axis positions
    const overlayLeftCss = uplot.bbox.left / pxRatio;
    const axA_overlay = axisOf(uplot, yScaleKey(0));
    const axB_overlay = axisOf(uplot, yScaleKey(1));
    const axC_overlay = axisOf(uplot, yScaleKey(2));
    const axD_overlay = axisOf(uplot, yScaleKey(3));

    // Staggered columns in Overlay mode: distinct positions
    expect(axA_overlay._pos).toBeDefined();
    expect(axB_overlay._pos).toBeDefined();
    expect(axC_overlay._pos).toBeDefined();
    expect(axD_overlay._pos).toBeDefined();
    expect(axA_overlay._pos).toBeLessThan(axB_overlay._pos!);
    expect(axB_overlay._pos).toBeLessThan(axC_overlay._pos!);
    expect(axC_overlay._pos).toBeLessThan(axD_overlay._pos!);

    // Switch to Stack mode
    await act(async () => {
      useChannelDisplayStore.getState().setStackMode(true);
    });
    await settle(250);

    const stackLeftCss = uplot.bbox.left / pxRatio;

    // AC2: The plot area expands to the left, reclaiming > 100px of staggered column space
    const reclaimedPx = overlayLeftCss - stackLeftCss;
    expect(reclaimedPx).toBeGreaterThan(100);

    // AC1: All 4 active channel Y-axes horizontally align into the same column
    const axA_stack = axisOf(uplot, yScaleKey(0));
    const axB_stack = axisOf(uplot, yScaleKey(1));
    const axC_stack = axisOf(uplot, yScaleKey(2));
    const axD_stack = axisOf(uplot, yScaleKey(3));

    expect(axA_stack._pos).toBe(stackLeftCss);
    expect(axB_stack._pos).toBe(stackLeftCss);
    expect(axC_stack._pos).toBe(stackLeftCss);
    expect(axD_stack._pos).toBe(stackLeftCss);

    expect(axA_stack._lpos).toBe(axB_stack._lpos);
    expect(axB_stack._lpos).toBe(axC_stack._lpos);
    expect(axC_stack._lpos).toBe(axD_stack._lpos);

    // Ground flags align with the unified column
    const capture = useCaptureStore.getState().capture!;
    const flags = computeGroundFlags(uplot, capture);
    expect(flags).toHaveLength(4);
    for (const flag of flags) {
      expect(flag.colRight).toBe(stackLeftCss);
      expect(flag.colLeft).toBe(axA_stack._lpos! - (axA_stack.labelSize ?? 0));
    }
  });

  it("AC3 & AC4: Mode toggling round-trips cleanly between Overlay and Stack modes", async () => {
    const uplot = await mountUi();
    const pxRatio = pxRatioOf(uplot);

    const overlayLeft1 = uplot.bbox.left / pxRatio;

    // Toggle to Stack
    await act(async () => {
      useChannelDisplayStore.getState().setStackMode(true);
    });
    await settle(200);

    const stackLeft = uplot.bbox.left / pxRatio;
    expect(stackLeft).toBeLessThan(overlayLeft1);

    // Toggle back to Overlay
    await act(async () => {
      useChannelDisplayStore.getState().setStackMode(false);
    });
    await settle(200);

    const overlayLeft2 = uplot.bbox.left / pxRatio;
    expect(overlayLeft2).toBeCloseTo(overlayLeft1, 0);

    const axA = axisOf(uplot, yScaleKey(0));
    const axD = axisOf(uplot, yScaleKey(3));
    expect(axA._pos).toBeLessThan(axD._pos!);
  });

  it("AC5: Clicking anywhere within the unified column selects the channel corresponding to that lane band", async () => {
    const uplot = await mountUi();
    const capture = useCaptureStore.getState().capture!;
    await act(async () => {
      useChannelDisplayStore.getState().setStackMode(true);
    });
    await settle(200);

    const container = document.querySelector(
      "[data-testid='oscilloscope-container']",
    ) as HTMLElement;
    const rect = container.getBoundingClientRect();
    const pxRatio = pxRatioOf(uplot);
    const plotTop = uplot.bbox.top / pxRatio;
    const bands = laneBandsCss(uplot, capture);
    expect(bands).toHaveLength(4);

    const colX = Math.round(rect.left + uplot.bbox.left / pxRatio - 20);

    // Click in Lane 2 (Channel C)
    const bandC = bands.find((b) => b.key === "C")!;
    await act(async () => {
      container.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: colX,
          clientY: Math.round(
            rect.top + plotTop + (bandC.top + bandC.bottom) / 2,
          ),
        }),
      );
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(useViewportStore.getState().selectedChannel).toBe("C");

    // Click in Lane 3 (Channel D)
    const bandD = bands.find((b) => b.key === "D")!;
    await act(async () => {
      container.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: colX,
          clientY: Math.round(
            rect.top + plotTop + (bandD.top + bandD.bottom) / 2,
          ),
        }),
      );
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(useViewportStore.getState().selectedChannel).toBe("D");

    // Click in Lane 0 (Channel A)
    const bandA = bands.find((b) => b.key === "A")!;
    await act(async () => {
      container.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: colX,
          clientY: Math.round(
            rect.top + plotTop + (bandA.top + bandA.bottom) / 2,
          ),
        }),
      );
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(useViewportStore.getState().selectedChannel).toBe("A");
  });
});
