/**
 * Unit-aware channel helpers (issue #106): one home for every decision
 * that turns a verbatim record unit token into display behavior.
 *
 * - Verbatim file units (`V`, `mA`, ...) ride the decode untouched; sample
 *   values are already canonical base-SI (`raw × S`, issue #104), so every
 *   helper below formats the stored value directly — no conversion.
 * - Empty or missing units fold to the explicit `"raw"` fallback instead of
 *   an empty string, so no heading, readout, or CSV cell ever shows a bare
 *   number with an implied unit.
 * - `splitUnit` strips one display prefix (`mA` → base `A`) for SI-ladder
 *   formatting; unknown tokens stay verbatim and non-prefixable.
 */

import { formatWithPrefix } from "../components/cursors/siFormat";
import type { ParsedCapture } from "../types/capture";

/** Explicit fallback for empty/missing unit tokens (never ""). */
export const UNIT_FALLBACK = "raw";

/** Instrument saturation rails mirrored from `records.rs` (issue #104). */
export const SATURATED_HIGH_RAIL = 2147483647; // i32::MAX
export const SATURATED_LOW_RAILS = [-2147483648, -2147483646]; // i32::MIN, i32::MIN + 2

/** Trim float noise the way axis ticks do: six significant figures. */
export function trimFloat(value: number): string {
  const rounded = Number(value.toPrecision(6));
  return String(rounded === 0 ? 0 : rounded);
}

/** Empty/missing unit tokens become the explicit `"raw"` fallback. */
export function normalizeUnit(unit: string | undefined | null): string {
  const trimmed = (unit ?? "").trim();
  return trimmed === "" ? UNIT_FALLBACK : trimmed;
}

const SI_BASES = new Set(["V", "A", "W", "Hz", "s"]);

const SI_PREFIXES = ["G", "M", "k", "m", "µ", "u", "n", "p"] as const;

export interface UnitSplit {
  /** Canonical base symbol (`mA` → `A`; unknown/empty stays verbatim). */
  base: string;
  /** True for the known SI bases above (ladder formatting applies). */
  prefixable: boolean;
}

/**
 * Splits one display prefix off a unit token: `mA` → `{ base: "A" }`.
 * Unknown tokens (`%`, `dB`, `arb`) and the empty token (→ `"raw"`) stay
 * verbatim and non-prefixable so SI scaling can never invent `k%`.
 */
export function splitUnit(unit: string | undefined | null): UnitSplit {
  const token = normalizeUnit(unit);
  if (SI_BASES.has(token)) return { base: token, prefixable: true };
  const [prefix, ...rest] = token;
  const remainder = rest.join("");
  if (
    prefix !== undefined &&
    (SI_PREFIXES as readonly string[]).includes(prefix) &&
    SI_BASES.has(remainder)
  ) {
    return { base: remainder, prefixable: true };
  }
  return { base: token, prefixable: false };
}

const VOLT_LIKE_PREFIXES = [
  { factor: 1e9, symbol: "G" },
  { factor: 1e6, symbol: "M" },
  { factor: 1e3, symbol: "k" },
  { factor: 1, symbol: "" },
  { factor: 1e-3, symbol: "m" },
  { factor: 1e-6, symbol: "µ" },
  { factor: 1e-9, symbol: "n" },
  { factor: 1e-12, symbol: "p" },
];

const HZ_PREFIXES = [
  { factor: 1e12, symbol: "T" },
  { factor: 1e9, symbol: "G" },
  { factor: 1e6, symbol: "M" },
  { factor: 1e3, symbol: "k" },
  { factor: 1, symbol: "" },
  { factor: 1e-3, symbol: "m" },
  { factor: 1e-6, symbol: "µ" },
  { factor: 1e-9, symbol: "n" },
];

const SECOND_PREFIXES = [
  { factor: 1e3, symbol: "k" },
  { factor: 1, symbol: "" },
  { factor: 1e-3, symbol: "m" },
  { factor: 1e-6, symbol: "µ" },
  { factor: 1e-9, symbol: "n" },
  { factor: 1e-12, symbol: "p" },
  { factor: 1e-15, symbol: "f" },
];

function ladderFor(base: string): Array<{ factor: number; symbol: string }> {
  if (base === "Hz") return HZ_PREFIXES;
  if (base === "s") return SECOND_PREFIXES;
  return VOLT_LIKE_PREFIXES;
}

/**
 * Formats a stored base-SI sample value with its channel unit, always
 * making the unit family explicit (`1.024 A`, `500.0 µA`, `3 raw`).
 * Non-finite (Overload-NaN) samples read `—`, matching `siFormat`.
 */
export function formatChannelValue(
  value: number,
  unit: string | undefined | null,
): string {
  if (!Number.isFinite(value)) return "—";
  const { base, prefixable } = splitUnit(unit);
  if (!prefixable) return `${trimFloat(value)} ${base}`;
  return formatWithPrefix(value, base, ladderFor(base));
}

/**
 * Canonical-SI per-division rendering (`Input B · 100 mA/Div`): the SI
 * ladder is picked from the base-SI magnitude, so the file's display
 * prefix never leaks through (`0.1 A` → `100 mA/Div`, `200 V` stays).
 */
export function formatCanonicalPerDiv(
  perDiv: number,
  unit: string | undefined | null,
): string {
  if (!Number.isFinite(perDiv)) return "—";
  const { base, prefixable } = splitUnit(unit);
  if (!prefixable) return `${trimFloat(perDiv)} ${base}/Div`;
  const ladder = ladderFor(base);
  const abs = Math.abs(perDiv);
  const step =
    abs === 0
      ? (ladder.find((entry) => entry.factor === 1) ?? ladder[0]!)
      : ([...ladder]
          .sort((a, b) => b.factor - a.factor)
          .find((entry) => abs >= entry.factor * 0.999999) ??
        ladder[ladder.length - 1]!);
  const scaled = perDiv / step.factor;
  const text = Number.isInteger(scaled) ? String(scaled) : trimFloat(scaled);
  return `${text} ${step.symbol}${base}/Div`;
}

/** uPlot scale key for the Nth physical channel (axis-per-channel). */
export function yScaleKey(index: number): string {
  return `y${index}`;
}

export interface ChannelMetaLine {
  /** Verbatim file unit, normalized (`raw` fallback). */
  fileUnit: string;
  /** Canonical base symbol formatting the channel's values. */
  baseUnit: string;
  /** Canonical-SI per-division text (`100 mA/Div`), null when unknown. */
  perDivText: string | null;
  /** Stored window text (`[-250, 150] A`), null when unknown. */
  windowText: string | null;
  /** Saturated sample count (0 when none or unknown). */
  saturated: number;
  /** Joined meta line, or null when nothing is known. */
  line: string | null;
}

/**
 * Per-channel context line for the readout card (issue #106): verbatim
 * file unit, canonical per-division, stored window in base units, and the
 * saturated count when above zero
 * (`mA · 100 mA/Div · [-0.3, 0.5] A · 3 saturated`).
 */
export function describeChannelMeta(
  capture: ParsedCapture,
  index: number,
): ChannelMetaLine {
  const info = capture.metadata.channels[index];
  const physical = info && !info.derived ? info : undefined;
  const fileUnit = normalizeUnit(physical?.unit);
  const { base } = splitUnit(fileUnit);
  const perDivText =
    physical?.perDiv !== undefined && Number.isFinite(physical.perDiv)
      ? formatCanonicalPerDiv(physical.perDiv, fileUnit)
      : null;
  const windowText =
    physical?.windowMin !== undefined &&
    physical?.windowMax !== undefined &&
    Number.isFinite(physical.windowMin) &&
    Number.isFinite(physical.windowMax)
      ? `[${trimFloat(physical.windowMin)}, ${trimFloat(physical.windowMax)}] ${base}`
      : null;
  const saturated =
    physical?.saturatedSamples !== undefined &&
    Number.isFinite(physical.saturatedSamples) &&
    physical.saturatedSamples > 0
      ? physical.saturatedSamples
      : 0;
  const parts = [fileUnit];
  if (perDivText !== null) parts.push(perDivText);
  if (windowText !== null) parts.push(windowText);
  if (saturated > 0) parts.push(`${saturated} saturated`);
  return {
    fileUnit,
    baseUnit: base,
    perDivText,
    windowText,
    saturated,
    // A bare fallback token alone carries no context: legacy captures
    // without vertical metadata hide the row entirely.
    line: parts.length > 1 ? parts.join(" · ") : null,
  };
}

function metadataUnit(
  capture: ParsedCapture,
  index: number,
): string | undefined {
  const info = capture.metadata.channels[index];
  if (!info || info.derived) return undefined;
  return info.unit;
}

/**
 * Normalized unit for the Nth physical channel, read from the leading
 * physical metadata entries (issue #103 ordering: physical first).
 */
export function getPhysicalChannelUnit(
  capture: ParsedCapture,
  index: number,
): string {
  if (index < 0 || index >= capture.channels.length) return UNIT_FALLBACK;
  return normalizeUnit(metadataUnit(capture, index));
}

/**
 * Unit for a derived channel: the shared source unit when every source
 * resolves to the same token, else the `"raw"` fallback (a difference of
 * amperes and volts has no single unit).
 */
export function getDerivedChannelUnit(
  capture: ParsedCapture,
  derivedIndex: number,
): string {
  const derived = capture.derivedChannels[derivedIndex];
  if (!derived || derived.sourceChannels.length === 0) return UNIT_FALLBACK;
  const physical = capture.metadata.channels.filter((info) => !info.derived);
  const units = derived.sourceChannels.map((letter) => {
    const info = physical.find((entry) => entry.name === letter);
    return info ? normalizeUnit(info.unit) : UNIT_FALLBACK;
  });
  const first = units[0]!;
  return units.every((unit) => unit === first) ? first : UNIT_FALLBACK;
}

/**
 * NaN-aware data extent for one channel: saturated (non-finite) samples
 * never stretch the fit. Returns null when nothing finite remains.
 */
export function channelFitRange(
  data: ArrayLike<number>,
): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i]!;
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max };
}

function railEdge(
  raw: number | undefined,
  windowMin: number,
  windowMax: number,
): number | null {
  if (raw === SATURATED_HIGH_RAIL) return windowMax;
  if (raw !== undefined && SATURATED_LOW_RAILS.includes(raw)) return windowMin;
  return null;
}

/**
 * Display lane for one plotted channel (issue #106): saturated NaN
 * samples are clipped to the stored window edge by rail polarity, so the
 * trace stays visually continuous with the vendor software. The source buffers are
 * never mutated — readout and CSV keep reading NaN/empty.
 */
export function buildDisplayData(
  data: Float32Array,
  rawCounts: Int32Array | undefined,
  windowMin: number | undefined,
  windowMax: number | undefined,
): Float32Array {
  if (
    windowMin === undefined ||
    windowMax === undefined ||
    !Number.isFinite(windowMin) ||
    !Number.isFinite(windowMax)
  ) {
    return data.slice();
  }
  const display = data.slice();
  for (let i = 0; i < display.length; i += 1) {
    if (Number.isFinite(display[i])) continue;
    const edge = railEdge(rawCounts?.[i], windowMin, windowMax);
    if (edge !== null) display[i] = Math.fround(edge);
  }
  return display;
}
