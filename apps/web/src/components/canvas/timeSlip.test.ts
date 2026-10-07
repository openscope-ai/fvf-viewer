import { describe, expect, it } from "vitest";
import {
  alignSlipDelta,
  gridTimeAtIndex,
  slippedRefDisplayLane,
  slippedTriggerTime,
  slipSeconds,
  triggerAnchorIndex,
} from "./timeSlip";

/**
 * Issue #97 time-slip math: index-space lane shifting with linear
 * interpolation (NaN outside the record / through gaps), grid-time
 * interpolation for the T2 glyph anchor, and the exact integer
 * Align-at-Cursors delta.
 */

const lane = (values: number[]): Float32Array => Float32Array.from(values);

describe("slippedRefDisplayLane (issue #97)", () => {
  it("zero slip with default transforms returns the lane itself (zero-copy)", () => {
    const base = lane([1, 2, 3, 4]);
    expect(slippedRefDisplayLane(base, 0, 100, 0, false)).toBe(base);
  });

  it("integer positive slip shifts the lane right and NaN-fills the head", () => {
    const base = lane([10, 20, 30, 40, 50]);
    const out = slippedRefDisplayLane(base, 2, 100, 0, false);
    expect(Number.isNaN(out[0])).toBe(true);
    expect(Number.isNaN(out[1])).toBe(true);
    expect(out[2]).toBe(10);
    expect(out[3]).toBe(20);
    expect(out[4]).toBe(30);
  });

  it("negative slip shifts left and NaN-fills the tail", () => {
    const base = lane([10, 20, 30, 40, 50]);
    const out = slippedRefDisplayLane(base, -1, 100, 0, false);
    expect(out[0]).toBe(20);
    expect(out[3]).toBe(50);
    expect(Number.isNaN(out[4])).toBe(true);
  });

  it("fractional slip linearly interpolates between neighbours", () => {
    const base = lane([0, 10, 20, 30]);
    const out = slippedRefDisplayLane(base, 0.5, 100, 0, false);
    // out[i] = base[i - 0.5]; the head falls outside the record.
    expect(Number.isNaN(out[0])).toBe(true);
    expect(out[1]).toBe(5);
    expect(out[2]).toBe(15);
    expect(out[3]).toBe(25);
  });

  it("NaN gaps propagate instead of interpolating across them", () => {
    const base = lane([1, Number.NaN, 3, 4]);
    const out = slippedRefDisplayLane(base, 1, 100, 0, false);
    // out[2] samples base[1] (NaN) -> NaN; out[3] samples base[2] = 3.
    expect(Number.isNaN(out[2])).toBe(true);
    expect(out[3]).toBe(3);
  });

  it("fuses the slip with the #224 display transform in one pass", () => {
    const base = lane([10, 20, 30, 40, 50, 60]);
    // slip 1, scale 200%, offset 5, inverted: sign*slipped*2 + 5
    const out = slippedRefDisplayLane(base, 1, 200, 5, true);
    // out[2] samples base[1] = 20, out[3] samples base[2] = 30.
    expect(out[2]).toBe(-20 * 2 + 5);
    expect(out[3]).toBe(-30 * 2 + 5);
  });

  it("writes into the provided reusable buffer", () => {
    const base = lane([1, 2, 3]);
    const scratch = new Float32Array(3);
    const out = slippedRefDisplayLane(base, 1, 100, 0, false, scratch);
    expect(out).toBe(scratch);
    expect(out[1]).toBe(1);
  });
});

describe("grid time interpolation (issue #97)", () => {
  const ts = Float32Array.from([0, 1, 2, 3, 4]);

  it("interpolates fractionally and clamps at the record ends", () => {
    expect(gridTimeAtIndex(ts, 1.5)).toBe(1.5);
    expect(gridTimeAtIndex(ts, -3)).toBe(0);
    expect(gridTimeAtIndex(ts, 99)).toBe(4);
  });

  it("resolves the t=0 anchor and shifts it by the slip", () => {
    expect(triggerAnchorIndex(ts)).toBe(0);
    expect(slippedTriggerTime(ts, 2)).toBe(2);
    expect(slippedTriggerTime(ts, 1.5)).toBe(1.5);

    const offCenter = Float32Array.from([-2, -1, 0, 1, 2]);
    expect(triggerAnchorIndex(offCenter)).toBe(2);
    expect(slippedTriggerTime(offCenter, 1)).toBe(1);
  });

  it("derives the slip duration from the grid, extrapolating outside", () => {
    expect(slipSeconds(ts, 2)).toBe(2);
    expect(slipSeconds(ts, -1.5)).toBe(-1.5);
    expect(slipSeconds(ts, 0)).toBe(0);
    const anchorMid = Float32Array.from([-2, -1, 0, 1, 2]);
    expect(slipSeconds(anchorMid, 3)).toBe(3);
    expect(slipSeconds(anchorMid, -4)).toBe(-4);
  });
});

describe("alignSlipDelta (issue #97 AC2)", () => {
  it("is the exact integer index difference t_C1 - t_C2", () => {
    expect(alignSlipDelta(100, 40)).toBe(60);
    expect(alignSlipDelta(40, 100)).toBe(-60);
    expect(alignSlipDelta(7, 7)).toBe(0);
  });
});
