import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type uPlot from "uplot";
import fourChUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import Oscilloscope from "./Oscilloscope";
import WaveformToolbar from "../toolbar/WaveformToolbar";
import { useCaptureStore } from "../../state/captureStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import { useCursorStore } from "../../state/cursorStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useThemeStore } from "../../state/themeStore";
import { useViewportStore } from "../../state/viewportStore";
import { useBadgePopoverStore } from "../toolbar/badgeConfig/anchoredPopover";

/**
 * Issue #238 regression coverage: the popover's Y-scale / offset fields
 * apply to the CANVAS the moment a value commits (Enter/Tab/blur for
 * typed input, per click for the steppers, live for the drag-scrub) —
 * with no per-keystroke application and no dependence on an unrelated
 * later action (the reported defect: the waveform only updated after
 * e.g. an opacity change). Lane data is asserted in-act; pixel hashes
 * settle one frame (React act distorts in-callback frame timing, so
 * the paint is asserted after a frame settle — never after another
 * user action).
 */

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching ${url}`).toBeTruthy();
  return response.arrayBuffer();
}

function setReactInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Popover display transforms apply to the canvas (issue #238)", () => {
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
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(mounted).not.toBeNull();
    return mounted!;
  };

  /** One-frame settle: the committed repaint lands without any user action. */
  const settleFrame = async (): Promise<void> => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
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
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
    useChannelNamesStore.setState({ fileKey: null, names: {} });
    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(fourChUrl), "four.fvf");
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

  it("typed Y-scale + Enter repaints the canvas immediately (no unrelated action needed)", async () => {
    const uplot = await mountFullUi();
    const popover = await openPopover("channel-gear-A");
    const input = popover.querySelector(
      "[data-testid='scale-scrub-input']",
    ) as HTMLInputElement;

    const dataBefore = Float32Array.from(uplot.data[1]!);
    const pixelsBefore = uplot.ctx.canvas.toDataURL();

    // Draft 200% — typing alone must not touch store, lanes, or paint.
    await act(async () => {
      input.focus();
      input.select();
      setReactInputValue(input, "200");
    });
    expect(
      useChannelDisplayStore.getState().keyConfigs.A?.yScalePercent,
    ).toBeUndefined();
    expect(uplot.data[1]![500]).toBe(dataBefore[500]);
    expect(uplot.ctx.canvas.toDataURL()).toBe(pixelsBefore);

    // Enter commits: the lane data swaps in the act flush and the
    // canvas repaints on the very next frame — no other action needed.
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(useChannelDisplayStore.getState().keyConfigs.A?.yScalePercent).toBe(
      200,
    );
    expect(uplot.data[1]![500]).toBeCloseTo(dataBefore[500]! * 2, 4);
    await settleFrame();
    expect(uplot.ctx.canvas.toDataURL()).not.toBe(pixelsBefore);
  });

  it("steppers apply each click immediately (lane + pixels)", async () => {
    const uplot = await mountFullUi();
    const popover = await openPopover("channel-gear-A");
    const pixelsBefore = uplot.ctx.canvas.toDataURL();
    const laneBefore = uplot.data[1]![500]!;

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
    expect(uplot.data[1]![500]).toBeCloseTo(laneBefore * 1.05, 4);
    await settleFrame();
    expect(uplot.ctx.canvas.toDataURL()).not.toBe(pixelsBefore);
  });

  it("drag-scrub applies live: each pointer move rewrites the lane (cheap affine pass, cached rail-clip)", async () => {
    const uplot = await mountFullUi();
    const popover = await openPopover("channel-gear-A");
    const zone = popover.querySelector(
      "[data-testid='scale-scrub-field'] .badge-opacity-scrub",
    ) as HTMLElement;

    const laneBefore = Float32Array.from(uplot.data[1]!);
    const startX = 300;
    const startY = Math.round(zone.getBoundingClientRect().top + 4);

    // Two scrub moves: +40 px at 8 px/percent = +5% each.
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

    // 100% + 5% + 10% = 115% applied live across the two scrubs.
    expect(useChannelDisplayStore.getState().keyConfigs.A?.yScalePercent).toBe(
      115,
    );
    const lane = uplot.data[1]!;
    for (let i = 0; i < lane.length; i += 97) {
      const before = laneBefore[i] ?? Number.NaN;
      const now = lane[i] ?? Number.NaN;
      if (Number.isFinite(before)) {
        expect(now).toBeCloseTo(before * 1.15, 3);
      }
    }
  });

  it("Tab and blur commits repaint the canvas too (canvas-level, not just store state)", async () => {
    const uplot = await mountFullUi();
    const popover = await openPopover("channel-gear-A");
    const input = popover.querySelector(
      "[data-testid='scale-scrub-input']",
    ) as HTMLInputElement;
    const dataBefore = Float32Array.from(uplot.data[1]!);
    const pixelsBefore = uplot.ctx.canvas.toDataURL();

    // Tab commit: lane + pixels (review F2 — the same pipeline as Enter,
    // asserted at canvas level).
    await act(async () => {
      input.focus();
      input.select();
      setReactInputValue(input, "180");
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    });
    expect(useChannelDisplayStore.getState().keyConfigs.A?.yScalePercent).toBe(
      180,
    );
    expect(uplot.data[1]![500]).toBeCloseTo(dataBefore[500]! * 1.8, 3);
    await settleFrame();
    const pixelsAfterTab = uplot.ctx.canvas.toDataURL();
    expect(pixelsAfterTab).not.toBe(pixelsBefore);
    const baselineForBlur = pixelsAfterTab;

    // Blur (focusout) commit after drafting a further change.
    await act(async () => {
      input.focus();
      input.select();
      setReactInputValue(input, "300");
    });
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(useChannelDisplayStore.getState().keyConfigs.A?.yScalePercent).toBe(
      300,
    );
    expect(uplot.data[1]![500]).toBeCloseTo(dataBefore[500]! * 3, 3);
    await settleFrame();
    expect(uplot.ctx.canvas.toDataURL()).not.toBe(baselineForBlur);
  });

  it("the offset field behaves the same: Enter commits and repaints immediately", async () => {
    const uplot = await mountFullUi();
    const popover = await openPopover("channel-gear-A");
    const input = popover.querySelector(
      "[data-testid='offset-scrub-input']",
    ) as HTMLInputElement;

    const dataBefore = Float32Array.from(uplot.data[1]!);
    const pixelsBefore = uplot.ctx.canvas.toDataURL();

    await act(async () => {
      input.focus();
      input.select();
      setReactInputValue(input, "3");
    });
    expect(uplot.data[1]![500]).toBe(dataBefore[500]);

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(useChannelDisplayStore.getState().keyConfigs.A?.offset).toBe(3);
    expect(uplot.data[1]![500]).toBeCloseTo(dataBefore[500]! + 3, 4);
    await settleFrame();
    expect(uplot.ctx.canvas.toDataURL()).not.toBe(pixelsBefore);
  });
});
