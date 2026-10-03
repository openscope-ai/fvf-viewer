import { describe, expect, it } from "vitest";
import { channelStatsLine, cursorPositionLine } from "./stats";
import type { WaveformChannel } from "../../../types/capture";

function channel(data: number[]): WaveformChannel {
  return {
    name: "A",
    label: "Input A",
    derived: false,
    data: new Float32Array(data),
  };
}

describe("badgeConfig stats lines (issue #204)", () => {
  it("formats sample counts with extents and the verbatim unit", () => {
    const data = [...Array(1000)].map((_, i) => Math.sin(i / 50) * 3);
    const line = channelStatsLine(channel(data), "V");
    expect(line).toBe("1,000 samples · \u22123.00 V \u2026 +3.00 V");
  });

  it("uses explicit + for positive extents and plain zero", () => {
    expect(channelStatsLine(channel([0, 5]), "V")).toBe(
      "2 samples · 0.00 V \u2026 +5.00 V",
    );
    expect(channelStatsLine(channel([-1.5, 2.25]), "mV")).toBe(
      "2 samples \u00b7 \u22121.50 mV \u2026 +2.25 mV",
    );
  });

  it("skips saturated NaN samples in the extent", () => {
    expect(channelStatsLine(channel([1, NaN, -2, 4]), "V")).toBe(
      "4 samples · \u22122.00 V \u2026 +4.00 V",
    );
  });

  it("omits the unit when the channel has none", () => {
    expect(channelStatsLine(channel([0, 1]))).toBe(
      "2 samples · 0.00 \u2026 +1.00",
    );
  });

  it("degrades gracefully for empty or missing channels", () => {
    expect(channelStatsLine(channel([]))).toBe("0 samples");
    expect(channelStatsLine(undefined)).toBe("0 samples");
  });

  it("formats cursor positions with SI timestamps, clamped to the axis", () => {
    const timestamps = new Float32Array(500);
    for (let i = 0; i < 500; i += 1) timestamps[i] = (i - 250) * 1e-5;
    expect(cursorPositionLine(125, timestamps)).toBe("Sample 125 · -1.250 ms");
    // Out-of-range indices clamp into [0, N-1]
    expect(cursorPositionLine(9999, timestamps)).toBe("Sample 499 · 2.490 ms");
    expect(cursorPositionLine(-5, timestamps)).toBe("Sample 0 · -2.500 ms");
  });

  it("degrades gracefully without timestamps", () => {
    expect(cursorPositionLine(42, undefined)).toBe("Sample 42");
    expect(cursorPositionLine(7, new Float32Array(0))).toBe("Sample 7");
  });
});
