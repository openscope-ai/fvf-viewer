/**
 * Dynamic SI engineering prefix formatting (Issue #14).
 * Formats time, frequency, and voltage values to 3-4 significant figures
 * with appropriate SI prefixes (s/ms/µs/ns/ps/fs, Hz/kHz/MHz/GHz/THz, V/mV/µV/nV).
 * Zero-delta edge case for frequency displays an em dash ('—').
 */

export function formatWithPrefix(
  value: number,
  unit: string,
  prefixSteps: Array<{ factor: number; symbol: string }>,
): string {
  if (!Number.isFinite(value)) {
    return `—`;
  }
  if (value === 0) {
    return `0.000 ${unit}`;
  }

  const sign = value < 0 ? "-" : "";
  const absVal = Math.abs(value);
  const sorted = [...prefixSteps].sort((a, b) => b.factor - a.factor);

  // Format absVal to 4 significant figures first to handle boundary rounding & prefix promotion
  const precisionVal = Number(absVal.toPrecision(4));
  let stepIdx = sorted.findIndex(
    (step) => precisionVal >= step.factor * 0.999999,
  );
  if (stepIdx === -1) {
    stepIdx = sorted.length - 1;
  }

  const step = sorted[stepIdx]!;
  const scaled = precisionVal / step.factor;

  let formatted: string;
  if (scaled >= 100) {
    formatted = scaled.toFixed(1); // e.g. 125.4 (4 sig figs) or 999.0
  } else if (scaled >= 10) {
    formatted = scaled.toFixed(2); // e.g. 12.54 (4 sig figs)
  } else if (scaled >= 1) {
    formatted = scaled.toFixed(3); // e.g. 1.254 (4 sig figs)
  } else {
    formatted = Number(scaled.toPrecision(3)).toString();
  }

  return `${sign}${formatted} ${step.symbol}${unit}`;
}

const TIME_PREFIXES = [
  { factor: 1e3, symbol: "k" },
  { factor: 1, symbol: "" },
  { factor: 1e-3, symbol: "m" },
  { factor: 1e-6, symbol: "µ" },
  { factor: 1e-9, symbol: "n" },
  { factor: 1e-12, symbol: "p" },
  { factor: 1e-15, symbol: "f" },
];

const FREQ_PREFIXES = [
  { factor: 1e12, symbol: "T" },
  { factor: 1e9, symbol: "G" },
  { factor: 1e6, symbol: "M" },
  { factor: 1e3, symbol: "k" },
  { factor: 1, symbol: "" },
  { factor: 1e-3, symbol: "m" },
  { factor: 1e-6, symbol: "µ" },
  { factor: 1e-9, symbol: "n" },
];

const VOLTAGE_PREFIXES = [
  { factor: 1e6, symbol: "M" },
  { factor: 1e3, symbol: "k" },
  { factor: 1, symbol: "" },
  { factor: 1e-3, symbol: "m" },
  { factor: 1e-6, symbol: "µ" },
  { factor: 1e-9, symbol: "n" },
  { factor: 1e-12, symbol: "p" },
];

export function formatTime(seconds: number): string {
  return formatWithPrefix(seconds, "s", TIME_PREFIXES);
}

export function formatFrequency(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) {
    return "—"; // em dash for zero or undefined frequency
  }
  return formatWithPrefix(hz, "Hz", FREQ_PREFIXES);
}

export function formatVoltage(volts: number): string {
  return formatWithPrefix(volts, "V", VOLTAGE_PREFIXES);
}
