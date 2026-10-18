import { describe, expect, it } from "vitest";
import {
  computeChannelStats,
  findVisibleIndexRange,
  formatChannelValue,
} from "./amplitudeStats";

describe("amplitudeStats calculation core (issue #278)", () => {
  describe("findVisibleIndexRange", () => {
    const timestamps = new Float32Array([0, 1e-6, 2e-6, 3e-6, 4e-6, 5e-6]);

    it("returns full range when xMin and xMax are null", () => {
      const range = findVisibleIndexRange(timestamps, null, null);
      expect(range).toEqual({ startIndex: 0, endIndex: 5 });
    });

    it("clamps to visible window [1e-6, 3e-6]", () => {
      const range = findVisibleIndexRange(timestamps, 1e-6, 3e-6);
      expect(range).toEqual({ startIndex: 1, endIndex: 3 });
    });

    it("handles partial bounds (only xMin or only xMax)", () => {
      expect(findVisibleIndexRange(timestamps, 2e-6, null)).toEqual({
        startIndex: 2,
        endIndex: 5,
      });
      expect(findVisibleIndexRange(timestamps, null, 2e-6)).toEqual({
        startIndex: 0,
        endIndex: 2,
      });
    });

    it("returns empty range when window is completely before or after data", () => {
      expect(findVisibleIndexRange(timestamps, -5e-6, -1e-6)).toEqual({
        startIndex: 0,
        endIndex: -1,
      });
      expect(findVisibleIndexRange(timestamps, 10e-6, 20e-6)).toEqual({
        startIndex: 6,
        endIndex: 5,
      });
    });

    it("handles empty timestamps array", () => {
      expect(findVisibleIndexRange(new Float32Array([]), 0, 1)).toEqual({
        startIndex: 0,
        endIndex: -1,
      });
    });
  });

  describe("computeChannelStats", () => {
    it("computes exact stats for a constant DC voltage", () => {
      const data = new Float32Array([5, 5, 5, 5, 5]);
      const stats = computeChannelStats(data, 0, 4);

      expect(stats.count).toBe(5);
      expect(stats.vmin).toBe(5);
      expect(stats.vmax).toBe(5);
      expect(stats.vpp).toBe(0);
      expect(stats.mean).toBe(5);
      expect(stats.rms).toBe(5);
    });

    it("computes stats for a known synthetic sine wave", () => {
      // 1000 points of a full sine cycle: 10 * sin(2*pi * i / 1000)
      const N = 1000;
      const data = new Float32Array(N);
      for (let i = 0; i < N; i += 1) {
        data[i] = 10 * Math.sin((2 * Math.PI * i) / N);
      }

      const stats = computeChannelStats(data, 0, N - 1);
      expect(stats.count).toBe(N);
      expect(stats.vmax).toBeCloseTo(10, 2);
      expect(stats.vmin).toBeCloseTo(-10, 2);
      expect(stats.vpp).toBeCloseTo(20, 2);
      expect(stats.mean).toBeCloseTo(0, 4);
      // Theoretical RMS of sine with amplitude A=10 is 10 / sqrt(2) ≈ 7.0710678
      expect(stats.rms).toBeCloseTo(7.071, 2);
    });

    it("never distorts statistics with saturated NaN samples", () => {
      // 4 valid samples with known stats: [2, NaN, 4, NaN, 6, NaN]
      const data = new Float32Array([2, NaN, 4, NaN, 6, NaN]);
      const stats = computeChannelStats(data, 0, data.length - 1);

      // Only finite samples [2, 4, 6] are counted
      expect(stats.count).toBe(3);
      expect(stats.vmin).toBe(2);
      expect(stats.vmax).toBe(6);
      expect(stats.vpp).toBe(4);
      expect(stats.mean).toBe(4);
      // RMS of [2, 4, 6] = sqrt((4 + 16 + 36) / 3) = sqrt(56 / 3) = sqrt(18.6667) ≈ 4.32049
      expect(stats.rms).toBeCloseTo(Math.sqrt(56 / 3), 4);
    });

    it("returns null metrics when all samples in window are NaN", () => {
      const data = new Float32Array([NaN, NaN, NaN]);
      const stats = computeChannelStats(data, 0, 2);

      expect(stats.count).toBe(0);
      expect(stats.vpp).toBeNull();
      expect(stats.vmax).toBeNull();
      expect(stats.vmin).toBeNull();
      expect(stats.mean).toBeNull();
      expect(stats.rms).toBeNull();
    });

    it("respects per-channel invert ± display transform", () => {
      const data = new Float32Array([1, 2, 5]);
      const normal = computeChannelStats(data, 0, 2, 100, 0, false);
      const inverted = computeChannelStats(data, 0, 2, 100, 0, true);

      expect(normal.vmax).toBe(5);
      expect(normal.vmin).toBe(1);
      expect(normal.vpp).toBe(4);
      expect(normal.mean).toBeCloseTo(8 / 3, 4);

      // Inverted: values are [-1, -2, -5]
      expect(inverted.vmax).toBe(-1);
      expect(inverted.vmin).toBe(-5);
      expect(inverted.vpp).toBe(4);
      expect(inverted.mean).toBeCloseTo(-8 / 3, 4);
      expect(inverted.rms).toBeCloseTo(normal.rms!, 4);
    });

    it("respects per-channel Y-scale % display gain", () => {
      const data = new Float32Array([1, 2, 3]);
      const scaled = computeChannelStats(data, 0, 2, 200, 0, false);

      // 200% scale multiplies all values by 2: [2, 4, 6]
      expect(scaled.vmin).toBe(2);
      expect(scaled.vmax).toBe(6);
      expect(scaled.vpp).toBe(4);
      expect(scaled.mean).toBe(4);
    });

    it("respects vertical offset display transform", () => {
      const data = new Float32Array([1, 2, 3]);
      const shifted = computeChannelStats(data, 0, 2, 100, 2.5, false);

      // Offset +2.5 shifts values to [3.5, 4.5, 5.5]
      expect(shifted.vmin).toBe(3.5);
      expect(shifted.vmax).toBe(5.5);
      expect(shifted.vpp).toBe(2); // Vpp is peak-to-peak difference, offset cancels
      expect(shifted.mean).toBe(4.5);
    });

    it("formats metrics accurately in channel's units with formatChannelValue", () => {
      expect(formatChannelValue(12.5, "V")).toBe("12.50 V");
      expect(formatChannelValue(0.005, "V")).toBe("5.000 mV");
      expect(formatChannelValue(0.000002, "A")).toBe("2.000 µA");
      expect(formatChannelValue(null as unknown as number, "V")).toBe("—");
      expect(formatChannelValue(NaN, "V")).toBe("—");
    });
  });
});
