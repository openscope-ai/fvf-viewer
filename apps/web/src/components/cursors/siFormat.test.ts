import { describe, expect, it } from "vitest";
import { formatFrequency, formatTime, formatVoltage } from "./siFormat";

describe("siFormat", () => {
  describe("formatTime", () => {
    it("formats seconds, milliseconds, microseconds, and nanoseconds", () => {
      expect(formatTime(1.234)).toBe("1.234 s");
      expect(formatTime(0.0125)).toBe("12.50 ms");
      expect(formatTime(0.00015)).toBe("150.0 µs");
      expect(formatTime(2.5e-8)).toBe("25.00 ns");
      expect(formatTime(0)).toBe("0.000 s");
      expect(formatTime(-0.005)).toBe("-5.000 ms");
    });

    it("handles boundary rounding and promotes prefixes without producing 5 sig figs (Finding F3)", () => {
      // 999.96 ms rounds to 1.000 s (promoted prefix, 4 sig figs, NOT 1000.0 ms)
      expect(formatTime(0.99996)).toBe("1.000 s");
      expect(formatTime(0.99994)).toBe("999.9 ms");
      // 99.996 ms rounds to 100.0 ms (4 sig figs)
      expect(formatTime(0.099996)).toBe("100.0 ms");
      // 9.9996 ms rounds to 10.00 ms (4 sig figs)
      expect(formatTime(0.0099996)).toBe("10.00 ms");
      // Exact boundaries
      expect(formatTime(1.0)).toBe("1.000 s");
      expect(formatTime(10.0)).toBe("10.00 s");
      expect(formatTime(100.0)).toBe("100.0 s");
    });
  });

  describe("formatFrequency", () => {
    it("formats Hz, kHz, MHz, and GHz", () => {
      expect(formatFrequency(50)).toBe("50.00 Hz");
      expect(formatFrequency(1500)).toBe("1.500 kHz");
      expect(formatFrequency(2.5e6)).toBe("2.500 MHz");
      expect(formatFrequency(1.2e9)).toBe("1.200 GHz");
    });

    it("displays em dash when delta t is 0 (frequency undefined/zero)", () => {
      expect(formatFrequency(0)).toBe("—");
      expect(formatFrequency(Number.POSITIVE_INFINITY)).toBe("—");
      expect(formatFrequency(-10)).toBe("—");
    });

    it("handles boundary values and high/low ranges (Finding F3)", () => {
      expect(formatFrequency(999.96e3)).toBe("1.000 MHz");
      expect(formatFrequency(999.94e3)).toBe("999.9 kHz");
      expect(formatFrequency(0.5)).toBe("500.0 mHz");
    });
  });

  describe("formatVoltage", () => {
    it("formats V, mV, and µV", () => {
      expect(formatVoltage(3.3)).toBe("3.300 V");
      expect(formatVoltage(0.045)).toBe("45.00 mV");
      expect(formatVoltage(0.00025)).toBe("250.0 µV");
      expect(formatVoltage(-1.5)).toBe("-1.500 V");
      expect(formatVoltage(0)).toBe("0.000 V");
    });

    it("handles boundary rounding and promotes prefixes (Finding F3)", () => {
      expect(formatVoltage(0.99996)).toBe("1.000 V");
      expect(formatVoltage(0.99994)).toBe("999.9 mV");
      expect(formatVoltage(0.099996)).toBe("100.0 mV");
      expect(formatVoltage(0.0099996)).toBe("10.00 mV");
      expect(formatVoltage(-0.99996)).toBe("-1.000 V");
    });
  });
});
