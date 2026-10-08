import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type uPlot from "uplot";
import fourChUrlQ from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import twoChMinUrlQ from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-2ch-10000-1min-div.fvf.bin?url";
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

/**
 * Issue #245 acceptance: every surface that rewrites a display lane in
 * place — popover commits (typed Y-scale %/offset via Enter/Tab/blur,
 * −/+ steppers, drag-scrub), interactive ground markers (drag,
 * Ctrl+drag, double-click/Enter reset), and reference channel
 * transforms / time slips — must invalidate uPlot's per-series path
 * cache (`series._paths = null`) for exactly the mutated series, so the
 * immediate-mode repaint rebuilds that geometry instead of stroking the
 * stale pre-transform `Path2D` while the lane data and store are already
 * up to date.
 *
 * Two assertion families:
 * - Path renewal: the `_paths` cache object identity changes across the
 *   commit (scoped: untouched series keep their cached object).
 * - Pixel ground truth: after the commit settles with NO further user
 *   action, the canvas is byte-identical to a forced full redraw
 *   (`uplot.redraw()` re-sets the x scale, which rebuilds every path —
 *   the ground-truth paint of the current lane data).
 *
 * Resize events legitimately invalidate ALL series paths (uPlot
 * `setSize` → `resetYSeries`), which is unrelated to the scoped
 * invalidation under test; the identity assertions therefore freeze
 * `setSize` for their (synchronous) assertion window. Pixel-vs-ground
 * truth comparisons need no freeze: a stray resize repaints fresh
 * geometry on both sides of the comparison.
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

/** Canvas pixels now (must be called after the paint settled). */
function pixels(u: uPlot): string {
  return u.ctx.canvas.toDataURL();
}

describe("Series path invalidation on in-place lane rewrites (issue #245)", () => {
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

  function setReactInputValue(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const commitTyped = async (
    input: HTMLInputElement,
    value: string,
    key: string,
  ): Promise<void> => {
    await act(async () => {
      input.focus();
      input.select();
      setReactInputValue(input, value);
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  };

  /** Plot-area CSS coordinates (integer-rounded) of a rendered sample. */
  const tracePoint = (
    u: uPlot,
    seriesIdx: number,
    sampleIdx: number,
  ): { x: number; y: number } => {
    const series = u.series[seriesIdx]!;
    const scaleKey =
      typeof series.scale === "string" && series.scale !== "x"
        ? series.scale
        : yScaleKey(seriesIdx - 1);
    return {
      x: Math.round(u.valToPos(u.data[0]![sampleIdx]!, "x")),
      y: Math.round(u.valToPos(u.data[seriesIdx]![sampleIdx]!, scaleKey)),
    };
  };

  const clientPoint = (u: uPlot, p: { x: number; y: number }) => {
    const rect = u.over.getBoundingClientRect();
    return {
      clientX: Math.round(rect.left + p.x),
      clientY: Math.round(rect.top + p.y),
    };
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

  it("AC1+AC7: typed Y-scale via Enter renews A's paths and paints the fresh trace (pixels match a full redraw)", async () => {
    const uplot = await mountFullUi();
    const popover = await openPopover("channel-gear-A");
    const input = popover.querySelector(
      "[data-testid='scale-scrub-input']",
    ) as HTMLInputElement;

    const pathsABefore = pathCache(uplot, 1);
    const pixelsBefore = pixels(uplot);

    await commitTyped(input, "200", "Enter");
    expect(useChannelDisplayStore.getState().keyConfigs.A?.yScalePercent).toBe(
      200,
    );
    // Path object renewed synchronously with the commit (in-act).
    expect(pathCache(uplot, 1)).not.toBe(pathsABefore);

    await settle();
    const committed = pixels(uplot);
    expect(committed).not.toBe(pixelsBefore);
    // Ground truth: full redraw of the same lane data.
    uplot.redraw();
    expect(pixels(uplot)).toBe(committed);
  });

  it("AC1+AC7: typed offset via blur renews the paths and matches the ground truth", async () => {
    const uplot = await mountFullUi();
    const popover = await openPopover("channel-gear-A");
    const input = popover.querySelector(
      "[data-testid='offset-scrub-input']",
    ) as HTMLInputElement;

    const pathsABefore = pathCache(uplot, 1);
    await act(async () => {
      input.focus();
      input.select();
      setReactInputValue(input, "4");
    });
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(useChannelDisplayStore.getState().keyConfigs.A?.offset).toBe(4);
    expect(pathCache(uplot, 1)).not.toBe(pathsABefore);

    await settle();
    const committed = pixels(uplot);
    uplot.redraw();
    expect(pixels(uplot)).toBe(committed);
  });

  it("AC5: mutating channel A invalidates only A's path cache; B/C/D keep their cached geometry", async () => {
    const uplot = await mountFullUi();
    const popover = await openPopover("channel-gear-A");
    const input = popover.querySelector(
      "[data-testid='scale-scrub-input']",
    ) as HTMLInputElement;

    const pathsBefore = [1, 2, 3, 4].map((i) => pathCache(uplot, i));

    await withFrozenSetSize(uplot, async () => {
      await commitTyped(input, "150", "Enter");
    });

    expect(useChannelDisplayStore.getState().keyConfigs.A?.yScalePercent).toBe(
      150,
    );
    expect(pathCache(uplot, 1)).not.toBe(pathsBefore[0]);
    // Untouched channels keep their cached path objects.
    expect(pathCache(uplot, 2)).toBe(pathsBefore[1]);
    expect(pathCache(uplot, 3)).toBe(pathsBefore[2]);
    expect(pathCache(uplot, 4)).toBe(pathsBefore[3]);
  });

  it("AC2: steppers renew the paths per click; drag-scrub renews live per move", async () => {
    const uplot = await mountFullUi();
    const popover = await openPopover("channel-gear-A");

    const pathsBefore = pathCache(uplot, 1);
    await act(async () => {
      (
        popover.querySelector(
          "[data-testid='scale-step-up']",
        ) as HTMLButtonElement
      ).click();
    });
    expect(useChannelDisplayStore.getState().keyConfigs.A?.yScalePercent).toBe(
      105,
    );
    const afterStep = pathCache(uplot, 1);
    expect(afterStep).not.toBe(pathsBefore);

    await settle();
    const committedStep = pixels(uplot);
    uplot.redraw();
    expect(pixels(uplot)).toBe(committedStep);

    // Drag-scrub: two live moves, each renewing the path cache.
    const zone = popover.querySelector(
      "[data-testid='scale-scrub-field'] .badge-opacity-scrub",
    ) as HTMLElement;
    const startX = 300;
    const startY = Math.round(zone.getBoundingClientRect().top + 4);
    const pathsBeforeScrub = pathCache(uplot, 1);
    for (const dx of [40, 80]) {
      await act(async () => {
        zone.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            button: 0,
            clientX: startX,
            clientY: startY,
          }),
        );
        zone.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            buttons: 1,
            clientX: startX + dx,
            clientY: startY,
          }),
        );
        zone.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            button: 0,
            clientX: startX + dx,
            clientY: startY,
          }),
        );
      });
    }
    // 105 (stepper) + 5% + 10% across the two scrub moves.
    expect(useChannelDisplayStore.getState().keyConfigs.A?.yScalePercent).toBe(
      120,
    );
    const afterScrub = pathCache(uplot, 1);
    expect(afterScrub).not.toBe(pathsBeforeScrub);
    expect(afterScrub).not.toBe(afterStep);

    await settle();
    const committedScrub = pixels(uplot);
    uplot.redraw();
    expect(pixels(uplot)).toBe(committedScrub);
  });

  it("AC3: Ctrl+drag on a trace (and marker drag) renews the paths at drag cadence and matches the ground truth", async () => {
    const uplot = await mountFullUi();
    const mid = Math.floor(
      useCaptureStore.getState().capture!.timestamps.length / 2,
    );
    const start = clientPoint(uplot, tracePoint(uplot, 1, mid));
    const pathsBefore = pathCache(uplot, 1);

    await act(async () => {
      uplot.over.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          ctrlKey: true,
          clientX: start.clientX,
          clientY: start.clientY,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          buttons: 1,
          ctrlKey: true,
          clientX: start.clientX,
          clientY: start.clientY + 30,
        }),
      );
    });
    await settle();
    const afterFirstMove = pathCache(uplot, 1);
    expect(afterFirstMove).not.toBe(pathsBefore);

    await act(async () => {
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          buttons: 1,
          ctrlKey: true,
          clientX: start.clientX,
          clientY: start.clientY + 60,
        }),
      );
    });
    await settle();
    const afterSecondMove = pathCache(uplot, 1);
    expect(afterSecondMove).not.toBe(afterFirstMove);

    await act(async () => {
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: start.clientX,
          clientY: start.clientY + 60,
        }),
      );
    });
    expect(
      useChannelDisplayStore.getState().keyConfigs.A?.offset,
    ).toBeDefined();

    await settle();
    const committed = pixels(uplot);
    uplot.redraw();
    expect(pixels(uplot)).toBe(committed);

    // Plain drag on the ground marker strip itself behaves the same.
    const strip = document.querySelector(
      "[data-testid='ground-marker-A']",
    ) as HTMLElement;
    expect(strip).not.toBeNull();
    const stripRect = strip.getBoundingClientRect();
    const sx = Math.round(stripRect.left + stripRect.width / 2);
    const sy = Math.round(stripRect.top + stripRect.height / 2);
    const pathsBeforeMarker = pathCache(uplot, 1);
    await act(async () => {
      strip.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: sx,
          clientY: sy,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          buttons: 1,
          clientX: sx,
          clientY: sy - 25,
        }),
      );
    });
    await settle();
    expect(pathCache(uplot, 1)).not.toBe(pathsBeforeMarker);
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: sx,
          clientY: sy - 25,
        }),
      );
    });
  });

  it("AC4: double-click on the marker (and Enter on the focused strip) resets the offset and renews the paths", async () => {
    const uplot = await mountFullUi();
    act(() => {
      useChannelDisplayStore.getState().setOffset("A", 3.5);
    });
    await settle();
    expect(useChannelDisplayStore.getState().keyConfigs.A?.offset).toBe(3.5);
    const pathsOffset = pathCache(uplot, 1);

    const strip = document.querySelector(
      "[data-testid='ground-marker-A']",
    ) as HTMLElement;
    const pathsBeforeReset = pathCache(uplot, 1);
    await act(async () => {
      strip.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });
    // A reset offset is trimmed from the store (effective 0).
    expect(useChannelDisplayStore.getState().keyConfigs.A?.offset ?? 0).toBe(0);
    expect(pathCache(uplot, 1)).not.toBe(pathsBeforeReset);
    expect(pathCache(uplot, 1)).not.toBe(pathsOffset);

    await settle();
    const committed = pixels(uplot);
    uplot.redraw();
    expect(pixels(uplot)).toBe(committed);

    // Enter on the focused strip resets again after a fresh offset.
    act(() => {
      useChannelDisplayStore.getState().setOffset("A", -2);
    });
    await settle();
    const pathsBeforeEnter = pathCache(uplot, 1);
    await act(async () => {
      strip.focus();
      strip.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(useChannelDisplayStore.getState().keyConfigs.A?.offset ?? 0).toBe(0);
    expect(pathCache(uplot, 1)).not.toBe(pathsBeforeEnter);

    await settle();
    const committedEnter = pixels(uplot);
    uplot.redraw();
    expect(pixels(uplot)).toBe(committedEnter);
  });

  it("AC6: reference transforms and time-slip drags renew the reference series' paths synchronously", async () => {
    await useReferenceStore
      .getState()
      .parseReferenceBuffer(await fixture(twoChMinUrlQ), "file2.fvf");
    const uplot = await mountFullUi();

    const capture = useCaptureStore.getState().capture!;
    // Series layout: [time, ...primary (4), ...reference (2)]; the 2ch
    // File 2 fixture's first reference channel is Ref-A.
    const refAIndex = 1 + capture.channels.length;
    const refLane = (useReferenceStore.getState().lanes ?? [])[0]!;
    const laneMid = Math.floor(refLane.length / 2);
    let laneSample = laneMid;
    for (let s = laneMid; s < refLane.length; s += 1) {
      if (Number.isFinite(refLane[s] ?? Number.NaN)) {
        laneSample = s;
        break;
      }
    }
    const laneBefore = uplot.data[refAIndex]![laneSample]!;
    expect(Number.isFinite(laneBefore)).toBe(true);

    // Reference display transform (offset) renews the ref series only.
    const primaryBefore = pathCache(uplot, 1);
    const refBefore = pathCache(uplot, refAIndex);
    await withFrozenSetSize(uplot, async () => {
      act(() => {
        useChannelDisplayStore.getState().setOffset("Ref-A", 2);
      });
      await settle();
    });
    expect(pathCache(uplot, refAIndex)).not.toBe(refBefore);
    expect(uplot.data[refAIndex]![laneSample]!).toBeCloseTo(laneBefore + 2, 4);
    expect(pathCache(uplot, 1)).toBe(primaryBefore);

    await settle();
    const committed = pixels(uplot);
    uplot.redraw();
    expect(pixels(uplot)).toBe(committed);

    // Time-slip drag: each drag frame renews the ref series paths.
    const strip = document.querySelector(
      "[data-testid='t2-trigger-handle']",
    ) as HTMLElement;
    expect(strip.style.display).toBe("block");
    const ts = capture.timestamps;
    const dt = (ts[ts.length - 1]! - ts[0]!) / (ts.length - 1);
    await act(async () => {
      uplot.setScale("x", { min: -50 * dt, max: 50 * dt });
    });
    const stripRect = strip.getBoundingClientRect();
    const startX = Math.round(stripRect.left + 15);
    const startY = Math.round(stripRect.top + 8);

    const pathsBeforeSlip = pathCache(uplot, refAIndex);
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
          clientX: startX + 60,
          clientY: startY,
        }),
      );
    });
    await settle();
    expect(useReferenceStore.getState().timeSlipSamples).not.toBe(0);
    expect(pathCache(uplot, refAIndex)).not.toBe(pathsBeforeSlip);

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

    await settle();
    const committedSlip = pixels(uplot);
    uplot.redraw();
    expect(pixels(uplot)).toBe(committedSlip);
  });
});
