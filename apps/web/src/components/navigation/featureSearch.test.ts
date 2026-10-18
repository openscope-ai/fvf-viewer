import { describe, expect, it } from "vitest";
import { findFeature } from "./featureSearch";

describe("featureSearch algorithms (Issue #288)", () => {
  it("finds next and previous saturated (NaN) samples", () => {
    const timestamps = [0, 1, 2, 3, 4, 5, 6, 7];
    const samples = [1.0, 2.0, NaN, 4.0, 5.0, NaN, 7.0, 8.0];

    // From index 0, find next saturation -> should find index 2
    const res1 = findFeature(timestamps, samples, 0, "next", "saturation");
    expect(res1).not.toBeNull();
    expect(res1?.index).toBe(2);
    expect(res1?.timestamp).toBe(2);

    // From index 2, find next saturation -> should find index 5
    const res2 = findFeature(timestamps, samples, 2, "next", "saturation");
    expect(res2?.index).toBe(5);

    // From index 5, find next saturation -> none left, should return null
    const res3 = findFeature(timestamps, samples, 5, "next", "saturation");
    expect(res3).toBeNull();

    // From index 6, find previous saturation -> should find index 5
    const res4 = findFeature(timestamps, samples, 6, "prev", "saturation");
    expect(res4?.index).toBe(5);

    // From index 4, find previous saturation -> should find index 2
    const res5 = findFeature(timestamps, samples, 4, "prev", "saturation");
    expect(res5?.index).toBe(2);

    // From index 1, find previous saturation -> none left, should return null
    const res6 = findFeature(timestamps, samples, 1, "prev", "saturation");
    expect(res6).toBeNull();
  });

  it("finds rising and falling edges across mid-threshold", () => {
    // A square-like pulse: 0, 0, 10, 10, 0, 0, 10, 10
    const timestamps = [0, 1, 2, 3, 4, 5, 6, 7];
    const samples = [0, 0, 10, 10, 0, 0, 10, 10];

    // From 0, find next rising edge -> index 2 (transition from 0 to 10)
    const rising1 = findFeature(timestamps, samples, 0, "next", "rising");
    expect(rising1?.index).toBe(2);

    // From 2, find next rising edge -> index 6
    const rising2 = findFeature(timestamps, samples, 2, "next", "rising");
    expect(rising2?.index).toBe(6);

    // From 6, find next rising edge -> none left
    const rising3 = findFeature(timestamps, samples, 6, "next", "rising");
    expect(rising3).toBeNull();

    // From 2, find next falling edge -> index 4 (transition from 10 to 0)
    const falling1 = findFeature(timestamps, samples, 2, "next", "falling");
    expect(falling1?.index).toBe(4);

    // From 6, find prev falling edge -> index 4
    const fallingPrev = findFeature(timestamps, samples, 6, "prev", "falling");
    expect(fallingPrev?.index).toBe(4);

    // Starting on rising edge at 6, find prev rising edge -> should find index 2
    const risingPrev = findFeature(timestamps, samples, 6, "prev", "rising");
    expect(risingPrev?.index).toBe(2);

    // Starting on rising edge at 2, find prev rising edge -> none left
    const risingPrevNull = findFeature(
      timestamps,
      samples,
      2,
      "prev",
      "rising",
    );
    expect(risingPrevNull).toBeNull();
  });

  it("works reliably on captures with saturated NaN samples without errors", () => {
    // Pulse with interleaved NaN samples
    const timestamps = [0, 1, 2, 3, 4, 5, 6, 7];
    const samples = [0, NaN, 10, 10, NaN, 0, 10, 10];

    // Next rising edge from 0 skips NaN and finds index 2
    const rising = findFeature(timestamps, samples, 0, "next", "rising");
    expect(rising?.index).toBe(2);

    // Next falling edge from 2 skips NaN at 4 and finds index 5
    const falling = findFeature(timestamps, samples, 2, "next", "falling");
    expect(falling?.index).toBe(5);
  });

  it("finds peaks and valleys (local extrema)", () => {
    // Wave with peaks at index 2 and index 6, valley at index 4
    const timestamps = [0, 1, 2, 3, 4, 5, 6, 7];
    const samples = [0, 5, 10, 5, 0, 5, 10, 5];

    const peak1 = findFeature(timestamps, samples, 0, "next", "peak");
    expect(peak1?.index).toBe(2);

    const peak2 = findFeature(timestamps, samples, 2, "next", "peak");
    expect(peak2?.index).toBe(6);

    const valley1 = findFeature(timestamps, samples, 2, "next", "valley");
    expect(valley1?.index).toBe(4);

    const valleyPrev = findFeature(timestamps, samples, 6, "prev", "valley");
    expect(valleyPrev?.index).toBe(4);
  });

  it("returns null for flat or empty signals", () => {
    expect(findFeature([], [], 0, "next", "rising")).toBeNull();
    expect(
      findFeature([0, 1, 2], [5.0, 5.0, 5.0], 0, "next", "rising"),
    ).toBeNull();
  });
});
