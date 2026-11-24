/**
 * Stack-view lane banding (issue #250, #355): in Stack mode each channel's
 * y-axis column renders ONLY inside its own lane's vertical band —
 * ticks, tick labels, the rotated axis title, and the ground flag
 * (confined by groundFlags.ts since #249) — with subtle lane separator
 * lines spanning the plot width between adjacent lanes. Overlay mode is
 * untouched: full-height columns, no separators.
 *
 * Pure rendering module (issue #355): reads zero global Zustand stores. All
 * layout, theme, and catalog inputs arrive through an explicit `LaneLayoutState`
 * / `ChartRenderState`.
 */

import uPlot from "uplot";
import { type ChannelKey } from "./channelDisplay";
import { laneFractions } from "../../state/laneLayoutStore";
import {
  AXIS_GAP_PX,
  AXIS_LABEL_GAP_PX,
  AXIS_TICK_SIZE_PX,
  TICK_LABEL_COLLISION_HEIGHT_PX,
  TICK_LABEL_HALF_HEIGHT_PX,
  axisFont,
  cssPxRatio,
  plotHeightCss,
} from "./axesConfig";
import type { ChartRenderState, LaneLayoutState } from "./chartRenderState";

export { cssPxRatio };

/** Horizontal halo (CSS px) left around boundary tick labels so separators never strike through digits. */
const SEPARATOR_LABEL_HALO_PX = 3;
/** Resize-handle grip size on the separator midpoint (CSS px). */
export const LANE_HANDLE_WIDTH_PX = 8;
export const LANE_HANDLE_HEIGHT_PX = 18;
/** Hit-strip half-height around a separator (CSS px). */
export const LANE_HIT_HALF_PX = 8;

interface LaneAxis {
  show?: boolean;
  _pos?: number;
  _size?: number;
  _lpos?: number;
  label?: unknown;
  labelSize?: number;
  _splits?: number[];
  _values?: Array<string | number | null>;
}

/**
 * The visible lanes' bands (plot-area-relative CSS px, top-first),
 * partitioned by the active lane weights (issue #251; equal fractions
 * when no weights are stored).
 */
export interface LaneBand {
  scaleKey: string;
  key: ChannelKey;
  top: number;
  bottom: number;
}

export function laneBandsCss(u: uPlot, state: LaneLayoutState): LaneBand[] {
  const lanes = state.catalog.visibleLanes();
  const plotHeight = plotHeightCss(u);
  // Issue #251: lane weights are keyed by CHANNEL key.
  const fractions = laneFractions(
    lanes.map((lane) => lane.displayKey),
    state.laneWeights,
  );
  const bands: LaneBand[] = [];
  let top = 0;
  lanes.forEach((lane, index) => {
    const height = fractions[index]! * plotHeight;
    bands.push({
      scaleKey: lane.scaleKey,
      key: lane.displayKey,
      top,
      bottom: top + height,
    });
    top += height;
  });
  return bands;
}

/**
 * The canvas band (plot-area-relative CSS px) of one channel's lane, or
 * null when Stack mode is off / the channel has no lane.
 */
export function laneBandCss(
  u: uPlot,
  state: LaneLayoutState,
  scaleKey: string,
): { top: number; bottom: number } | null {
  if (!state.stackMode) return null;
  const band = laneBandsCss(u, state).find((b) => b.scaleKey === scaleKey);
  return band ? { top: band.top, bottom: band.bottom } : null;
}

/**
 * Fractional vertical band `[start, start + fraction]` (top-first, in `[0, 1]`)
 * of one channel's lane in Stack mode, or null when Stack mode is off or the
 * channel has no visible lane.
 */
export function laneFractionRange(
  state: LaneLayoutState,
  scaleKey: string,
): { start: number; fraction: number } | null {
  if (!state.stackMode) return null;
  const lanes = state.catalog.visibleLanes();
  const fractions = laneFractions(
    lanes.map((lane) => lane.displayKey),
    state.laneWeights,
  );
  let start = 0;
  for (let i = 0; i < lanes.length; i++) {
    const fraction = fractions[i]!;
    if (lanes[i]!.scaleKey === scaleKey) {
      return { start, fraction };
    }
    start += fraction;
  }
  return null;
}

/**
 * Visible value range `[min, max]` for one channel's scale.
 *
 * In Overlay mode this is the full scale `[scaleMin, scaleMax]`. In Stack mode,
 * uPlot's scale is stretched across the entire plot height so the trace sits in
 * its lane band `[start, start + fraction]`; this helper projects back to the
 * values visible inside that lane.
 */
export function visibleYRangeForScale(
  scaleMin: number,
  scaleMax: number,
  state: LaneLayoutState,
  scaleKey: string,
): { min: number; max: number } {
  const band = laneFractionRange(state, scaleKey);
  if (!band) return { min: scaleMin, max: scaleMax };
  const span = scaleMax - scaleMin;
  return {
    min: scaleMax - (band.start + band.fraction) * span,
    max: scaleMax - band.start * span,
  };
}

const RANGE_EPSILON_FACTOR = 1e-9;

/** True when `val` lies strictly above `max` (tolerant of floating-point edge drift). */
export function isValueAboveRange(
  val: number,
  min: number,
  max: number,
): boolean {
  const eps = Math.abs(max - min) * RANGE_EPSILON_FACTOR;
  return val > max + eps;
}

/** True when `val` lies strictly below `min` (tolerant of floating-point edge drift). */
export function isValueBelowRange(
  val: number,
  min: number,
  max: number,
): boolean {
  const eps = Math.abs(max - min) * RANGE_EPSILON_FACTOR;
  return val < min - eps;
}

/**
 * uPlot ortho-line `filter` (axis, ticks, grid): nulls out every split
 * whose canvas position lies outside the channel's lane band (identity
 * when not stacked).
 */
export function laneTickFilter(
  u: uPlot,
  state: LaneLayoutState,
  scaleKey: string,
  splits: number[],
): Array<number | null> {
  const band = laneBandCss(u, state, scaleKey);
  if (!band) return splits;
  return splits.map((value) => {
    const y = u.valToPos(value, scaleKey);
    return y >= band.top - 1 && y <= band.bottom + 1 ? value : null;
  });
}

export type AxisTickLabelValue = string | number | null;

export interface LaneLabelAxisInput {
  readonly scaleKey: string;
  readonly splits: readonly number[];
  readonly values: readonly AxisTickLabelValue[];
  readonly yPositions: readonly number[];
}

/**
 * Resolves vertical tick-label collisions at shared Stack-mode lane boundaries
 * (issue #371): when both adjacent lanes have a tick label whose vertical box
 * crosses the shared boundary, suppresses the upper lane's bottommost label
 * and keeps the lower lane's topmost label. At most one label is suppressed per
 * shared boundary; non-colliding boundaries and outer edges are untouched.
 */
export function suppressAdjacentLaneBoundaryLabels(
  bands: readonly LaneBand[],
  axesByScale: ReadonlyMap<string, LaneLabelAxisInput>,
  collisionHeightPx: number = TICK_LABEL_COLLISION_HEIGHT_PX,
): Map<string, AxisTickLabelValue[]> {
  const result = new Map<string, AxisTickLabelValue[]>();
  for (const [scaleKey, axis] of axesByScale) {
    result.set(scaleKey, [...axis.values]);
  }
  if (bands.length < 2) {
    return result;
  }

  for (let i = 0; i < bands.length - 1; i += 1) {
    const upperBand = bands[i]!;
    const lowerBand = bands[i + 1]!;
    const upperInput = axesByScale.get(upperBand.scaleKey);
    const lowerInput = axesByScale.get(lowerBand.scaleKey);
    const upperValues = result.get(upperBand.scaleKey);
    const lowerValues = result.get(lowerBand.scaleKey);
    if (!upperInput || !lowerInput || !upperValues || !lowerValues) continue;

    let upperIdx = -1;
    let upperMaxY = -Infinity;
    const upperLen = Math.min(upperValues.length, upperInput.yPositions.length);
    for (let k = 0; k < upperLen; k += 1) {
      if (upperValues[k] == null) continue;
      const y = upperInput.yPositions[k]!;
      if (Number.isFinite(y) && y > upperMaxY) {
        upperMaxY = y;
        upperIdx = k;
      }
    }

    let lowerIdx = -1;
    let lowerMinY = Infinity;
    const lowerLen = Math.min(lowerValues.length, lowerInput.yPositions.length);
    for (let k = 0; k < lowerLen; k += 1) {
      if (lowerValues[k] == null) continue;
      const y = lowerInput.yPositions[k]!;
      if (Number.isFinite(y) && y < lowerMinY) {
        lowerMinY = y;
        lowerIdx = k;
      }
    }

    if (
      upperIdx >= 0 &&
      lowerIdx >= 0 &&
      lowerMinY - upperMaxY < collisionHeightPx
    ) {
      upperValues[upperIdx] = null;
    }
  }

  return result;
}

export interface LaneAxisTitle {
  label: string;
  color: string;
}

/**
 * Subtracts `[g0, g1]` horizontal halo gaps around boundary tick labels from
 * `[start, end]` so full-width lane separators never strike through label text.
 */
export function subtractIntervals(
  start: number,
  end: number,
  gaps: readonly (readonly [number, number])[],
): Array<[number, number]> {
  if (end <= start) return [];
  const clamped: Array<[number, number]> = [];
  for (const [raw0, raw1] of gaps) {
    const g0 = Math.max(start, raw0);
    const g1 = Math.min(end, raw1);
    if (g1 > g0) {
      clamped.push([g0, g1]);
    }
  }
  clamped.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const gap of clamped) {
    const last = merged[merged.length - 1];
    if (last && gap[0] <= last[1]) {
      last[1] = Math.max(last[1], gap[1]);
    } else {
      merged.push([gap[0], gap[1]]);
    }
  }
  const result: Array<[number, number]> = [];
  let cursor = start;
  for (const [g0, g1] of merged) {
    if (g0 > cursor) {
      result.push([cursor, g0]);
    }
    cursor = Math.max(cursor, g1);
  }
  if (end > cursor) {
    result.push([cursor, end]);
  }
  return result;
}

/**
 * Draw-hook decoration for Stack mode: scopes every side-3 axis column
 * title to its lane band (erased across the strip and redrawn rotated at the
 * lane center, clipped to the band) and strokes full-opacity lane separators
 * across both the y-axis column(s) and the plot width. No-op in Overlay mode.
 */
export function drawStackLaneDecorations(
  u: uPlot,
  state: ChartRenderState,
  titles: Map<string, LaneAxisTitle>,
): void {
  if (!state.stackMode) return;
  const bands = laneBandsCss(u, state);
  if (bands.length === 0) return;

  const pxRatio = cssPxRatio(u);
  const ctx = u.ctx;
  const plotTopD = u.bbox.top;
  const plotHgtD = u.bbox.height;
  const plotLeftD = u.bbox.left;
  const plotWidD = u.bbox.width;

  ctx.save();
  const clearedStrips = new Set<number>();
  let minAxisLeftCss = Infinity;
  for (const band of bands) {
    const axis = u.axes.find((a) => a.scale === band.scaleKey) as
      LaneAxis | undefined;
    if (!axis || axis.show === false) continue;
    if (axis._pos == null || axis._size == null) continue;

    const lposCss = axis._lpos ?? axis._pos - axis._size;
    const labelSizeCss =
      axis.label != null && typeof axis.labelSize === "number"
        ? axis.labelSize
        : 0;
    minAxisLeftCss = Math.min(
      minAxisLeftCss,
      Math.max(0, lposCss - labelSizeCss),
    );
    const bandTopD = plotTopD + band.top * pxRatio;
    const bandBottomD = plotTopD + band.bottom * pxRatio;

    // Rotated title: uPlot draws it once at the plot's mid-height —
    // erase it across the full column height (clear each unique strip only once
    // so subsequent lanes in the same strip are not erased), then
    // redraw it rotated at the lane's center, clipped to the band.
    const stripLeftD = (lposCss - labelSizeCss - 2) * pxRatio;
    const stripWidthD = (labelSizeCss + 2) * pxRatio;
    const stripKey = Math.round(stripLeftD);
    if (!clearedStrips.has(stripKey)) {
      ctx.clearRect(stripLeftD, plotTopD, stripWidthD, plotHgtD);
      clearedStrips.add(stripKey);
    }
    const title = titles.get(band.scaleKey);
    if (title) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(stripLeftD, bandTopD, stripWidthD, bandBottomD - bandTopD);
      ctx.clip();
      ctx.font = axisFont(pxRatio);
      ctx.fillStyle = title.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.translate(
        (lposCss - AXIS_LABEL_GAP_PX) * pxRatio,
        (bandTopD + bandBottomD) / 2,
      );
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(title.label, 0, 0);
      ctx.restore();
    }
  }

  // Lane separators (issue #373): full-opacity theme separator color
  // spanning both the y-axis column(s) and the plot width, broken only around
  // surviving boundary tick labels so separator lines never strike through text.
  const separatorLeftD = Number.isFinite(minAxisLeftCss)
    ? minAxisLeftCss * pxRatio
    : plotLeftD;
  const separatorRightD = plotLeftD + plotWidD;
  const lineWidth = Math.max(1, Math.round(pxRatio));
  ctx.globalAlpha = 1;
  ctx.strokeStyle = state.chrome.separatorColor;
  ctx.lineWidth = lineWidth;
  ctx.font = axisFont(pxRatio);

  for (let i = 1; i < bands.length; i += 1) {
    const yBoundaryCss = bands[i]!.top;
    const rawY = plotTopD + yBoundaryCss * pxRatio;
    const yD = lineWidth % 2 === 1 ? Math.floor(rawY) + 0.5 : Math.round(rawY);
    const gaps: Array<[number, number]> = [];
    if (typeof u.valToPos === "function") {
      for (const adjBand of [bands[i - 1]!, bands[i]!]) {
        const axis = u.axes.find((a) => a.scale === adjBand.scaleKey) as
          LaneAxis | undefined;
        if (
          !axis ||
          axis.show === false ||
          axis._pos == null ||
          !Array.isArray(axis._splits) ||
          !Array.isArray(axis._values)
        ) {
          continue;
        }
        const labelRightD =
          (axis._pos - AXIS_TICK_SIZE_PX - AXIS_GAP_PX) * pxRatio;
        const haloD = SEPARATOR_LABEL_HALO_PX * pxRatio;
        const len = Math.min(axis._splits.length, axis._values.length);
        for (let k = 0; k < len; k += 1) {
          const val = axis._values[k];
          const split = axis._splits[k];
          if (
            val == null ||
            typeof split !== "number" ||
            !Number.isFinite(split)
          ) {
            continue;
          }
          const labelYCss = u.valToPos(split, adjBand.scaleKey);
          if (
            Number.isFinite(labelYCss) &&
            Math.abs(labelYCss - yBoundaryCss) <= TICK_LABEL_HALF_HEIGHT_PX + 1
          ) {
            const textWidthD = ctx.measureText(String(val)).width;
            gaps.push([labelRightD - textWidthD - haloD, labelRightD + haloD]);
          }
        }
      }
    }

    for (const [segStart, segEnd] of subtractIntervals(
      separatorLeftD,
      separatorRightD,
      gaps,
    )) {
      ctx.beginPath();
      ctx.moveTo(segStart, yD);
      ctx.lineTo(segEnd, yD);
      ctx.stroke();
    }
  }

  // Issue #251: each separator carries a small vertical grip at its
  // midpoint on the live canvas.
  if (state.chrome.drawLaneHandles && bands.length > 1) {
    const midX = plotLeftD + plotWidD / 2;
    ctx.fillStyle = state.chrome.separatorColor;
    ctx.globalAlpha = 1;
    for (let i = 1; i < bands.length; i += 1) {
      const y = plotTopD + bands[i]!.top * pxRatio;
      const w = LANE_HANDLE_WIDTH_PX * pxRatio;
      const h = LANE_HANDLE_HEIGHT_PX * pxRatio;
      ctx.beginPath();
      ctx.roundRect(midX - w / 2, y - h / 2, w, h, 2 * pxRatio);
      ctx.fill();
    }
  }
  ctx.restore();
}

const defaultPathBuilder = uPlot.paths.linear!();

/**
 * uPlot series path builder for Stack mode (issue #269): strictly clips the
 * series line stroke to its assigned lane band (`[band.top, band.bottom]`).
 * In Overlay mode (`!stackMode`), returns the unclipped default linear paths.
 */
export function laneClippedPathBuilder(
  scaleKey: string,
  getState: () => LaneLayoutState | null,
): uPlot.Series.PathBuilder {
  return (u, seriesIdx, idx0, idx1) => {
    const paths = defaultPathBuilder(u, seriesIdx, idx0, idx1);
    if (!paths) return paths;
    const state = getState();
    if (!state || !state.stackMode) {
      return paths;
    }
    const band = laneBandCss(u, state, scaleKey);
    if (!band) return paths;

    const pxRatio = cssPxRatio(u);
    const clipTop = u.bbox.top + band.top * pxRatio;
    const clipHeight = (band.bottom - band.top) * pxRatio;
    const clipLeft = u.bbox.left;
    const clipWidth = u.bbox.width;

    const uPlotAny = uPlot as unknown as {
      clipGaps?: (
        gaps: unknown,
        ori: number,
        plotLft: number,
        plotTop: number,
        plotWid: number,
        plotHgt: number,
      ) => Path2D | null;
    };
    const clip =
      (paths.gaps &&
        paths.gaps.length > 0 &&
        uPlotAny.clipGaps?.(
          paths.gaps,
          0,
          clipLeft,
          clipTop,
          clipWidth,
          clipHeight,
        )) ||
      new Path2D();
    if (!paths.gaps || paths.gaps.length === 0 || !uPlotAny.clipGaps) {
      clip.rect(clipLeft, clipTop, clipWidth, clipHeight);
    }

    return {
      ...paths,
      clip,
    };
  };
}
