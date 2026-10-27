import { describe, it, expect } from "vitest";
import {
  computeTimingStats,
  resolveTimingGateRange,
  formatTimingDuration,
  formatTimingFrequency,
  formatTimingDutyCycle,
  EMPTY_TIMING_STATS,
} from "./timingStats";

describe("resolveTimingGateRange", () => {
  const timestamps = [0, 0.001, 0.002, 0.003, 0.004, 0.005];

  it("gates between C1 and C2 when both are active", () => {
    const res = resolveTimingGateRange(
      timestamps,
      true,
      true,
      4,
      1,
      null,
      null,
    );
    expect(res).toEqual({ startIndex: 1, endIndex: 4, isCursorGated: true });
  });

  it("gates to visible viewport when cursors are inactive", () => {
    const res = resolveTimingGateRange(
      timestamps,
      true,
      false,
      1,
      4,
      0.002,
      0.004,
    );
    expect(res.isCursorGated).toBe(false);
    expect(res.startIndex).toBe(2);
    expect(res.endIndex).toBe(4);
  });

  it("handles empty timestamps", () => {
    const res = resolveTimingGateRange([], true, true, 0, 0, null, null);
    expect(res).toEqual({ startIndex: 0, endIndex: -1, isCursorGated: false });
  });
});

describe("computeTimingStats", () => {
  it("returns empty stats for fewer than 5 samples", () => {
    const t = [0, 1, 2];
    const d = [0, 1, 0];
    expect(computeTimingStats(t, d, 0, 2)).toEqual(EMPTY_TIMING_STATS);
  });

  it("returns empty stats for flat DC signal", () => {
    const len = 100;
    const t = new Float64Array(len);
    const d = new Float64Array(len);
    for (let i = 0; i < len; i++) {
      t[i] = i * 0.001;
      d[i] = 3.3;
    }
    expect(computeTimingStats(t, d, 0, len - 1)).toEqual(EMPTY_TIMING_STATS);
  });

  it("accurately measures 1 kHz sine wave", () => {
    const n = 2000;
    const fs = 100_000; // 100 kHz sample rate -> 100 samples per period of 1 kHz
    const t = new Float64Array(n);
    const d = new Float64Array(n);
    const freq = 1000;

    for (let i = 0; i < n; i++) {
      t[i] = i / fs;
      d[i] = Math.sin(2 * Math.PI * freq * t[i]!);
    }

    const stats = computeTimingStats(t, d, 0, n - 1);

    expect(stats.period).toBeCloseTo(0.001, 5);
    expect(stats.frequency).toBeCloseTo(1000, 1);
    expect(stats.positivePulseWidth).toBeCloseTo(0.0005, 5);
    expect(stats.negativePulseWidth).toBeCloseTo(0.0005, 5);
    expect(stats.dutyCycle).toBeCloseTo(50, 1);

    // Rise time from -0.8 to +0.8 of sine wave:
    // asin(0.8) - asin(-0.8) = 2 * 0.9273 rad = 1.8546 rad
    // Fraction of period: 1.8546 / (2*pi) ~= 0.29517 ms
    expect(stats.riseTime).toBeCloseTo(0.000295, 5);
    expect(stats.fallTime).toBeCloseTo(0.000295, 5);
  });

  it("accurately measures pulse wave with 25% duty cycle", () => {
    const n = 2000;
    const fs = 100_000;
    const periodSamples = 200; // 500 Hz
    const highSamples = 50; // 25% high
    const t = new Float64Array(n);
    const d = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      t[i] = i / fs;
      d[i] = i % periodSamples < highSamples ? 5.0 : 0.0;
    }

    const stats = computeTimingStats(t, d, 0, n - 1);

    expect(stats.period).toBeCloseTo(0.002, 5);
    expect(stats.frequency).toBeCloseTo(500, 1);
    expect(stats.positivePulseWidth).toBeCloseTo(0.0005, 5);
    expect(stats.negativePulseWidth).toBeCloseTo(0.0015, 5);
    expect(stats.dutyCycle).toBeCloseTo(25, 1);
  });

  it("handles inverted signal correctly", () => {
    const n = 2000;
    const fs = 100_000;
    const periodSamples = 200;
    const highSamples = 50; // Raw is 25% high (75% low). Inverted should be 75% high (25% low).
    const t = new Float64Array(n);
    const d = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      t[i] = i / fs;
      d[i] = i % periodSamples < highSamples ? 5.0 : 0.0;
    }

    const stats = computeTimingStats(t, d, 0, n - 1, true);

    expect(stats.period).toBeCloseTo(0.002, 5);
    expect(stats.positivePulseWidth).toBeCloseTo(0.0015, 5);
    expect(stats.negativePulseWidth).toBeCloseTo(0.0005, 5);
    expect(stats.dutyCycle).toBeCloseTo(75, 1);
  });

  it("returns empty stats for aperiodic signal (AC4)", () => {
    // 3 pulses with intervals 1 ms and 10 ms (aperiodic)
    const t: number[] = [];
    const d: number[] = [];
    for (let i = 0; i <= 150; i++) {
      const time = i * 0.0001; // 0.1 ms steps
      t.push(time);
      const isHigh =
        (time >= 0.0001 && time <= 0.0005) ||
        (time >= 0.0011 && time <= 0.0015) ||
        (time >= 0.0111 && time <= 0.0115);
      d.push(isHigh ? 5.0 : 0.0);
    }
    expect(computeTimingStats(t, d, 0, t.length - 1)).toEqual(
      EMPTY_TIMING_STATS,
    );
  });

  it("returns empty stats for single isolated pulse with insufficient cycles (AC4)", () => {
    // Single pulse: 1 rising, 1 falling edge -> < 2 same-direction edges
    const t = [0, 0.001, 0.002, 0.003, 0.004];
    const d = [0, 5, 5, 0, 0];
    expect(computeTimingStats(t, d, 0, t.length - 1)).toEqual(
      EMPTY_TIMING_STATS,
    );
  });

  it("handles non-finite values gracefully", () => {
    const n = 1000;
    const fs = 50_000;
    const t = new Float64Array(n);
    const d = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      t[i] = i / fs;
      d[i] = Math.sin(2 * Math.PI * 500 * t[i]!);
    }
    // Inject some NaNs / Infs
    d[10] = Number.NaN;
    d[50] = Number.POSITIVE_INFINITY;

    const stats = computeTimingStats(t, d, 0, n - 1);
    expect(stats.period).toBeCloseTo(0.002, 4);
    expect(stats.frequency).toBeCloseTo(500, 1);
    expect(stats.dutyCycle).toBeCloseTo(50, 1);
  });
});

describe("Timing formatters", () => {
  it("formats timing duration", () => {
    expect(formatTimingDuration(null)).toBe("--");
    expect(formatTimingDuration(0.001)).toBe("1.000 ms");
    expect(formatTimingDuration(0.000025)).toBe("25.00 µs");
  });

  it("formats timing frequency", () => {
    expect(formatTimingFrequency(null)).toBe("--");
    expect(formatTimingFrequency(1000)).toBe("1.000 kHz");
    expect(formatTimingFrequency(15_000_000)).toBe("15.00 MHz");
  });

  it("formats timing duty cycle", () => {
    expect(formatTimingDutyCycle(null)).toBe("--");
    expect(formatTimingDutyCycle(50.0)).toBe("50.0 %");
    expect(formatTimingDutyCycle(25.43)).toBe("25.4 %");
  });
});
