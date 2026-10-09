/**
 * Shared uPlot axis geometry (issue #60, per-channel dynamic sizing: issue #119 / ADR 0011):
 * a single source of truth for axis sizes, paddings, and measured sizing used by
 * BOTH the live canvas (Oscilloscope.tsx) and the offscreen print render (pngSnapshot.ts),
 * so exported PNG snapshots share identical axis geometry with the live viewport by construction.
 *
 * ADR 0011 Decision 5: The fixed 72px Y axis is replaced with a shared measured sizing
 * function (widest tick label + tight gaps + rotated title extent).
 * live canvas and PNG snapshot have zero dead space with short SI ticks and no overlap
 * with wide decimal ticks.
 */

import type uPlot from "uplot";

export const AXIS_SIZE_X_PX = 30;
/** Padding between tick marks and tick numbers (CSS px). */
export const AXIS_GAP_PX = 6;
/** Padding between tick numbers and the rotated axis title (CSS px). */
export const AXIS_LABEL_GAP_PX = 6;
/** Length of tick marks in CSS px. */
export const AXIS_TICK_SIZE_PX = 10;
/**
 * Width reserved for the rotated title column in CSS px (issue #144):
 * uPlot centers a side-3 title at `_lpos - AXIS_LABEL_GAP_PX` with
 * textBaseline "bottom", so glyph ink extends left of that origin by up
 * to the 11px font ascent (~11px + antialiasing). 6 + 11 + 3 margin = 20
 * keeps every title inside its own column, clear of the neighboring
 * axis tick marks. Shared by the live canvas and the PNG export.
 */
export const AXIS_LABEL_SIZE_PX = 20;

/**
 * Canvas padding [top, right, bottom, left] in CSS px (issue #85).
 * Top padding provides 18px of headroom for the trigger glyph pinned
 * in the margin above the graticule top border.
 */
export const CANVAS_PADDING: [number, number, number, number] = [
  18, 12, 10, 10,
];

export const AXIS_FONT = "11px system-ui, -apple-system, sans-serif";

/** Canvas font string scaled by device-pixel ratio for unscaled 2D contexts (issue #270). */
export function axisFont(pxRatio: number = 1): string {
  return `${11 * pxRatio}px system-ui, -apple-system, sans-serif`;
}

let measurementContext: CanvasRenderingContext2D | null = null;
function getMeasurementContext(): CanvasRenderingContext2D | null {
  if (!measurementContext && typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    measurementContext = canvas.getContext("2d");
  }
  return measurementContext;
}

/**
 * Shared measured sizing function for Y-axis columns:
 * computes width alloted for tick values, tick marks, and axis gap:
 *   size = ceil(widestTickWidth + tickSize + axisGap)
 * Combined with axis.labelSize (rotated title extent), total column width is:
 *   columnWidth = size + labelSize
 * Used by BOTH Oscilloscope.tsx and pngSnapshot.ts.
 */
export function measureYAxisSize(
  values: (string | number | null)[] | null | undefined,
  ctx?: CanvasRenderingContext2D | null,
  font: string = AXIS_FONT,
  tickSize: number = AXIS_TICK_SIZE_PX,
  gap: number = AXIS_GAP_PX,
): number {
  if (!values || values.length === 0) {
    return Math.ceil(30 + tickSize + gap);
  }
  let maxTickWidth = 0;
  // AC3 (issue #130): Always isolate measurement on an offscreen canvas context
  // so uPlot.ctx.font on the main render canvas is never mutated or overridden.
  const measurer = getMeasurementContext();

  if (measurer) {
    measurer.font = font;
    for (const val of values) {
      if (val != null) {
        const text = String(val);
        const w = measurer.measureText(text).width;
        if (w > maxTickWidth) maxTickWidth = w;
      }
    }
  } else {
    for (const val of values) {
      if (val != null) {
        const len = String(val).length;
        const w = len * 7;
        if (w > maxTickWidth) maxTickWidth = w;
      }
    }
  }

  return Math.ceil(maxTickWidth + tickSize + gap);
}

export interface AxisColorSet {
  axisText: string;
  grid: string;
  ticks: string;
}

export interface BuiltAxisOptions {
  scale: string;
  side?: number;
  show?: boolean;
  /** Optional tick formatter (uPlot axis `values`), e.g. time units. */
  values?: (self: unknown, splits: number[]) => string[];
  stroke: string | ((self: unknown, axisIdx: number) => string);
  grid: {
    show?: boolean;
    stroke: string | ((self: unknown, axisIdx: number) => string);
    width: number;
  };
  ticks: {
    show?: boolean;
    stroke: string | ((self: unknown, axisIdx: number) => string);
    width: number;
    size?: number;
  };
  font: string;
  label:
    | string
    | ((
        self: unknown,
        axisIdx: number,
        foundIncr: number,
        foundSpace: number,
      ) => string);
  labelFont: string;
  labelSize?: number;
  size:
    | number
    | ((
        self: unknown,
        values: (string | number | null)[],
        axisIdx?: number,
        cycleNum?: number,
      ) => number);
  gap: number;
  labelGap: number;
}

export interface YAxisSpec {
  scaleKey: string;
  label: string;
  color: string;
  show: boolean;
  showGrid: boolean;
  gridColor: string;
  ticksColor: string;
  values?: (self: unknown, splits: number[]) => string[];
}

/**
 * Dynamic sizing for Y-axis columns in both Overlay and Stack modes (issue #268):
 * - In Overlay mode: each visible channel has its own staggered column whose size
 *   is measured from its tick values.
 * - In Stack mode: all channel Y-axes horizontally align into a single column on
 *   the left edge of the canvas. To let uPlot allocate only a single column width
 *   (expanding the waveform plot area to the left) and align all axes to the graticule,
 *   the last active side-3 axis allocates the unified width (the widest active axis),
 *   while all earlier side-3 axes allocate size 0.
 */
export function computeYAxisSize(
  self: uPlot | null | undefined,
  values: (string | number | null)[] | null | undefined,
  scaleKey: string,
  isStacked: boolean,
): number {
  const measured = measureYAxisSize(values);
  if (!isStacked || !self || !self.axes) {
    return measured;
  }
  const cache = ((
    self as unknown as { _yAxisSizeCache?: Map<string, number> }
  )._yAxisSizeCache ??= new Map());
  cache.set(scaleKey, measured);

  // Stack mode: single column sized to the widest active lane axis.
  const unifiedSize = Math.max(
    Math.ceil(30 + AXIS_TICK_SIZE_PX + AXIS_GAP_PX),
    ...cache.values(),
  );

  let lastActiveKey: string | null = null;
  for (let i = 1; i < self.axes.length; i++) {
    const ax = self.axes[i];
    if (ax && ax.side === 3 && ax.show !== false) {
      lastActiveKey = ax.scale ?? null;
    }
  }

  const isLast = lastActiveKey === scaleKey;
  const ax = self.axes.find((a) => a.scale === scaleKey);
  if (ax) {
    ax.labelSize = isLast ? AXIS_LABEL_SIZE_PX : 0;
  }

  return isLast ? unifiedSize : 0;
}

/**
 * Aligns all active side-3 channel Y-axes into a single horizontal column
 * adjacent to the graticule in Stack mode (issue #268).
 */
export function syncUnifiedStackAxes(u: uPlot): void {
  const pxRatio = u.width > 0 ? u.ctx.canvas.width / u.width : 1;
  const plotLeftCss = u.bbox.left / pxRatio;
  const cache = (u as unknown as { _yAxisSizeCache?: Map<string, number> })
    ._yAxisSizeCache;
  const unifiedSize =
    cache && cache.size > 0
      ? Math.max(
          Math.ceil(30 + AXIS_TICK_SIZE_PX + AXIS_GAP_PX),
          ...cache.values(),
        )
      : Math.ceil(30 + AXIS_TICK_SIZE_PX + AXIS_GAP_PX);

  for (let i = 1; i < u.axes.length; i++) {
    const ax = u.axes[i] as
      | {
          side?: number;
          show?: boolean;
          _pos?: number;
          _size?: number;
          _lpos?: number;
          labelSize?: number;
        }
      | undefined;
    if (ax && ax.side === 3 && ax.show !== false) {
      ax._pos = plotLeftCss;
      ax._size = unifiedSize;
      ax._lpos = plotLeftCss - unifiedSize;
      ax.labelSize = AXIS_LABEL_SIZE_PX;
    }
  }
}

/**
 * Builds a per-channel Y axis option object with measured sizing.
 */
export function buildYAxisOptions(
  spec: YAxisSpec,
  isStacked = false,
): BuiltAxisOptions {
  return {
    scale: spec.scaleKey,
    side: 3,
    show: spec.show,
    stroke: spec.color,
    grid: {
      show: spec.showGrid,
      stroke: spec.gridColor,
      width: 1,
    },
    ticks: {
      show: true,
      stroke: spec.ticksColor,
      width: 1,
      size: AXIS_TICK_SIZE_PX,
    },
    font: AXIS_FONT,
    label: spec.label,
    labelFont: AXIS_FONT,
    labelSize: AXIS_LABEL_SIZE_PX,
    gap: AXIS_GAP_PX,
    labelGap: AXIS_LABEL_GAP_PX,
    size: (self: unknown, values: (string | number | null)[]) =>
      computeYAxisSize(self as uPlot, values, spec.scaleKey, isStacked),
    values: spec.values,
  };
}

/**
 * Builds the X (time) and optional default Y axis options with shared geometry.
 */
export function buildAxesOptions(
  colors: AxisColorSet,
  labels: { x: string; y: string },
): [BuiltAxisOptions, BuiltAxisOptions] {
  return [
    {
      scale: "x",
      stroke: colors.axisText,
      grid: { show: true, stroke: colors.grid, width: 1 },
      ticks: {
        show: true,
        stroke: colors.ticks,
        width: 1,
        size: AXIS_TICK_SIZE_PX,
      },
      font: AXIS_FONT,
      label: labels.x,
      labelFont: AXIS_FONT,
      size: AXIS_SIZE_X_PX,
      gap: AXIS_GAP_PX,
      labelGap: AXIS_LABEL_GAP_PX,
    },
    {
      scale: "y",
      side: 3,
      stroke: colors.axisText,
      grid: { show: true, stroke: colors.grid, width: 1 },
      ticks: {
        show: true,
        stroke: colors.ticks,
        width: 1,
        size: AXIS_TICK_SIZE_PX,
      },
      font: AXIS_FONT,
      label: labels.y,
      labelFont: AXIS_FONT,
      labelSize: AXIS_LABEL_SIZE_PX,
      size: (_self: unknown, values: (string | number | null)[]) =>
        measureYAxisSize(values),
      gap: AXIS_GAP_PX,
      labelGap: AXIS_LABEL_GAP_PX,
    },
  ];
}
