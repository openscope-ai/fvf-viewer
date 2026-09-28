/**
 * Zoom-adaptive X-axis time units (issue #63): picks the optimal SI time
 * unit from the visible horizontal span and scales tick values (and the
 * axis title) accordingly, so deep zooms never render strings of leading
 * zeros ("-0.05", "0.000012") and wide views stay readable in minutes.
 * The adapter is shared by the live canvas and the offscreen print render
 * so exported PNG snapshots adopt identical units by construction. CSV
 * export is intentionally untouched: it always emits lossless seconds.
 */

export type TimeAxisUnitKey = "min" | "s" | "ms" | "µs" | "ns" | "ps";

export interface TimeAxisUnit {
  key: TimeAxisUnitKey;
  /** Seconds per unit. */
  factor: number;
  label: string;
}

export const TIME_AXIS_UNITS: readonly TimeAxisUnit[] = [
  { key: "min", factor: 60, label: "Time (min)" },
  { key: "s", factor: 1, label: "Time (s)" },
  { key: "ms", factor: 1e-3, label: "Time (ms)" },
  { key: "µs", factor: 1e-6, label: "Time (µs)" },
  { key: "ns", factor: 1e-9, label: "Time (ns)" },
  { key: "ps", factor: 1e-12, label: "Time (ps)" },
];

/**
 * Selects the unit for a visible span: >= 120 s renders minutes, 1 s to
 * 120 s seconds, then ms/µs/ns down to the extreme sub-nanosecond (ps)
 * envelopes.
 */
export function selectTimeUnit(spanSeconds: number): TimeAxisUnit {
  if (!(spanSeconds > 0)) return TIME_AXIS_UNITS[1]!;
  if (spanSeconds >= 120) return TIME_AXIS_UNITS[0]!;
  if (spanSeconds >= 1) return TIME_AXIS_UNITS[1]!;
  if (spanSeconds >= 1e-3) return TIME_AXIS_UNITS[2]!;
  if (spanSeconds >= 1e-6) return TIME_AXIS_UNITS[3]!;
  if (spanSeconds >= 1e-9) return TIME_AXIS_UNITS[4]!;
  return TIME_AXIS_UNITS[5]!;
}

/**
 * Formats a tick value in axis units without fractional jitter: six
 * significant figures cover every tick uPlot picks, then float noise and
 * trailing zeros are trimmed ("0.30000000000000004" -> "0.3").
 */
export function formatScaledTick(
  valueSeconds: number,
  unit: TimeAxisUnit,
): string {
  const scaled = valueSeconds / unit.factor;
  return String(Number(scaled.toPrecision(6)));
}

/** Minimal uPlot-like surface the adapter touches. */
export interface TimeAxisLike {
  scales: { x?: { min?: number | null; max?: number | null } };
  axes: unknown[];
}

/** Unit boundaries: T[k] separates UNITS[k] (>=) from UNITS[k + 1] (<). */
const UNIT_BOUNDARIES: readonly number[] = [120, 1, 1e-3, 1e-6, 1e-9];

/** Relative margin a span must cross past a boundary before switching. */
const SWITCH_MARGIN = 0.05;

export interface TimeAxisAdapter {
  /** Re-evaluates the unit from the current visible span; updates the label. */
  sync: (u: TimeAxisLike) => void;
  /**
   * uPlot axis values formatter (DynamicValues-compatible): scales ticks
   * into the active unit.
   */
  values: (self: unknown, splits: number[]) => string[];
  /** The active axis title ("Time (ms)" etc.). */
  label: string;
  unit: TimeAxisUnit;
}

/**
 * Creates an isolated adapter. uPlot's setScale hook fires before the
 * frame's axes draw, so mutating the axis label inside `sync` is picked up
 * by the same redraw — no extra redraw, no feedback loop.
 */
export function createTimeAxisAdapter(): TimeAxisAdapter {
  let unit: TimeAxisUnit = TIME_AXIS_UNITS[1]!;
  let established = false;
  return {
    get label() {
      return unit.label;
    },
    get unit() {
      return unit;
    },
    sync: (u) => {
      const min = u.scales.x?.min;
      const max = u.scales.x?.max;
      if (min == null || max == null) return;
      const target = selectTimeUnit(max - min);
      if (target.key === unit.key) return;
      // Hysteresis: a span dithering across a unit boundary must not flip
      // the label/tick scaling on every micro-zoom. Switch only once the
      // span is 5% past the boundary separating the two units.
      const i = TIME_AXIS_UNITS.indexOf(unit);
      const j = TIME_AXIS_UNITS.indexOf(target);
      // Moving to a larger unit (j < i) requires the span to exceed the
      // boundary by the margin; moving to a smaller unit (j > i) requires
      // it to fall below the boundary by the margin.
      const boundary =
        UNIT_BOUNDARIES[Math.min(i, j)]! *
        (j < i ? 1 + SWITCH_MARGIN : 1 - SWITCH_MARGIN);
      const spansPastBoundary =
        j < i ? max - min >= boundary : max - min < boundary;
      if (established && !spansPastBoundary) return;
      established = true;
      unit = target as TimeAxisUnit;
      (u.axes[0] as { label?: string }).label = target.label;
    },
    values: (_self: unknown, splits: number[]) =>
      splits.map((tick) => formatScaledTick(tick, unit)),
  };
}
