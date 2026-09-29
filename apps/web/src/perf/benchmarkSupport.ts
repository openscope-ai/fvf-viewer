/**
 * Performance benchmark harness (issue #24): deterministic synthetic
 * captures, frame/p95 statistics, and the soft regression baseline used by
 * the CI-tracked benchmarks (the benchmark documentation records the
 * reference results and the methodology).
 *
 * The regression threshold is intentionally SOFT: a > 20 % regression over
 * the committed baseline emits a `::warning::` log line (surfaced as a
 * GitHub annotation where the runner prints it — see the benchmark
 * for exactly where each project's flags appear) but never fails the
 * suite. The HARD budgets live in the benchmark suites themselves: the
 * ADR 0001 parse budget (p95 < 50 ms), the per-event dispatch costs
 * (p95 < 16.6 ms), and the zoom-commit redraw (< 16.7 ms). Compositor
 * frame cadence is reported and soft-tracked only.
 */

import type uPlot from "uplot";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Oscilloscope from "../components/canvas/Oscilloscope";
import { useCaptureStore } from "../state/captureStore";
import { useViewportStore } from "../state/viewportStore";
import { useChannelNamesStore } from "../state/channelNamesStore";
import { useThemeStore } from "../state/themeStore";
import { usePaletteStore } from "../state/paletteStore";
import type { ParsedCapture } from "../types/capture";
import { percentile } from "./perfStats";

/**
 * Deterministic multi-channel capture (no Math.random): sinusoid mixes per
 * channel, matching the synthetic-capture shape used by the Oscilloscope
 * browser tests. Used for interaction benchmarks at sizes the committed
 * corpus does not ship (e.g. 4ch x 40,000 points).
 */
export function makeBenchmarkCapture(
  samples: number,
  channelCount: number,
): ParsedCapture {
  const timestamps = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    timestamps[i] = i * 1e-5;
  }
  const names = ["A", "B", "C", "D"].slice(0, channelCount);
  const channels = names.map((name, channelIdx) => {
    const data = new Float32Array(samples);
    for (let i = 0; i < samples; i += 1) {
      data[i] =
        Math.sin((i / samples) * 2 * Math.PI * (channelIdx + 1) * 13) *
          (channelIdx + 1) +
        0.25 * Math.sin((i / samples) * 2 * Math.PI * (channelIdx + 2) * 57);
    }
    return { name, label: `Channel ${name}`, derived: false, data };
  });
  return {
    timestamps,
    channels,
    derivedChannels: [],
    warnings: [],
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "10 ms/Div",
      secondsPerDiv: 0.01,
      timestamp14: "",
      samples,
      deltaT: 1e-5,
      channels: channels.map((channel) => ({
        name: channel.name,
        label: channel.label,
        derived: false,
        samples,
        deltaT: 1e-5,
      })),
    },
  };
}

export interface FrameBudget {
  /** p95 of requestAnimationFrame inter-frame deltas during the gesture (ms). */
  p95FrameDeltaMs: number;
  /** Worst observed inter-frame delta (ms). */
  maxFrameDeltaMs: number;
  /** Frames exceeding 1.5x the 60 Hz frame interval (25 ms) — must be zero. */
  blownFrames: number;
  sampledFrames: number;
}

/**
 * Collects rAF inter-frame deltas across a gesture that spans real frames:
 * `step` is invoked once per animation frame (frameIndex 0..totalFrames-1)
 * and dispatches that frame's pointer work synchronously. Every rAF
 * callback records the delta since the previous frame, so the sample
 * reflects the compositor cadence the user sees: an idle vsync-locked
 * browser produces ~16.7 ms deltas, and main-thread work spilling past the
 * frame budget shows up as > 25 ms deltas (blown frames).
 */
export async function measureFrameBudget(
  step: (frameIndex: number) => void,
  totalFrames: number,
): Promise<FrameBudget> {
  const deltas: number[] = [];
  let last: number | null = null;
  let frameIndex = 0;

  await act(async () => {
    await new Promise<void>((resolve) => {
      const loop = (now: number): void => {
        if (last !== null) {
          deltas.push(now - last);
        }
        last = now;
        if (frameIndex >= totalFrames) {
          resolve();
          return;
        }
        step(frameIndex);
        frameIndex += 1;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
  });

  return {
    p95FrameDeltaMs: percentile(deltas, 0.95),
    maxFrameDeltaMs: deltas.length > 0 ? Math.max(...deltas) : Number.NaN,
    blownFrames: deltas.filter((delta) => delta > 25).length,
    sampledFrames: deltas.length,
  };
}

/** Dispatches a mouse event on an element (same shape as the AC tests). */
export function dispatchMouse(
  target: Element,
  type: "mousedown" | "mousemove" | "mouseup",
  clientX: number,
  clientY: number,
  buttons: number,
  modifierCtrl = false,
): void {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      buttons,
      ctrlKey: modifierCtrl,
      clientX,
      clientY,
    }),
  );
}

/**
 * Samples idle compositor cadence (same loop, no work) so frame-budget
 * assertions can self-calibrate: headless environments periodically skip
 * vsync even when idle, so a gesture is judged against the same run's
 * idle p95/blown-frame profile rather than an absolute 16.7 ms.
 */
export async function sampleIdleCadence(
  totalFrames: number,
): Promise<FrameBudget> {
  return measureFrameBudget(() => undefined, totalFrames);
}

export interface BenchmarkMount {
  uplot: uPlot;
  unmount: () => void;
}

/** Mounts an Oscilloscope at a fixed 800x600 host for a capture. */
export async function mountOscilloscope(
  capture: ParsedCapture,
): Promise<BenchmarkMount> {
  let mountedUplot: uPlot | null = null;
  const hostElement = document.createElement("div");
  hostElement.style.width = "800px";
  hostElement.style.height = "600px";
  document.body.appendChild(hostElement);
  const root: Root = createRoot(hostElement);

  await act(async () => {
    root.render(
      React.createElement(Oscilloscope, {
        capture,
        onUPlotInit: (u: uPlot) => {
          mountedUplot = u;
        },
      }),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  if (!mountedUplot) {
    root.unmount();
    hostElement.remove();
    throw new Error("uPlot did not initialize");
  }
  const uplot = mountedUplot;

  return {
    uplot,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      hostElement.remove();
    },
  };
}

/** Resets all persistent stores between benchmarks (mirrors the AC tests). */
export function resetStores(): void {
  useCaptureStore.getState().reset();
  useViewportStore.getState().reset();
  useChannelNamesStore.setState({ fileKey: null, names: {} });
  useThemeStore.getState().setTheme("dark");
  usePaletteStore.getState().resetPalette();
  window.localStorage.clear();
}

export { checkSoftRegression, logResult, percentile } from "./perfStats";
