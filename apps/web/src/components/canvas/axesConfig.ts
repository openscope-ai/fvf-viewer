/**
 * Unified uPlot chart specification & shared axis geometry (issues #60, #119,
 * #268, #355 / ADR 0010 Decision 5, ADR 0011 Decision 5):
 *
 * Single source of truth consumed by BOTH the live canvas (`Oscilloscope.tsx`)
 * and the offscreen PNG export (`pngSnapshot.ts`):
 * - Shared geometry constants, guarded `cssPxRatio`, `plotHeightCss`,
 *   `measureYAxisSize`, `computeYAxisSize`, and `syncUnifiedStackAxes`.
 * - `syncChartAdapters`: single Quick-Stack lane-band → Y-axis adapter sync.
 * - `buildChartSpec`: constructs uPlot scales, per-channel Y-axes, series with
 *   `laneClippedPathBuilder`, and draw/setScale hooks from an explicit
 *   `getRenderState()` getter (zero global Zustand store reads).
 */

import uPlot from "uplot";
import type { Options } from "uplot";
import type { ChartRenderState } from "./chartRenderState";
import {
  drawStackLaneDecorations,
  laneBandCss,
  laneBandsCss,
  laneClippedPathBuilder,
  laneTickFilter,
  suppressAdjacentLaneBoundaryLabels,
  type LaneAxisTitle,
  type LaneLabelAxisInput,
} from "./stackLaneDecorations";
import {
  computeGroundFlags,
  drawGroundFlags,
  suppressLabelsIntersectingGroundFlag,
} from "./groundFlags";
import {
  drawT2Glyph,
  drawTriggerGlyph,
  drawTriggerLine,
} from "./triggerMarker";
import { slippedTriggerTime } from "./timeSlip";
import type { TimeAxisAdapter } from "./timeAxis";
import type { YAxisAdapter } from "./yAxis";
import {
  deleteYAxisSizeCacheEntry,
  getYAxisSizeCache,
  setUnifiedStackAxisGeometry,
  setYAxisSizeCacheEntry,
} from "./viewportController";

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

export const AXIS_FONT_SIZE_PX = 11;
/** Half-height (CSS px) of a vertically centered 11px y-axis tick label. */
export const TICK_LABEL_HALF_HEIGHT_PX = 6;
/** Minimum vertical center-to-center distance (CSS px) before two boundary tick labels collide. */
export const TICK_LABEL_COLLISION_HEIGHT_PX = TICK_LABEL_HALF_HEIGHT_PX * 2 + 1;

export const AXIS_FONT = `${AXIS_FONT_SIZE_PX}px system-ui, -apple-system, sans-serif`;

/** Canvas font string scaled by device-pixel ratio for unscaled 2D contexts (issue #270). */
export function axisFont(pxRatio: number = 1): string {
  return `${AXIS_FONT_SIZE_PX * pxRatio}px system-ui, -apple-system, sans-serif`;
}

/**
 * Resolves the effective device pixel ratio for a uPlot instance (issues #250, #349, #355).
 * Single guarded implementation shared across all renderers: avoids uncommitted
 * HTML5 canvas default 300x150 dimensions blowing up offscreen ratios.
 */
export function cssPxRatio(u?: uPlot | null): number {
  const uCtor = (u?.constructor as unknown as { pxRatio?: number }) ?? uPlot;
  const fallback =
    uCtor?.pxRatio ||
    (typeof window !== "undefined" ? window.devicePixelRatio : 1) ||
    1;
  if (u && u.width > 0 && u.ctx?.canvas && u.ctx.canvas.width > 0) {
    const canvas = u.ctx.canvas;
    // An uncommitted HTML5 canvas has the default 300x150 dimensions.
    const isUncommittedDefault =
      canvas.width === 300 &&
      canvas.height === 150 &&
      (u.width !== 300 || u.height !== 150 || fallback !== 1);
    if (!isUncommittedDefault && (canvas.width !== 300 || u.width === 300)) {
      return canvas.width / u.width;
    }
  }
  return fallback;
}

/** Effective plot-area height in CSS px, with a safe pre-layout fallback. */
export function plotHeightCss(u: uPlot): number {
  const pxRatio = cssPxRatio(u);
  return u.bbox.height > 0
    ? u.bbox.height / pxRatio
    : Math.max(
        (u.height > 0 ? u.height : 400) -
          CANVAS_PADDING[0] -
          CANVAS_PADDING[2] -
          AXIS_SIZE_X_PX,
        100,
      );
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
 * computes width allotted for tick values, tick marks, and axis gap:
 *   size = ceil(widestTickWidth + tickSize + axisGap)
 * Combined with axis.labelSize (rotated title extent), total column width is:
 *   columnWidth = size + labelSize
 */
export function measureYAxisSize(
  values: (string | number | null)[] | null | undefined,
  _ctx?: CanvasRenderingContext2D | null,
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

/**
 * Dynamic sizing for Y-axis columns in both Overlay and Stack modes (issue #268):
 * - In Overlay mode: each visible channel has its own staggered column whose size
 *   is measured from its tick values.
 * - In Stack mode: all channel Y-axes horizontally align into a single column on
 *   the left edge of the canvas.
 */
export function computeYAxisSize(
  self: uPlot | null | undefined,
  values: (string | number | null)[] | null | undefined,
  scaleKey: string,
  isStacked: boolean,
): number {
  const measured = measureYAxisSize(values);
  if (!isStacked || !self || !self.axes) {
    if (self?.axes) {
      const ax = self.axes.find((a) => a.scale === scaleKey);
      if (ax) {
        ax.labelSize = AXIS_LABEL_SIZE_PX;
      }
      deleteYAxisSizeCacheEntry(self, scaleKey);
    }
    return measured;
  }
  const cache = setYAxisSizeCacheEntry(self, scaleKey, measured);

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
  const pxRatio = cssPxRatio(u);
  const plotLeftCss = u.bbox.left / pxRatio;
  const cache = getYAxisSizeCache(u);
  const unifiedSize =
    cache && cache.size > 0
      ? Math.max(
          Math.ceil(30 + AXIS_TICK_SIZE_PX + AXIS_GAP_PX),
          ...cache.values(),
        )
      : Math.ceil(30 + AXIS_TICK_SIZE_PX + AXIS_GAP_PX);

  setUnifiedStackAxisGeometry(u, plotLeftCss, unifiedSize);
}

/**
 * Syncs Y-axis SI unit adapters against the current uPlot instance, passing
 * physical lane band fractions in Stack mode (issues #270, #355).
 * Single source of truth shared by both live rendering and offscreen PNG export.
 */
export function syncChartAdapters(
  u: uPlot,
  state: ChartRenderState,
  adapters: ReadonlyMap<number, YAxisAdapter>,
): void {
  const plotHeight = plotHeightCss(u);
  for (const adapter of adapters.values()) {
    if (state.stackMode) {
      const band = laneBandCss(u, state, adapter.scaleKey);
      if (band && plotHeight > 0) {
        adapter.sync(u, {
          laneFraction: (band.bottom - band.top) / plotHeight,
          bandStart: band.top / plotHeight,
        });
        continue;
      }
    }
    adapter.sync(u);
  }
}

/**
 * Syncs a single Y-axis adapter against an explicit bounds pair (pre-mount
 * seeding before a uPlot instance exists).
 */
export function syncAdapterToBounds(
  adapter: YAxisAdapter,
  bounds: { min: number; max: number },
  laneSpan?: { laneFraction: number; bandStart: number },
): void {
  const scaleLike = {
    scales: { [adapter.scaleKey]: { min: bounds.min, max: bounds.max } },
    axes: [],
  };
  if (laneSpan) {
    adapter.sync(scaleLike, laneSpan);
  } else {
    adapter.sync(scaleLike);
  }
}

export interface BuildChartSpecInput {
  readonly width: number;
  readonly height: number;
  readonly xBounds: { readonly min: number; readonly max: number };
  readonly yBounds: ReadonlyMap<
    string,
    { readonly min: number; readonly max: number }
  >;
  readonly timeAxis: TimeAxisAdapter;
  readonly yAdapters: ReadonlyMap<number, YAxisAdapter>;
  readonly getRenderState: () => ChartRenderState;
  /**
   * When true (live canvas), every Y-axis is initialized with `show: true` so
   * uPlot's `initAxis` configures default spacing/split functions (issue #338)
   * and visibility is applied immediately after construction.
   * When false (offscreen print), each axis's `show` mirrors `ch.visible`.
   */
  readonly initAllAxesShown?: boolean;
  /** Scale key of the selected channel owning the horizontal graticule grid. */
  readonly selectedScaleKey?: string | null;
  /** Draw ground flags inside the chart-spec `draw` hook (offscreen print pass). */
  readonly drawGroundFlagsInHook?: boolean;
  /** Draw the File 2 T2 glyph inside the chart-spec `draw` hook (offscreen print pass). */
  readonly drawT2InHook?: boolean;
  readonly cursor?: Options["cursor"];
  readonly legend?: Options["legend"];
  readonly select?: Options["select"];
  readonly plugins?: Options["plugins"];
  readonly onSetScale?: (u: uPlot) => void;
  readonly onSetSelect?: (u: uPlot) => void;
  readonly onReady?: (u: uPlot) => void;
}

interface InternalAxisValues {
  scale?: string;
  side?: number;
  show?: boolean;
  _splits?: number[];
  _values?: Array<string | number | null>;
}

const rawAxisValuesCache = new WeakMap<
  object,
  {
    baseValues: readonly (string | number | null)[];
    lastAssigned: Array<string | number | null>;
  }
>();

function resolveBaseAxisValues(
  axis: InternalAxisValues,
): readonly (string | number | null)[] | null {
  const current = axis._values;
  if (!Array.isArray(current)) return null;
  const cached = rawAxisValuesCache.get(axis);
  if (cached && cached.lastAssigned === current) {
    return cached.baseValues;
  }
  const baseValues = [...current];
  rawAxisValuesCache.set(axis, { baseValues, lastAssigned: current });
  return baseValues;
}

function assignAxisValues(
  axis: InternalAxisValues,
  next: Array<string | number | null>,
): void {
  const cached = rawAxisValuesCache.get(axis);
  if (cached) {
    cached.lastAssigned = next;
  }
  axis._values = next;
}

function applyYAxisLabelSuppression(u: uPlot, state: ChartRenderState): void {
  if (!Array.isArray(u.axes) || typeof u.valToPos !== "function") return;
  const axesByScale = new Map<
    string,
    { axis: InternalAxisValues; input: LaneLabelAxisInput }
  >();

  for (let i = 1; i < u.axes.length; i += 1) {
    const axis = u.axes[i] as InternalAxisValues | undefined;
    if (!axis || axis.show === false || axis.side !== 3 || !axis.scale) {
      continue;
    }
    const baseValues = resolveBaseAxisValues(axis);
    const splits = axis._splits;
    if (!baseValues || !Array.isArray(splits)) continue;

    const scaleKey = axis.scale;
    const yPositions = splits.map((val) =>
      val == null ? Number.NaN : u.valToPos(val, scaleKey),
    );
    axesByScale.set(scaleKey, {
      axis,
      input: {
        scaleKey,
        splits,
        values: baseValues,
        yPositions,
      },
    });
  }

  let valuesByScale: Map<string, Array<string | number | null>>;
  if (state.stackMode) {
    const bands = laneBandsCss(u, state);
    const inputMap = new Map<string, LaneLabelAxisInput>();
    for (const [scaleKey, entry] of axesByScale) {
      inputMap.set(scaleKey, entry.input);
    }
    valuesByScale = suppressAdjacentLaneBoundaryLabels(bands, inputMap);
  } else {
    valuesByScale = new Map();
    for (const [scaleKey, entry] of axesByScale) {
      valuesByScale.set(scaleKey, [...entry.input.values]);
    }
  }

  for (const flag of computeGroundFlags(u, state)) {
    const entry = axesByScale.get(flag.scaleKey);
    const current = valuesByScale.get(flag.scaleKey);
    if (!entry || !current) continue;
    valuesByScale.set(
      flag.scaleKey,
      suppressLabelsIntersectingGroundFlag(
        current,
        entry.input.yPositions,
        flag,
        TICK_LABEL_HALF_HEIGHT_PX + 0.5,
      ),
    );
  }

  for (const [scaleKey, entry] of axesByScale) {
    const next = valuesByScale.get(scaleKey);
    if (next) {
      assignAxisValues(entry.axis, next);
    }
  }
}

/**
 * Unified uPlot `Options` builder (issue #355, ADR 0010 Decision 5):
 * constructs scales, X and per-channel Y axes, series with lane-clipped path
 * builders, and shared draw/setScale hooks for both the live canvas and the
 * offscreen PNG print renderer.
 */
export function buildChartSpec(input: BuildChartSpecInput): Options {
  const {
    width,
    height,
    xBounds,
    yBounds,
    timeAxis,
    yAdapters,
    getRenderState,
    initAllAxesShown = false,
    selectedScaleKey = null,
    drawGroundFlagsInHook = false,
    drawT2InHook = false,
    cursor,
    legend,
    select,
    plugins,
    onSetScale,
    onSetSelect,
    onReady,
  } = input;

  const initialState = getRenderState();
  const { catalog } = initialState;

  // Left axes registered in reverse channel file order within each slot:
  // primary channels innermost-to-outermost, then reference columns continuing leftward.
  const orderedAxisChannels = [
    ...[...catalog.primary].reverse(),
    ...[...catalog.reference].reverse(),
  ];

  return {
    width,
    height,
    padding: CANVAS_PADDING,
    ...(cursor !== undefined ? { cursor } : {}),
    ...(legend !== undefined ? { legend } : {}),
    ...(select !== undefined ? { select } : {}),
    ...(plugins !== undefined ? { plugins } : {}),
    scales: {
      x: {
        time: false,
        auto: false,
        min: xBounds.min,
        max: xBounds.max,
      },
      ...Object.fromEntries(
        catalog.channels.map((ch) => {
          const bounds = yBounds.get(ch.scaleKey) ?? { min: -1, max: 1 };
          return [
            ch.scaleKey,
            { auto: false, min: bounds.min, max: bounds.max },
          ];
        }),
      ),
    },
    axes: [
      {
        scale: "x",
        stroke: () => getRenderState().chrome.axisText,
        grid: {
          show: !initialState.chrome.omitGrid,
          stroke: () => getRenderState().chrome.grid,
          width: 1,
        },
        ticks: {
          show: true,
          stroke: () => getRenderState().chrome.ticks,
          width: 1,
          size: AXIS_TICK_SIZE_PX,
        },
        font: AXIS_FONT,
        label: timeAxis.label,
        labelFont: AXIS_FONT,
        size: AXIS_SIZE_X_PX,
        gap: AXIS_GAP_PX,
        labelGap: AXIS_LABEL_GAP_PX,
        values: timeAxis.values,
      },
      ...orderedAxisChannels.map((ch) => {
        const adapter = yAdapters.get(ch.channelIndex);
        const isSelected =
          ch.slot === "primary" &&
          (selectedScaleKey !== null
            ? ch.scaleKey === selectedScaleKey
            : ch.selected);
        return {
          scale: ch.scaleKey,
          side: 3,
          filter: (self: uPlot, splits: number[]) =>
            laneTickFilter(self, getRenderState(), ch.scaleKey, splits),
          show: initAllAxesShown ? true : ch.visible,
          grid: {
            show: isSelected && !initialState.chrome.omitGrid,
            stroke: () => getRenderState().chrome.grid,
            width: 1,
            filter: (self: uPlot, splits: number[]) =>
              laneTickFilter(self, getRenderState(), ch.scaleKey, splits),
          },
          ticks: {
            show: true,
            stroke: () => getRenderState().chrome.ticks,
            width: 1,
            size: AXIS_TICK_SIZE_PX,
            filter: (self: uPlot, splits: number[]) =>
              laneTickFilter(self, getRenderState(), ch.scaleKey, splits),
          },
          stroke: () => {
            const state = getRenderState();
            const liveCh = state.catalog.byScaleKey(ch.scaleKey) ?? ch;
            return state.chrome.channelColor(liveCh);
          },
          font: AXIS_FONT,
          label: adapter?.label ?? ch.axisQuantity,
          labelFont: AXIS_FONT,
          labelSize: AXIS_LABEL_SIZE_PX,
          gap: AXIS_GAP_PX,
          labelGap: AXIS_LABEL_GAP_PX,
          size: (self: uPlot, values: (string | number | null)[]) =>
            computeYAxisSize(
              self,
              values,
              ch.scaleKey,
              getRenderState().stackMode,
            ),
          values: (self: unknown, splits: number[]) =>
            yAdapters.get(ch.channelIndex)?.values(self, splits) ??
            splits.map((v) => (v == null ? null : String(v))),
        };
      }),
    ],
    series: [
      { label: "Time" },
      ...catalog.channels.map((ch) => ({
        label: ch.displayName,
        scale: ch.scaleKey,
        stroke: initialState.chrome.channelStroke(ch),
        width: 1.5,
        points: { show: false },
        show: ch.visible,
        paths: laneClippedPathBuilder(ch.scaleKey, getRenderState),
      })),
    ],
    hooks: {
      drawClear: [
        (u) => {
          const state = getRenderState();
          if (state.stackMode) {
            syncUnifiedStackAxes(u);
          }
          applyYAxisLabelSuppression(u, state);
          if (state.chrome.fillBackground) {
            u.ctx.save();
            u.ctx.fillStyle = state.chrome.background;
            u.ctx.fillRect(0, 0, u.bbox.width, u.bbox.height);
            u.ctx.restore();
          }
        },
      ],
      drawAxes: [
        (u) => {
          const state = getRenderState();
          drawTriggerLine(u, state.chrome.triggerAccent);
        },
      ],
      draw: [
        (u) => {
          const state = getRenderState();
          drawTriggerGlyph(
            u,
            state.chrome.triggerAccent,
            state.chrome.triggerGlyphClear,
          );
          if (drawT2InHook && state.t2) {
            drawT2Glyph(
              u,
              state.t2.accentColor,
              state.chrome.triggerGlyphClear,
              slippedTriggerTime(
                state.capture.timestamps,
                state.t2.timeSlipSamples,
              ),
            );
          }
          syncChartAdapters(u, state, yAdapters);
          const laneTitles = new Map<string, LaneAxisTitle>();
          state.catalog.channels.forEach((ch) => {
            const adapter = yAdapters.get(ch.channelIndex);
            if (!adapter) return;
            laneTitles.set(ch.scaleKey, {
              label: adapter.label,
              color: state.chrome.channelColor(ch),
            });
          });
          drawStackLaneDecorations(u, state, laneTitles);
          if (drawGroundFlagsInHook) {
            drawGroundFlags(
              u,
              computeGroundFlags(u, state),
              state.chrome.groundFlagText,
            );
          }
        },
      ],
      setScale: [
        (u) => {
          const state = getRenderState();
          timeAxis.sync(u);
          syncChartAdapters(u, state, yAdapters);
          onSetScale?.(u);
        },
      ],
      ...(onSetSelect ? { setSelect: [onSetSelect] } : {}),
      ...(onReady ? { ready: [onReady] } : {}),
    },
  };
}
