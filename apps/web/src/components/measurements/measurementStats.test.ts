import { describe, it, expect } from "vitest";
import { updateAccumulator } from "./measurementStats";

describe("updateAccumulator", () => {
  it("initializes accumulator on first sample", () => {
    const acc = updateAccumulator(undefined, 10.0, "V");
    expect(acc.count).toBe(1);
    expect(acc.current).toBe(10.0);
    expect(acc.min).toBe(10.0);
    expect(acc.max).toBe(10.0);
    expect(acc.mean).toBe(10.0);
    expect(acc.stdDev).toBe(0);
    expect(acc.unit).toBe("V");
  });

  it("accumulates two distinct samples", () => {
    let acc = updateAccumulator(undefined, 10.0, "V");
    acc = updateAccumulator(acc, 20.0, "V");

    expect(acc.count).toBe(2);
    expect(acc.current).toBe(20.0);
    expect(acc.min).toBe(10.0);
    expect(acc.max).toBe(20.0);
    expect(acc.mean).toBe(15.0);
    // Sample variance = ((10-15)^2 + (20-15)^2) / (2-1) = 50 -> stdDev = sqrt(50) ~= 7.071
    expect(acc.stdDev).toBeCloseTo(7.071, 3);
  });

  it("accumulates multiple samples with constant value", () => {
    let acc = updateAccumulator(undefined, 5.0, "V");
    acc = updateAccumulator(acc, 5.0, "V");
    acc = updateAccumulator(acc, 5.0, "V");

    expect(acc.count).toBe(3);
    expect(acc.current).toBe(5.0);
    expect(acc.min).toBe(5.0);
    expect(acc.max).toBe(5.0);
    expect(acc.mean).toBe(5.0);
    expect(acc.stdDev).toBe(0);
  });

  it("accurately computes mean and standard deviation for known sequence", () => {
    // Sequence: [2, 4, 4, 4, 5, 5, 7, 9] -> N=8, Mean=5, Sum of sq diffs = 32, Sample Var = 32/7 ~= 4.5714, Sample StdDev = sqrt(32/7) ~= 2.138
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    let acc = undefined;
    for (const v of values) {
      acc = updateAccumulator(acc, v, "V");
    }

    expect(acc?.count).toBe(8);
    expect(acc?.min).toBe(2);
    expect(acc?.max).toBe(9);
    expect(acc?.mean).toBe(5);
    expect(acc?.stdDev).toBeCloseTo(Math.sqrt(32 / 7), 5);
  });

  it("ignores non-finite values and does not poison accumulators (F2)", () => {
    // 1. Initializing with NaN or Infinity returns an empty accumulator with count 0
    const nanAcc = updateAccumulator(undefined, Number.NaN, "V");
    expect(nanAcc.count).toBe(0);

    const infAcc = updateAccumulator(undefined, Number.POSITIVE_INFINITY, "V");
    expect(infAcc.count).toBe(0);

    // 2. Updating an existing accumulator with NaN or Infinity preserves state
    let acc = updateAccumulator(undefined, 10.0, "V");
    acc = updateAccumulator(acc, Number.NaN, "V");
    acc = updateAccumulator(acc, Number.POSITIVE_INFINITY, "V");
    acc = updateAccumulator(acc, Number.NEGATIVE_INFINITY, "V");

    expect(acc.count).toBe(1);
    expect(acc.current).toBe(10.0);
    expect(acc.min).toBe(10.0);
    expect(acc.max).toBe(10.0);
    expect(acc.mean).toBe(10.0);
    expect(acc.stdDev).toBe(0);
  });
});
