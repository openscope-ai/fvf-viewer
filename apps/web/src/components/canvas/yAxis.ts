/**
 * Zoom-adaptive Y-axis SI units (issue #86, #120): dynamically selects the optimal
 * SI unit (kV, V, mV, µV for Voltage) from the largest absolute bound max(|min|, |max|)
 * and formats tick values and axis title accordingly.
 *
 * Includes 5% hysteresis on boundary crossings to prevent title/tick jitter,
 * and an extensible architecture supporting configurable quantity/unit pairs
 * (e.g. Current "A", Power "W", non-prefixable Ratio "%").
 */

export interface YAxisUnit {
  key: string;
  factor: number;
  label: string;
}

export interface YAxisConfig {
  quantity?: string;
  /**
   * Canonical base-SI unit symbol (`V`, `A`, ...). Only known SI bases
   * ladder into prefixed units; anything else (including `""` and the
   * `"raw"` fallback) renders as one unscaled unit so SI scaling can
   * never invent `k%` or `kraw`.
   */
  unit?: string;
  /** Initial unit key (e.g. 'mV') or full label (e.g. 'Voltage (mV)') to seed adapter state. */
  initialUnit?: string;
  /** uPlot scale key this adapter follows (issue #106: `y0`, `y1`, ...). */
  scaleKey?: string;
}

/** Base symbols whose magnitudes ladder into SI-prefixed axis units. */
const PREFIXABLE_BASE_UNITS = new Set(["V", "A", "W", "Hz", "s"]);

/** Prefixable SI unit definitions with standard decadic scale factors. */
const SI_PREFIXES: readonly { prefix: string; factor: number }[] = [
  { prefix: "k", factor: 1e3 },
  { prefix: "", factor: 1 },
  { prefix: "m", factor: 1e-3 },
  { prefix: "µ", factor: 1e-6 },
];

/** Non-prefixable unit symbols that should not receive SI scaling. */
const NON_PREFIXABLE_UNITS = new Set(["%", "dB", "deg", "rad"]);

/**
 * Builds the list of available units for a given quantity and base unit symbol.
 */
export function buildYAxisUnits(
  quantity: string,
  baseUnit: string,
): YAxisUnit[] {
  if (
    NON_PREFIXABLE_UNITS.has(baseUnit) ||
    !baseUnit ||
    !PREFIXABLE_BASE_UNITS.has(baseUnit)
  ) {
    const symbol = baseUnit || quantity;
    const label = baseUnit ? `${quantity} (${baseUnit})` : quantity;
    return [{ key: symbol, factor: 1, label }];
  }

  return SI_PREFIXES.map(({ prefix, factor }) => {
    const key = `${prefix}${baseUnit}`;
    const label = `${quantity} (${key})`;
    return { key, factor, label };
  });
}

/** Standard voltage unit boundaries separating adjacent units. */
export const Y_UNIT_BOUNDARIES: readonly number[] = [1000, 1, 1e-3];

/** Relative margin (5%) a span must cross past a boundary before switching. */
export const SWITCH_MARGIN = 0.05;

/**
 * Selects the target unit for a scale bound (or largest absolute bound).
 * - bound >= 1000 : kV (index 0)
 * - 1 <= bound < 1000 : V (index 1)
 * - 1e-3 <= bound < 1 : mV (index 2)
 * - bound < 1e-3 : µV (index 3)
 * Non-finite or non-positive bounds fall back to the unscaled base unit (index 1).
 */
export function selectYUnit(
  bound: number,
  units: readonly YAxisUnit[],
): YAxisUnit {
  if (units.length <= 1) return units[0]!;
  const absBound = Math.abs(bound);
  if (!Number.isFinite(absBound) || absBound <= 0) return units[1] ?? units[0]!;
  if (absBound >= 1000) return units[0]!;
  if (absBound >= 1) return units[1]!;
  if (absBound >= 1e-3) return units[2]!;
  return units[3]!;
}

/**
 * Formats a tick value in axis units without floating-point precision jitter:
 * six significant figures covers any tick uPlot picks, trimming float noise.
 */
export function formatScaledTick(value: number, unit: YAxisUnit): string {
  const scaled = value / unit.factor;
  const rounded = Number(scaled.toPrecision(6));
  return String(rounded === 0 ? 0 : rounded);
}

/** Minimal uPlot-like surface the adapter touches. */
export interface YAxisScaleBounds {
  min?: number | null;
  max?: number | null;
}

export interface YAxisLike {
  scales: Record<string, YAxisScaleBounds | undefined>;
  axes: unknown[];
}

export interface YAxisAdapter {
  sync: (u: YAxisLike) => void;
  values: (self: unknown, splits: number[]) => string[];
  label: string;
  unit: YAxisUnit;
  /** uPlot scale key this adapter follows (`y` or `yN`). */
  scaleKey: string;
  config: { quantity: string; unit: string };
  setQuantity: (quantity: string, u?: YAxisLike) => void;
}

/**
 * Creates an extensible Y-axis adapter.
 */
export function createYAxisAdapter(config: YAxisConfig = {}): YAxisAdapter {
  let currentQuantity = config.quantity ?? "Voltage";
  const baseUnit = config.unit ?? "V";
  const scaleKey = config.scaleKey ?? "y";
  let units = buildYAxisUnits(currentQuantity, baseUnit);

  const matchedInitial = config.initialUnit
    ? units.find(
        (u) => u.key === config.initialUnit || u.label === config.initialUnit,
      )
    : undefined;

  // Default unit is matched initial, unscaled base unit (index 1 for SI prefixes, index 0 otherwise)
  let unit: YAxisUnit =
    matchedInitial ?? (units.length > 1 ? units[1]! : units[0]!);
  let established = Boolean(matchedInitial);

  function setAxisLabel(u: YAxisLike, label: string) {
    const axes = u.axes as
      Array<{ scale?: string; label?: string } | undefined> | undefined;
    const axis =
      axes?.find((a) => a?.scale === scaleKey) ?? axes?.[1] ?? axes?.[0];
    if (axis) {
      axis.label = label;
    }
  }

  return {
    get label() {
      return unit.label;
    },
    get unit() {
      return unit;
    },
    scaleKey,
    get config() {
      return { quantity: currentQuantity, unit: baseUnit };
    },
    setQuantity: (newQuantity: string, u?: YAxisLike) => {
      currentQuantity = newQuantity;
      units = buildYAxisUnits(newQuantity, baseUnit);
      const matched =
        units.find((entry) => entry.key === unit.key) ?? units[1] ?? units[0]!;
      unit = matched;
      if (u) {
        setAxisLabel(u, unit.label);
      }
    },
    sync: (u) => {
      const min = u.scales[scaleKey]?.min;
      const max = u.scales[scaleKey]?.max;
      if (min == null || max == null) return;
      const maxAbs = Math.max(Math.abs(min), Math.abs(max));
      if (!Number.isFinite(maxAbs) || maxAbs <= 0) {
        established = true;
        unit = units[1] ?? units[0]!;
        setAxisLabel(u, unit.label);
        return;
      }
      const target = selectYUnit(maxAbs, units);

      if (!established) {
        established = true;
        unit = target;
        setAxisLabel(u, target.label);
        return;
      }

      if (target.key === unit.key) return;

      if (units.length > 1) {
        const i = units.indexOf(unit);
        const j = units.indexOf(target);
        // Moving to a larger unit (j < i) requires maxAbs to exceed boundary by margin;
        // moving to a smaller unit (j > i) requires maxAbs to fall below boundary by margin.
        const boundary =
          Y_UNIT_BOUNDARIES[Math.min(i, j)]! *
          (j < i ? 1 + SWITCH_MARGIN : 1 - SWITCH_MARGIN);
        const pastBoundary = j < i ? maxAbs >= boundary : maxAbs < boundary;
        if (!pastBoundary) return;
      }

      unit = target;
      setAxisLabel(u, target.label);
    },
    values: (_self: unknown, splits: number[]) =>
      splits.map((tick) => formatScaledTick(tick, unit)),
  };
}
