/**
 * Issue #150 integration: dwelling 500 ms on the same waveform snap dot
 * shows the minimalist hover tooltip with the sample's x (time) and y
 * (channel value) coordinates in the channel's canonical SI unit; moving
 * to a different sample or leaving the canvas resets the dwell and hides
 * the tooltip.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import uPlot from "uplot";
import fourChUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import Oscilloscope from "./Oscilloscope";
import { yScaleKey } from "../../capture/channelUnits";
import { formatTime } from "../cursors/siFormat";
import { HOVER_DWELL_MS } from "./hoverTooltipPlugin";
import { useCaptureStore } from "../../state/captureStore";
import { useViewportStore } from "../../state/viewportStore";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import type { ParsedCapture } from "../../types/capture";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching fixture ${url}`).toBeTruthy();
  return response.arrayBuffer();
}

function dispatchMouse(
  target: HTMLElement,
  type: "mousemove" | "mouseleave" | "mousedown",
  clientX = 0,
  clientY = 0,
): void {
  target.dispatchEvent(
    new MouseEvent(type, {
      clientX,
      clientY,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("Hover tooltip (issue #150, browser)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;
  let capture: ParsedCapture;
  let mountedUplot: uPlot | null;

  beforeEach(async () => {
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
    useChannelNamesStore.setState({ fileKey: null, names: {} });
    window.localStorage.clear();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();

    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(fourChUrl), "hover.fvf");
    capture = useCaptureStore.getState().capture!;
    mountedUplot = null;

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
    useChannelNamesStore.setState({ fileKey: null, names: {} });
    window.localStorage.clear();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
  });

  async function mount(): Promise<void> {
    await act(async () => {
      root.render(
        <Oscilloscope
          capture={capture}
          onUPlotInit={(u) => {
            mountedUplot = u;
          }}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(mountedUplot).not.toBeNull();
  }

  /** Plot-area pointer position of a rendered channel sample (its snap dot). */
  function dotPosition(sampleIndex: number): { x: number; y: number } {
    const u = mountedUplot!;
    const lane = u.data[1]!;
    const scale = (u.series[1]!.scale as string) || yScaleKey(0);
    return {
      x: u.valToPos(capture.timestamps[sampleIndex]!, "x"),
      y: u.valToPos(lane[sampleIndex] as number, scale),
    };
  }

  function clientPoint(pos: { x: number; y: number }): {
    cx: number;
    cy: number;
  } {
    const rect = mountedUplot!.over.getBoundingClientRect();
    return { cx: rect.left + pos.x, cy: rect.top + pos.y };
  }

  /** Integer-rounded pointer position of a snap dot (MouseEvent fidelity). */
  function roundedClientPoint(sampleIndex: number): { cx: number; cy: number } {
    const pos = dotPosition(sampleIndex);
    return clientPoint({ x: Math.round(pos.x), y: Math.round(pos.y) });
  }

  function tooltip(): HTMLElement | null {
    return mountedUplot!.over.querySelector<HTMLElement>(
      "[data-testid='hover-tooltip']",
    );
  }

  /**
   * First sample around `center` with a finite channel-A value whose snap
   * dot stays clearly closest to the (integer-rounded) pointer even with
   * the other three channels' traces nearby — MouseEvent clientX/Y are
   * integers, so near-overlapping traces would legitimately steal the
   * nearest-dot resolution at an exact-dot position.
   */
  function isolatedSample(center: number): number {
    const u = mountedUplot!;
    const laneA = u.data[1]!;
    const scaleA = u.series[1]!.scale as string;
    const dotA = (i: number) => ({
      x: u.valToPos(capture.timestamps[i]!, "x"),
      y: u.valToPos(laneA[i] as number, scaleA),
    });
    for (let i = center; i < capture.timestamps.length - 8; i += 1) {
      if (!Number.isFinite(laneA[i] as number)) continue;
      const dot = dotA(i);
      const px = { x: Math.round(dot.x), y: Math.round(dot.y) };
      const dA = Math.hypot(dot.x - px.x, dot.y - px.y);
      let isolated = true;
      for (let c = 1; c < capture.channels.length && isolated; c += 1) {
        const lane = u.data[c + 1]!;
        const scale = u.series[c + 1]!.scale as string;
        for (let j = Math.max(0, i - 8); j <= i + 8; j += 1) {
          const v = lane[j];
          if (!Number.isFinite(v as number)) continue;
          const d = Math.hypot(
            u.valToPos(capture.timestamps[j]!, "x") - px.x,
            u.valToPos(v as number, scale) - px.y,
          );
          if (d < dA + 3) {
            isolated = false;
            break;
          }
        }
      }
      if (isolated) return i;
    }
    throw new Error("no isolated sample found");
  }

  it("AC1/AC2: shows x/y coordinates after 500ms dwell on the same snap point", async () => {
    await mount();
    const sample = isolatedSample(2000);
    const pos = dotPosition(sample);
    const { cx, cy } = clientPoint(pos);

    // Not visible before the dwell elapses.
    dispatchMouse(mountedUplot!.over, "mousemove", cx, cy);
    await act(async () => {
      await new Promise((r) => setTimeout(r, HOVER_DWELL_MS - 250));
    });
    expect(tooltip()?.style.display ?? "none").toBe("none");

    // Visible after the dwell, with SI-formatted x and y.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    const tip = tooltip();
    expect(tip).not.toBeNull();
    expect(tip!.style.display).toBe("block");
    const coords = tip!.querySelector(".hover-tooltip-coords")!.textContent!;
    expect(coords).toContain("x ");
    expect(coords).toContain(" y ");
    expect(coords).toContain(formatTime(capture.timestamps[sample]!));
  });

  it("moving to a different sample resets the dwell timer and updates the readout", async () => {
    await mount();
    const first = isolatedSample(2000);
    const second = isolatedSample(6000);

    const p1 = roundedClientPoint(first);
    dispatchMouse(mountedUplot!.over, "mousemove", p1.cx, p1.cy);
    await act(async () => {
      await new Promise((r) => setTimeout(r, HOVER_DWELL_MS + 250));
    });
    expect(tooltip()?.style.display).toBe("block");

    // New snap point: tooltip hides immediately and reappears only after a
    // fresh 500ms dwell with the new sample's time.
    const p2 = roundedClientPoint(second);
    dispatchMouse(mountedUplot!.over, "mousemove", p2.cx, p2.cy);
    expect(tooltip()?.style.display).toBe("none");
    await act(async () => {
      await new Promise((r) => setTimeout(r, HOVER_DWELL_MS - 200));
    });
    expect(tooltip()?.style.display).toBe("none");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    const coords = tooltip()!.querySelector(
      ".hover-tooltip-coords",
    )!.textContent!;
    expect(coords).toContain(formatTime(capture.timestamps[second]!));
  });

  it("leaving the canvas hides the tooltip and resets the dwell", async () => {
    await mount();
    const sample = isolatedSample(2000);
    const p = roundedClientPoint(sample);
    dispatchMouse(mountedUplot!.over, "mousemove", p.cx, p.cy);
    await act(async () => {
      await new Promise((r) => setTimeout(r, HOVER_DWELL_MS + 250));
    });
    expect(tooltip()?.style.display).toBe("block");

    dispatchMouse(mountedUplot!.over, "mouseleave");
    expect(tooltip()?.style.display).toBe("none");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(tooltip()?.style.display).toBe("none");
  });

  it("mousedown (drag interactions) hides the tooltip", async () => {
    await mount();
    const sample = isolatedSample(2000);
    const p = roundedClientPoint(sample);
    dispatchMouse(mountedUplot!.over, "mousemove", p.cx, p.cy);
    await act(async () => {
      await new Promise((r) => setTimeout(r, HOVER_DWELL_MS + 250));
    });
    expect(tooltip()?.style.display).toBe("block");

    dispatchMouse(mountedUplot!.over, "mousedown", p.cx, p.cy);
    expect(tooltip()?.style.display).toBe("none");
  });
});
