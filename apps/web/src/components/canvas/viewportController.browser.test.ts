/**
 * Direct interface-level tests for pure TypeScript `ViewportController`
 * (issue #356 AC4): exercises real uPlot lifecycle transitions against a bare
 * DOM host element with zero React mounting — Stack <-> Overlay toggle,
 * compare add/remove view preservation, first-paint gating, and display
 * transforms.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ViewportController, areAxesReady } from "./viewportController";
import type { ParsedCapture } from "../../types/capture";
import { useViewportStore } from "../../state/viewportStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import { useLaneLayoutStore } from "../../state/laneLayoutStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useThemeStore } from "../../state/themeStore";
import { useZoomHistoryStore } from "../../state/zoomHistoryStore";

function makeCapture(channelNames: string[], amplitude = 10): ParsedCapture {
  const n = 200;
  const timestamps = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    timestamps[i] = (i - n / 2) * 1e-4;
  }
  return {
    timestamps,
    channels: channelNames.map((name, chIdx) => {
      const data = new Float32Array(n);
      for (let i = 0; i < n; i += 1) {
        data[i] = Math.sin((i / n) * Math.PI * 4 + chIdx) * amplitude;
      }
      return {
        name,
        label: `Input ${name}`,
        data,
        derived: false,
      };
    }),
    derivedChannels: [],
    warnings: [],
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "2 ms/Div",
      secondsPerDiv: 2e-3,
      timestamp14: "12000020260101",
      samples: n,
      deltaT: 1e-4,
      channels: channelNames.map((name) => ({
        name,
        label: `Input ${name}`,
        unit: "V",
        samples: n,
        deltaT: 1e-4,
        derived: false,
      })),
    },
  };
}

async function settle(ms = 60): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ViewportController (issue #356, pure TS without React)", () => {
  let host: HTMLDivElement;
  let controller: ViewportController;

  beforeEach(() => {
    window.localStorage.clear();
    useViewportStore.getState().reset();
    useReferenceStore.getState().clear();
    useChannelDisplayStore.getState().reset();
    useChannelNamesStore.setState({
      fileKey: null,
      refFileKey: null,
      names: {},
    });
    useLaneLayoutStore.getState().equalize();
    usePaletteStore.getState().resetPalette();
    useThemeStore.getState().setTheme("dark");
    useZoomHistoryStore.getState().reset();

    host = document.createElement("div");
    host.style.width = "800px";
    host.style.height = "400px";
    document.body.appendChild(host);
    controller = new ViewportController(host);
  });

  afterEach(() => {
    controller.destroy();
    host.remove();
  });

  it("mounts uPlot, applies initial show->hide axis visibility, and handles Stack <-> Overlay toggle cleanly", async () => {
    const capture = makeCapture(["A", "B", "C"]);
    useViewportStore.getState().setActiveChannels(["A", "B"]);
    useViewportStore.getState().setSelectedChannel("A");

    controller.syncCapture(capture, null, { width: 800, height: 400 });
    const u = controller.getInstance();
    expect(u).not.toBeNull();
    // Initial visibility applied after show: true construction (issue #338)
    expect(u!.axes.find((a) => a.scale === "y0")?.show).toBe(true);
    expect(u!.axes.find((a) => a.scale === "y1")?.show).toBe(true);
    expect(u!.axes.find((a) => a.scale === "y2")?.show).toBe(false);

    await settle();
    expect(areAxesReady(u!)).toBe(true);

    const overlayY0Min = u!.scales.y0!.min!;
    const overlayY0Max = u!.scales.y0!.max!;

    // Transition to Stack mode: Y0 span expands to partition into 2 lanes
    useChannelDisplayStore.getState().setStackMode(true);
    controller.applyStackLayout(true, {});
    await settle();
    expect(u!.scales.y0!.max! - u!.scales.y0!.min!).toBeCloseTo(
      (overlayY0Max - overlayY0Min) * 2,
      1,
    );
    expect(controller.getPreStackMap().has("y0")).toBe(true);

    // Transition back to Overlay: restores saved pre-stack bounds and clears preStack
    useChannelDisplayStore.getState().setStackMode(false);
    controller.applyStackLayout(false, {});
    await settle();
    expect(u!.scales.y0!.min!).toBeCloseTo(overlayY0Min, 3);
    expect(u!.scales.y0!.max!).toBeCloseTo(overlayY0Max, 3);
    expect(controller.getPreStackMap().size).toBe(0);
  });

  it("preserves user X/Y zoom across compare add/remove remounts without wiping scales.x", async () => {
    const primary = makeCapture(["A", "B"]);
    const refCap = makeCapture(["A"], 5);
    const refLanes = [refCap.channels[0]!.data];

    useViewportStore.getState().setActiveChannels(["A", "B"]);
    controller.syncCapture(primary, null, { width: 800, height: 400 });
    await settle();

    // Zoom in on X and Y0
    const u1 = controller.getInstance()!;
    u1.setScale("x", { min: -0.004, max: 0.004 });
    u1.setScale("y0", { min: -5, max: 5 });
    await settle();

    // Add comparison capture -> remounts same primary capture with refLanes
    useReferenceStore.setState({
      capture: refCap,
      lanes: refLanes,
      refActiveChannels: ["Ref-A"],
    });
    controller.syncCapture(primary, refLanes, { width: 800, height: 400 });
    // Calling applyStackLayout before first paint must not wipe scales.x (issue #350)
    controller.applyStackLayout(false, {});
    await settle();

    const u2 = controller.getInstance()!;
    expect(u2).not.toBe(u1);
    expect(u2.scales.x?.min).toBeCloseTo(-0.004, 5);
    expect(u2.scales.x?.max).toBeCloseTo(0.004, 5);
    expect(u2.scales.y0?.min).toBeCloseTo(-5, 3);
    expect(u2.scales.y0?.max).toBeCloseTo(5, 3);
    expect(u2.series.length).toBe(4); // Time + A + B + Ref-A

    // Remove comparison capture -> remounts primary-only preserving zoomed bounds
    useReferenceStore.getState().clear();
    controller.syncCapture(primary, null, { width: 800, height: 400 });
    await settle();

    const u3 = controller.getInstance()!;
    expect(u3.scales.x?.min).toBeCloseTo(-0.004, 5);
    expect(u3.scales.x?.max).toBeCloseTo(0.004, 5);
    expect(u3.series.length).toBe(3); // Time + A + B
  });

  it("applies display transforms (scale, offset, invert) in place without remounting and updates custom names", async () => {
    const capture = makeCapture(["A", "B"], 10);
    useViewportStore.getState().setActiveChannels(["A", "B"]);

    controller.syncCapture(capture, null, { width: 800, height: 400 });
    await settle();
    const u = controller.getInstance()!;
    const rawSample = capture.channels[0]!.data[25]!;

    // Apply 200% scale, +3 offset, inverted on channel A
    const configs = {
      A: { yScalePercent: 200, offset: 3, inverted: true },
    };
    useChannelDisplayStore.setState({ keyConfigs: configs });
    controller.applyDisplayTransforms(configs);

    expect(controller.getInstance()).toBe(u); // in-place, no remount
    const transformed = u.data[1]![25]!;
    expect(transformed).toBeCloseTo(-rawSample * 2 + 3, 4);

    // Update custom channel name in place
    useChannelNamesStore.setState({ names: { A: "V_grid" } });
    controller.applyThemeOrNames("light", {}, { A: "V_grid" });
    expect(u.series[1]?.label).toBe("A: V_grid");
  });
});
