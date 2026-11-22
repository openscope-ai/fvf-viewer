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
  AXIS_LABEL_GAP_PX,
  axisFont,
  cssPxRatio,
  plotHeightCss,
} from "./axesConfig";
import type { ChartRenderState, LaneLayoutState } from "./chartRenderState";

export { cssPxRatio };

/** Lane separator alpha ("subtle", theme grid color). */
const SEPARATOR_ALPHA = 0.5;
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

export interface LaneAxisTitle {
  label: string;
  color: string;
}

/**
 * Draw-hook decoration for Stack mode: scopes every side-3 axis column
 * title to its lane band (erased across the strip and redrawn rotated at the
 * lane center, clipped to the band) and strokes the lane separators across
 * the plot width. No-op in Overlay mode.
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

  // Lane separators: one subtle line per band boundary, spanning the
  // full plot width (theme grid color or print separator color, low alpha).
  ctx.globalAlpha = SEPARATOR_ALPHA;
  ctx.strokeStyle = state.chrome.separatorColor;
  ctx.lineWidth = Math.max(1, pxRatio);
  for (let i = 1; i < bands.length; i += 1) {
    const y = plotTopD + bands[i]!.top * pxRatio;
    ctx.beginPath();
    ctx.moveTo(plotLeftD, y);
    ctx.lineTo(plotLeftD + plotWidD, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Issue #251: each separator carries a small vertical grip at its
  // midpoint on the live canvas.
  if (state.chrome.drawLaneHandles && bands.length > 1) {
    const midX = plotLeftD + plotWidD / 2;
    for (let i = 1; i < bands.length; i += 1) {
      const y = plotTopD + bands[i]!.top * pxRatio;
      ctx.fillStyle = state.chrome.grid;
      ctx.globalAlpha = Math.min(1, SEPARATOR_ALPHA + 0.3);
      const w = LANE_HANDLE_WIDTH_PX * pxRatio;
      const h = LANE_HANDLE_HEIGHT_PX * pxRatio;
      ctx.beginPath();
      ctx.roundRect(midX - w / 2, y - h / 2, w, h, 2 * pxRatio);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
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
