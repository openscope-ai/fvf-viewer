/**
 * Stack-view lane banding (issue #250): in Stack mode each channel's
 * y-axis column renders ONLY inside its own lane's vertical band —
 * ticks, tick labels, the rotated axis title, and the ground flag
 * (confined by groundFlags.ts since #249) — with subtle lane separator
 * lines spanning the plot width between adjacent lanes. Overlay mode is
 * untouched: full-height columns, no separators.
 *
 * Mechanism (shared by the live viewport and the PNG print render so
 * both export paths stay in parity):
 *
 * - Tick marks + tick labels are uPlot's own rendering, confined by an
 *   axis `filter` that keeps only the splits whose canvas position lies
 *   inside the channel's lane band (position-based, so per-lane pan/zoom
 *   keeps working: whatever the window, ticks never leave the band).
 * - The rotated axis title and the column's border line are post-drawn
 *   surfaces: uPlot always draws the title at the plot's mid-height and
 *   the border across the full height, so the draw hook erases both
 *   outside/above-band regions and redraws the title rotated at the
 *   lane's center, clipped to the band.
 * - Separators stroke the theme grid color at low alpha across the plot
 *   width at each band boundary.
 */

import uPlot from "uplot";
import { displayKeyForChannel, type ChannelKey } from "./channelDisplay";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import {
  useReferenceStore,
  refChannelName as toRefName,
} from "../../state/referenceStore";
import { useViewportStore } from "../../state/viewportStore";
import { useThemeStore } from "../../state/themeStore";
import { laneFractions, useLaneLayoutStore } from "../../state/laneLayoutStore";
import { resolveThemePalette } from "./themePalette";
import { AXIS_FONT, AXIS_LABEL_GAP_PX } from "./axesConfig";
import { yScaleKey } from "../../capture/channelUnits";
import type { ParsedCapture } from "../../types/capture";

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

function cssPxRatio(u: uPlot): number {
  return u.width > 0 ? u.ctx.canvas.width / u.width : 1;
}

/**
 * The visible-channel lane enumeration, top-first: primary channels in
 * file order, then visible reference channels (exactly the #98 stack
 * partitioning order — one source of truth for the stack effect, the
 * ground flags, the lane decorations, and the lane-resize handles).
 * Each lane carries its uPlot scale key AND its channel key (the lane
 * weights are keyed by channel).
 */
export interface LaneChannel {
  scaleKey: string;
  key: ChannelKey;
  label: string;
}

export function visibleLaneChannels(capture: ParsedCapture): LaneChannel[] {
  const viewport = useViewportStore.getState();
  const reference = useReferenceStore.getState();
  const lanes: LaneChannel[] = [];
  capture.channels.forEach((channel, index) => {
    if (!viewport.activeChannels.includes(channel.name)) return;
    const key = displayKeyForChannel(channel.name);
    if (!key) return;
    lanes.push({
      scaleKey: yScaleKey(index),
      key,
      label: channel.name,
    });
  });
  (reference.lanes ?? []).forEach((_lane, refIdx) => {
    const raw = reference.capture?.channels[refIdx];
    const name = raw ? toRefName(raw.name) : `Ref-${refIdx}`;
    if (!reference.refActiveChannels.includes(name)) return;
    const key = displayKeyForChannel(name);
    if (!key) return;
    lanes.push({
      scaleKey: yScaleKey(capture.channels.length + refIdx),
      key,
      label: name,
    });
  });
  return lanes;
}

/** The visible lanes' uPlot scale keys (see visibleLaneChannels). */
export function visibleLaneScaleKeys(capture: ParsedCapture): string[] {
  return visibleLaneChannels(capture).map((lane) => lane.scaleKey);
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

export function laneBandsCss(u: uPlot, capture: ParsedCapture): LaneBand[] {
  const lanes = visibleLaneChannels(capture);
  const pxRatio = cssPxRatio(u);
  const plotHeight = u.bbox.height / pxRatio;
  // Issue #251: lane weights are keyed by CHANNEL key.
  const fractions = laneFractions(
    lanes.map((lane) => lane.key),
    useLaneLayoutStore.getState().weights,
  );
  const bands: LaneBand[] = [];
  let top = 0;
  lanes.forEach((lane, index) => {
    const height = fractions[index]! * plotHeight;
    bands.push({ ...lane, top, bottom: top + height });
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
  capture: ParsedCapture,
  scaleKey: string,
): { top: number; bottom: number } | null {
  if (!useChannelDisplayStore.getState().stackMode) return null;
  const band = laneBandsCss(u, capture).find((b) => b.scaleKey === scaleKey);
  return band ? { top: band.top, bottom: band.bottom } : null;
}

/**
 * uPlot ortho-line `filter` (axis, ticks, grid): nulls out every split
 * whose canvas position lies outside the channel's lane band (identity
 * when not stacked). uPlot's convention requires a SAME-LENGTH array
 * with nulls for dropped entries — labels skip nulls while keeping
 * index alignment with the split positions, and drawOrthoLines skips
 * nulled tick/grid marks.
 */
export function laneTickFilter(
  u: uPlot,
  capture: ParsedCapture,
  scaleKey: string,
  splits: number[],
): Array<number | null> {
  const band = laneBandCss(u, capture, scaleKey);
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
 * to its lane band (border erase outside the band, rotated title erased
 * and redrawn at the lane center, clipped to the band) and strokes the
 * lane separators across the plot width. No-op in Overlay mode.
 *
 * `titles` carries, per scale key, the rotated title text and its
 * stroke color (theme/palette-resolved by the caller; the print render
 * passes its contrast-adapted colors).
 */
export function drawStackLaneDecorations(
  u: uPlot,
  capture: ParsedCapture,
  titles: Map<string, LaneAxisTitle>,
  separatorColorOverride?: string,
): void {
  if (!useChannelDisplayStore.getState().stackMode) return;
  const keys = visibleLaneScaleKeys(capture);
  const laneCount = keys.length;
  if (laneCount === 0) return;

  const pxRatio = cssPxRatio(u);
  const ctx = u.ctx;
  const plotTopD = u.bbox.top;
  const plotHgtD = u.bbox.height;
  const plotLeftD = u.bbox.left;
  const plotWidD = u.bbox.width;
  const palette = resolveThemePalette(useThemeStore.getState().theme);

  ctx.save();
  for (const scaleKey of keys) {
    const axis = u.axes.find((a) => a.scale === scaleKey) as
      LaneAxis | undefined;
    if (!axis || axis.show === false) continue;
    if (axis._pos == null || axis._size == null) continue;
    const band = laneBandCss(u, capture, scaleKey);
    if (!band) continue;

    const posD = axis._pos * pxRatio;
    const lposCss = axis._lpos ?? axis._pos - axis._size;
    const labelSizeCss =
      axis.label != null && typeof axis.labelSize === "number"
        ? axis.labelSize
        : 0;
    const bandTopD = plotTopD + band.top * pxRatio;
    const bandBottomD = plotTopD + band.bottom * pxRatio;

    // Column border line: erase the segments outside the band (the
    // in-band segment keeps uPlot's own stroke — no color mismatch).
    ctx.clearRect(
      posD - 2 * pxRatio,
      plotTopD,
      2 * pxRatio,
      bandTopD - plotTopD,
    );
    ctx.clearRect(
      posD - 2 * pxRatio,
      bandBottomD,
      2 * pxRatio,
      plotTopD + plotHgtD - bandBottomD,
    );

    // Rotated title: uPlot draws it once at the plot's mid-height —
    // erase it across the full column height (the strip is strictly
    // left of the tick-label body, so labels are untouched), then
    // redraw it rotated at the lane's center, clipped to the band.
    const stripLeftD = (lposCss - labelSizeCss - 2) * pxRatio;
    const stripWidthD = (labelSizeCss + 2) * pxRatio;
    ctx.clearRect(stripLeftD, plotTopD, stripWidthD, plotHgtD);
    const title = titles.get(scaleKey);
    if (title) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(stripLeftD, bandTopD, stripWidthD, bandBottomD - bandTopD);
      ctx.clip();
      ctx.font = AXIS_FONT;
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
  // full plot width (theme grid color, low alpha — both themes).
  ctx.globalAlpha = SEPARATOR_ALPHA;
  // The print render passes its contrast-adapted light grid color; the
  // live viewport uses the active theme's grid color.
  ctx.strokeStyle = separatorColorOverride ?? palette.grid;
  ctx.lineWidth = Math.max(1, pxRatio);
  const bands = laneBandsCss(u, capture);
  for (let i = 1; i < bands.length; i += 1) {
    const y = plotTopD + bands[i]!.top * pxRatio;
    ctx.beginPath();
    ctx.moveTo(plotLeftD, y);
    ctx.lineTo(plotLeftD + plotWidD, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Issue #251: each separator carries a small vertical grip at its
  // midpoint — the visual affordance of the drag handle (the hit strip
  // itself is DOM, owned by laneResizePlugin; the grip rides the canvas
  // so PNG exports composite it with parity).
  if (separatorColorOverride === undefined && bands.length > 1) {
    const midX = plotLeftD + plotWidD / 2;
    for (let i = 1; i < bands.length; i += 1) {
      const y = plotTopD + bands[i]!.top * pxRatio;
      ctx.fillStyle = palette.grid;
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
