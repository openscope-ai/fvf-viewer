import { describe, expect, it } from "vitest";

/**
 * Issue #226: unit-pinned measurement formatting — fixed-unit scaling for
 * time/frequency/voltage, the dBV conversion, the non-volt passthrough,
 * and byte-identical `auto` fallthrough to the pre-#226 formatters.
 */

import {
  formatFrequencyWithUnit,
  formatTimeWithUnit,
  formatVoltageWithUnit,
} from "./displayUnits";
import { formatFrequency, formatTime } from "./siFormat";

describe("formatTimeWithUnit (issue #226)", () => {
  it("auto keeps the SI ladder output byte-identical", () => {
    for (const value of [0.0000125, 0.25, 12.5, 0, -0.001, Number.NaN]) {
      expect(formatTimeWithUnit(value, "auto")).toBe(formatTime(value));
    }
  });

  it("pins each unit without SI promotion", () => {
    expect(formatTimeWithUnit(1e-3, "s")).toBe("0.001 s");
    expect(formatTimeWithUnit(0.25, "s")).toBe("0.25 s");
    expect(formatTimeWithUnit(0.25, "ms")).toBe("250.0 ms");
    expect(formatTimeWithUnit(1.25e-3, "ms")).toBe("1.250 ms");
    expect(formatTimeWithUnit(2.5e-6, "µs")).toBe("2.500 µs");
    expect(formatTimeWithUnit(125e-9, "ns")).toBe("125.0 ns");
  });

  it("keeps signs, zero, and the non-finite em dash", () => {
    expect(formatTimeWithUnit(-0.25, "ms")).toBe("-250.0 ms");
    expect(formatTimeWithUnit(Number.NaN, "s")).toBe("—");
    expect(formatTimeWithUnit(0, "s")).toBe("0.000 s");
  });
});

describe("formatFrequencyWithUnit (issue #226)", () => {
  it("auto keeps the reciprocal SI ladder output", () => {
    expect(formatFrequencyWithUnit(80_000, "auto")).toBe(
      formatFrequency(80_000),
    );
  });

  it("pins Hz/kHz/MHz scaling", () => {
    expect(formatFrequencyWithUnit(80_000, "Hz")).toBe("80000.0 Hz");
    expect(formatFrequencyWithUnit(80_000, "kHz")).toBe("80.00 kHz");
    expect(formatFrequencyWithUnit(1_250_000, "MHz")).toBe("1.250 MHz");
    expect(formatFrequencyWithUnit(1_250_000, "kHz")).toBe("1250.0 kHz");
  });

  it("non-positive reciprocals read the em dash in every pinned unit", () => {
    expect(formatFrequencyWithUnit(0, "kHz")).toBe("—");
    expect(formatFrequencyWithUnit(-1, "Hz")).toBe("—");
    expect(formatFrequencyWithUnit(Number.NaN, "MHz")).toBe("—");
  });
});

describe("formatVoltageWithUnit (issue #226)", () => {
  it("auto and non-volt channels keep formatChannelValue output", () => {
    expect(formatVoltageWithUnit(0.5, "V", "auto")).toBe("500.0 mV");
    expect(formatVoltageWithUnit(0.5, "A", "V")).toBe("500.0 mA");
    expect(formatVoltageWithUnit(3, "raw", "dBV")).toBe("3 raw");
    expect(formatVoltageWithUnit(0.5, "mV", "auto")).toBe("500.0 mV");
  });

  it("pins V and mV for volt channels regardless of file display unit", () => {
    // Values are base-SI volts; a `mV` file unit must not double-scale.
    expect(formatVoltageWithUnit(0.5, "mV", "V")).toBe("0.5 V");
    expect(formatVoltageWithUnit(0.5, "mV", "mV")).toBe("500.0 mV");
    expect(formatVoltageWithUnit(12.34, "V", "V")).toBe("12.34 V");
  });

  it("converts volt channels to dBV (20·log10|V|)", () => {
    expect(formatVoltageWithUnit(1, "V", "dBV")).toBe("0.000 dBV");
    expect(formatVoltageWithUnit(10, "V", "dBV")).toBe("20.00 dBV");
    expect(formatVoltageWithUnit(0.5, "mV", "dBV")).toBe("-6.021 dBV");
    // Negative half-cycles carry magnitudes: |−1.795416| → 5.083 dBV.
    expect(formatVoltageWithUnit(-1.795416, "V", "dBV")).toBe("5.083 dBV");
    expect(formatVoltageWithUnit(-10, "V", "dBV")).toBe("20.00 dBV");
    expect(formatVoltageWithUnit(-0.5, "mV", "dBV")).toBe("-6.021 dBV");
    // Zero and non-finite samples carry no dBV magnitude.
    expect(formatVoltageWithUnit(0, "V", "dBV")).toBe("—");
    expect(formatVoltageWithUnit(Number.NaN, "V", "dBV")).toBe("—");
  });
});
