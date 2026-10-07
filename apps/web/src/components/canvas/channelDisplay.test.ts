import { describe, expect, it } from "vitest";
import {
  DEFAULT_OFFSET,
  DEFAULT_Y_SCALE_PERCENT,
  channelDisplayValue,
  displayKeyForChannel,
  effectiveInverted,
  effectiveOffset,
  effectivePerDiv,
  effectiveYScale,
  formatPerDiv,
  invertSign,
  normalizeOffset,
  normalizeYScalePercent,
  transformBounds,
  transformDisplayLane,
} from "./channelDisplay";

describe("channelDisplay pure transforms (issue #224)", () => {
  it("defaults keep the identity transform", () => {
    expect(effectiveYScale({}, "A")).toBe(100);
    expect(effectiveOffset({}, "A")).toBe(0);
    expect(effectiveInverted({}, "A")).toBe(false);
    expect(normalizeYScalePercent(100)).toBe(100);
    expect(normalizeOffset(0)).toBe(0);
  });

  it("clamps the Y-scale to the storable 10–500 range", () => {
    expect(normalizeYScalePercent(1)).toBe(10);
    expect(normalizeYScalePercent(999)).toBe(500);
    expect(normalizeYScalePercent(137.6)).toBe(138);
  });

  it("rounds offsets to milli-units and passes NaN through", () => {
    expect(normalizeOffset(1.23456)).toBe(1.235);
    expect(normalizeOffset(Number.NaN)).toBe(0);
    expect(channelDisplayValue(Number.NaN, 200, 5, true)).toBeNaN();
  });

  it("composes sign * physical * scale% + offset (issue #224 semantics)", () => {
    // 200% gain, +1 offset, not inverted: 2 V sample -> 5 display units.
    expect(channelDisplayValue(2, 200, 1, false)).toBe(5);
    // Inverted: sign flips the whole displayed trace.
    expect(channelDisplayValue(2, 100, 0, true)).toBe(-2);
    // Scale and offset are display-only; the readout sign is sign * physical.
    expect(invertSign({ A: { inverted: true } }, "Input A")).toBe(-1);
    expect(invertSign({ A: { inverted: true } }, "B")).toBe(1);
    // Cursor keys never take channel display transforms.
    expect(invertSign({ A: { inverted: true } }, "C1")).toBe(1);
  });

  it("resolves channel names to display keys (cursors never match)", () => {
    expect(displayKeyForChannel("Input A")).toBe("A");
    expect(displayKeyForChannel("B")).toBe("B");
    expect(displayKeyForChannel("C1")).toBeNull();
    expect(displayKeyForChannel("Math")).toBeNull();
  });

  it("transformDisplayLane is zero-copy at defaults and affine otherwise", () => {
    const lane = new Float32Array([1, 2, Number.NaN, -3]);
    const identity = transformDisplayLane(lane, 100, 0, false);
    expect(identity).toBe(lane); // default state keeps the exact buffer

    const scaled = transformDisplayLane(lane, 200, 1, false);
    expect([...scaled]).toEqual([3, 5, Number.NaN, -5]);
    const inverted = transformDisplayLane(lane, 100, 0, true);
    expect([...inverted]).toEqual([-1, -2, Number.NaN, 3]);
  });

  it("transformBounds maps fit bounds affinely with endpoint ordering", () => {
    expect(transformBounds({ min: -10, max: 10 }, 100, 0, false)).toEqual({
      min: -10,
      max: 10,
    });
    // 200% + offset 5: symmetric fit recenters around the offset.
    expect(transformBounds({ min: -10, max: 10 }, 200, 5, false)).toEqual({
      min: -15,
      max: 25,
    });
    // Invert swaps the endpoints (affine with negative slope).
    expect(transformBounds({ min: -10, max: 10 }, 100, 0, true)).toEqual({
      min: -10,
      max: 10,
    });
    expect(transformBounds({ min: 0, max: 10 }, 100, 0, true)).toEqual({
      min: -10,
      max: 0,
    });
  });

  it("derives ≈ unit/Div from viewport geometry ÷ scale", () => {
    // 400 px tall plot showing [-10, 10] at 100%: 2 V/div.
    expect(effectivePerDiv(-10, 10, 400, 100)).toBeCloseTo(2, 10);
    // At 200% the same geometry observes half the physical per-division.
    expect(effectivePerDiv(-10, 10, 400, 200)).toBeCloseTo(1, 10);
    // Degenerate geometry reads NaN.
    expect(effectivePerDiv(-10, 10, 0, 100)).toBeNaN();
    expect(effectivePerDiv(Number.NaN, 10, 400, 100)).toBeNaN();
  });

  it("formats the per-division readout through the canonical SI ladder", () => {
    expect(formatPerDiv(0.1, "A")).toBe("100 mA/Div");
    expect(formatPerDiv(2, "V")).toBe("2 V/Div");
    expect(formatPerDiv(Number.NaN, "V")).toBe("—");
  });

  it("effective accessors clamp hydrated outliers", () => {
    expect(effectiveYScale({ A: { yScalePercent: 9999 } }, "A")).toBe(500);
    expect(effectiveYScale({ A: { yScalePercent: 5 } }, "A")).toBe(10);
    expect(effectiveOffset({ A: { offset: Number.NaN } }, "A")).toBe(0);
    expect(DEFAULT_Y_SCALE_PERCENT).toBe(100);
    expect(DEFAULT_OFFSET).toBe(0);
  });
});
