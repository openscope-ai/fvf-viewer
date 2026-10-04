/**
 * Unit-pinned measurement formatting (issue #226): formats time,
 * frequency, and voltage values in the user's selected display unit
 * instead of the automatic SI ladder. `auto` selections fall through to
 * the existing `siFormat` / `channelUnits` behavior, so the default state
 * is byte-identical to the pre-#226 readouts.
 */

import { formatChannelValue, splitUnit } from "../../capture/channelUnits";
import { formatFrequency, formatTime } from "./siFormat";
import type {
  FrequencyUnit,
  TimeUnit,
  VoltageUnit,
} from "../../state/cursorDisplayStore";

/**
 * Formats an absolute value scaled into one fixed unit, using the same
 * 4-significant-figure presentation rules as `formatWithPrefix`.
 */
function formatFixedUnit(value: number, scale: number, symbol: string): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const absVal = Math.abs(value);
  if (absVal === 0) return `0.000 ${symbol}`;
  const scaled = Number((absVal / scale).toPrecision(4));
  let formatted: string;
  if (scaled >= 100) {
    formatted = scaled.toFixed(1);
  } else if (scaled >= 10) {
    formatted = scaled.toFixed(2);
  } else if (scaled >= 1) {
    formatted = scaled.toFixed(3);
  } else {
    formatted = Number(scaled.toPrecision(3)).toString();
  }
  return `${sign}${formatted} ${symbol}`;
}

const TIME_SCALES: Record<Exclude<TimeUnit, "auto">, number> = {
  s: 1,
  ms: 1e-3,
  µs: 1e-6,
  ns: 1e-9,
};

/** Timestamp/Δt formatting under the selected time unit. */
export function formatTimeWithUnit(seconds: number, unit: TimeUnit): string {
  if (unit === "auto") return formatTime(seconds);
  return formatFixedUnit(seconds, TIME_SCALES[unit], unit);
}

const FREQUENCY_SCALES: Record<Exclude<FrequencyUnit, "auto">, number> = {
  Hz: 1,
  kHz: 1e3,
  MHz: 1e6,
};

/**
 * 1/Δt formatting under the selected frequency unit. `auto` keeps the
 * reciprocal-of-separation SI ladder (labeled "1/Δt" in the UI).
 */
export function formatFrequencyWithUnit(
  hz: number,
  unit: FrequencyUnit,
): string {
  if (unit === "auto") return formatFrequency(hz);
  if (!Number.isFinite(hz) || hz <= 0) return "—";
  return formatFixedUnit(hz, FREQUENCY_SCALES[unit], unit);
}

/**
 * Voltage formatting under the selected voltage unit. `auto` and
 * non-volt channels keep `formatChannelValue`'s canonical SI output;
 * `V`/`mV` pin the prefix and `dBV` renders 20·log10(|V|) of the
 * base-SI sample value (zero/non-finite values read "—").
 */
export function formatVoltageWithUnit(
  volts: number,
  fileUnit: string | undefined | null,
  unit: VoltageUnit,
): string {
  if (unit === "auto") return formatChannelValue(volts, fileUnit);
  const { base, prefixable } = splitUnit(fileUnit);
  if (!prefixable || base !== "V") return formatChannelValue(volts, fileUnit);
  if (unit === "V") return formatFixedUnit(volts, 1, "V");
  if (unit === "mV") return formatFixedUnit(volts, 1e-3, "mV");
  // 20·log10(|V|): negative half-cycles carry a magnitude too; only
  // zero and non-finite samples have none.
  if (volts === 0 || !Number.isFinite(volts)) return "—";
  return formatFixedUnit(20 * Math.log10(Math.abs(volts)), 1, "dBV");
}
