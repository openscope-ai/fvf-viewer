/**
 * Pure resolver tests for the issue #150 hover tooltip: snap-point
 * resolution (nearest visible channel sample within the snap radius) and
 * tooltip line formatting (canonical SI x/y readout).
 */

import { describe, expect, it } from "vitest";
import {
  formatHoverTooltipLines,
  resolveHoverSample,
} from "./hoverTooltipPlugin";
import { yScaleKey } from "../../capture/channelUnits";
import type { ParsedCapture } from "../../types/capture";

function makeCapture(): ParsedCapture {
  return {
    metadata: {
      timestamp14: "20260101120000",
      channels: [
        {
          name: "A",
          label: "Input A",
          derived: false,
          samples: 6,
          deltaT: 1,
          unit: "V",
        },
      ],
    },
    timestamps: Float32Array.from([0, 1, 2, 3, 4, 5]),
    channels: [
      {
        name: "A",
        label: "Input A",
        unit: "V",
        perDivision: 1,
        windowMin: -5,
        windowMax: 5,
        saturatedCount: 0,
        data: Float32Array.from([0, 1, 2, 3, 4, 5]),
      },
    ],
  } as unknown as ParsedCapture;
}

interface FakeUPlot {
  posToVal: (px: number) => number;
  valToPos: (val: number) => number;
  series: Array<{ scale?: string | number; show?: boolean }>;
  data: Array<ArrayLike<number | null> | null>;
}

function makeUPlot(): FakeUPlot {
  // Linear identity mapping: x px == seconds 0..5, y0 px == volts 0..5.
  return {
    posToVal: (px: number) => px,
    valToPos: (val: number) => val,
    series: [{}, { scale: yScaleKey(0), show: true }],
    data: [
      [0, 1, 2, 3, 4, 5],
      [0, 1, 2, 3, 4, 5],
    ],
  };
}

describe("resolveHoverSample", () => {
  it("snaps to the exact channel sample under the pointer", () => {
    const hover = resolveHoverSample(
      makeUPlot(),
      makeCapture(),
      { x: 3, y: 3 },
      ["A"],
    );
    expect(hover).toEqual({ channelIndex: 0, sampleIndex: 3, x: 3, y: 3 });
  });

  it("resolves the nearest sample within the window when hovering between samples", () => {
    const hover = resolveHoverSample(
      makeUPlot(),
      makeCapture(),
      { x: 2.4, y: 2.6 },
      ["A"],
    );
    expect(hover?.sampleIndex).toBe(2);
  });

  it("returns null beyond the snap radius", () => {
    const capture = makeCapture();
    // Flat line at y=100 px; the pointer at y=51 is 49+ px from every dot,
    // beyond the snap radius.
    capture.channels[0]!.data = Float32Array.from([
      100, 100, 100, 100, 100, 100,
    ]);
    const u = makeUPlot();
    u.data[1] = Array.from(capture.channels[0]!.data);
    const hover = resolveHoverSample(u, capture, { x: 3, y: 51 }, ["A"]);
    expect(hover).toBeNull();
  });

  it("returns null when the channel is hidden", () => {
    const hover = resolveHoverSample(
      makeUPlot(),
      makeCapture(),
      { x: 3, y: 3 },
      [],
    );
    expect(hover).toBeNull();
  });

  it("skips saturated (non-finite) samples", () => {
    const capture = makeCapture();
    capture.channels[0]!.data = Float32Array.from([0, 1, Number.NaN, 3, 4, 5]);
    const u = makeUPlot();
    u.data[1] = Array.from(capture.channels[0]!.data);
    const hover = resolveHoverSample(u, capture, { x: 2, y: 2 }, ["A"]);
    // Sample 2 is NaN: nearest finite sample is 1 or 3, both 1px away; the
    // scan resolves the first minimum (sample 1 at distance hypot(1,1)).
    expect(hover).not.toBeNull();
    expect([1, 3]).toContain(hover!.sampleIndex);
  });
});

describe("formatHoverTooltipLines", () => {
  it("formats x in SI time and y in the channel's canonical unit", () => {
    const capture = makeCapture();
    const lines = formatHoverTooltipLines(capture, {
      channelIndex: 0,
      sampleIndex: 4,
      x: 4,
      y: 4,
    });
    expect(lines.name).toBe("A");
    expect(lines.x).toBe("4.000 s");
    expect(lines.y).toBe("4.000 V");
  });

  it("reads Overload-NaN samples as an em dash", () => {
    const capture = makeCapture();
    capture.channels[0]!.data = Float32Array.from([0, Number.NaN, 2, 3, 4, 5]);
    const lines = formatHoverTooltipLines(capture, {
      channelIndex: 0,
      sampleIndex: 1,
      x: 1,
      y: 1,
    });
    expect(lines.y).toBe("—");
  });
});
