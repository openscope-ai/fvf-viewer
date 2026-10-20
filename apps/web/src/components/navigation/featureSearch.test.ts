import { describe, expect, it } from "vitest";
import {
  clearFeatureSearchCache,
  findFeature,
  getChannelBounds,
  getLookahead,
} from "./featureSearch";

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

  it("selects the trailing edge of plateaus for peaks and valleys (issue #314)", () => {
    // Peak plateau: flat top at 10 across indices 2, 3, 4
    const ts1 = [0, 1, 2, 3, 4, 5, 6];
    const peakPlateau = [0, 5, 10, 10, 10, 5, 0];
    const peakRes = findFeature(ts1, peakPlateau, 0, "next", "peak");
    expect(peakRes?.index).toBe(4); // trailing edge of flat top
    expect(peakRes?.value).toBe(10);

    // Valley plateau: flat bottom at 0 across indices 2, 3, 4
    const valleyPlateau = [10, 5, 0, 0, 0, 5, 10];
    const valleyRes = findFeature(ts1, valleyPlateau, 0, "next", "valley");
    expect(valleyRes?.index).toBe(4); // trailing edge of flat bottom
    expect(valleyRes?.value).toBe(0);
  });

  it("handles NaN-run-adjacent extrema and plateaus with interleaved NaNs (issue #314)", () => {
    // Peak plateau with interleaved NaNs: [0, 5, 10, NaN, 10, 5, 0]
    const ts = [0, 1, 2, 3, 4, 5, 6];
    const nanPlateau = [0, 5, 10, NaN, 10, 5, 0];
    const peakRes = findFeature(ts, nanPlateau, 0, "next", "peak");
    expect(peakRes?.index).toBe(4);

    // Peak surrounded by multiple consecutive NaNs
    const ts2 = [0, 1, 2, 3, 4, 5, 6, 7];
    const nanSurrounded = [0, NaN, NaN, 10, NaN, NaN, NaN, 0];
    const peakIsolated = findFeature(ts2, nanSurrounded, 0, "next", "peak");
    expect(peakIsolated?.index).toBe(3);

    // Previous search across NaNs
    const prevPeak = findFeature(ts2, nanSurrounded, 7, "prev", "peak");
    expect(prevPeak?.index).toBe(3);
  });

  it("demonstrates deterministic O(N) scaling on a 250k-sample NaN-heavy array (issue #314)", () => {
    const N = 250_000;
    const timestamps = new Float32Array(N);
    const samples = new Float32Array(N);

    // 99.5% NaNs with sparse finite samples every 200 samples
    for (let i = 0; i < N; i++) {
      timestamps[i] = i * 1e-6;
      if (i === 10_000) {
        samples[i] = 10.0; // Prominent peak
      } else if (i % 200 === 0) {
        samples[i] = 1.0;
      } else {
        samples[i] = NaN;
      }
    }

    const t0 = performance.now();
    const result = findFeature(timestamps, samples, 0, "next", "peak");
    const elapsedMs = performance.now() - t0;

    expect(result).not.toBeNull();
    expect(result?.index).toBe(10_000);
    expect(result?.value).toBe(10.0);
    // Under linear O(N) neighbor tracking, 250k samples executes in single-digit ms
    expect(elapsedMs).toBeLessThan(100);
  });

  it("memoizes amplitude bounds and directional lookahead (issue #314)", () => {
    clearFeatureSearchCache();
    const timestamps = [0, 1, 2, 3, 4, 5, 6, 7];
    const samples = [0, 5, 10, 5, 0, 5, 10, 5];

    // getChannelBounds memoizes across repeated calls on same array
    const b1 = getChannelBounds(samples);
    const b2 = getChannelBounds(samples);
    expect(b1).toEqual({ vMin: 0, vMax: 10 });
    expect(b1).toBe(b2);

    // getLookahead memoizes prevResult and nextResult
    const lookahead1 = getLookahead(
      timestamps,
      samples,
      "capture-1",
      "A",
      "peak",
      2,
      true,
    );
    expect(lookahead1.prevResult).toBeNull(); // No earlier peak before 2
    expect(lookahead1.nextResult?.index).toBe(6); // Next peak at 6

    const lookahead2 = getLookahead(
      timestamps,
      samples,
      "capture-1",
      "A",
      "peak",
      2,
      true,
    );
    expect(lookahead2).toBe(lookahead1);

    // Hidden channel yields null results
    const hidden = getLookahead(
      timestamps,
      samples,
      "capture-1",
      "A",
      "peak",
      2,
      false,
    );
    expect(hidden).toEqual({ prevResult: null, nextResult: null });
  });

  it("isolates lookahead cache between different capture object instances (F1 regression)", () => {
    // Two distinct capture objects with same channel name 'A' but different waveforms
    const captureObj1 = { id: 1 };
    const captureObj2 = { id: 2 };
    const ts = [0, 1, 2, 3, 4];
    const samples1 = [0, 5, 0, 0, 0]; // peak at index 1
    const samples2 = [0, 0, 0, 5, 0]; // peak at index 3

    const r1 = getLookahead(ts, samples1, captureObj1, "A", "peak", 0, true);
    expect(r1.nextResult?.index).toBe(1);

    // Querying captureObj2 at the same (channel, feature, startIndex, visible) must NOT return captureObj1's cache
    const r2 = getLookahead(ts, samples2, captureObj2, "A", "peak", 0, true);
    expect(r2.nextResult?.index).toBe(3);

    // Repeated query on captureObj1 still returns index 1
    const r1Repeat = getLookahead(
      ts,
      samples1,
      captureObj1,
      "A",
      "peak",
      0,
      true,
    );
    expect(r1Repeat.nextResult?.index).toBe(1);
    expect(r1Repeat).toBe(r1);
  });
});
