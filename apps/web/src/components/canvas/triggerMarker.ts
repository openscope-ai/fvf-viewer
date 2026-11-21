/**
 * t=0 trigger reference drawing (issues #61, #77, #85): an accented vertical
 * graticule line at t = 0 plus a traditional rising-edge trigger glyph
 * (low-to-high step with an upward arrow) pinned to the top grid border.
 * Both render in a neutral graticule-matched tone, track t = 0 during
 * zoom/pan through uPlot's value-to-pixel mapping, and hide cleanly when
 * t = 0 falls outside the visible window.
 *
 * Issue #85 alignment & margin placement:
 * 1. The vertical rising-edge step and upward arrow are collinearly aligned
 *    at x = cx (xDev / t = 0), matching the vertical reference line with
 *    exact pixel precision.
 * 2. The trigger glyph silhouette is positioned in the top margin immediately
 *    above u.bbox.top (riding the top graticule border).
 * 3. Any clear-zone fill is strictly confined to the top margin above u.bbox.top,
 *    ensuring the topmost horizontal gridline/frame border remains 100%
 *    continuous, solid, and unbroken across the entire plot width.
 * 4. The vertical reference line at t = 0 spans continuously from u.bbox.top
 *    (meeting the trigger marker at the top border) down to bottomDev without
 *    truncation.
 *
 * The same two draw functions back the live canvas and the offscreen print
 * render (same hooks, same geometry), so exported PNG snapshots composite
 * the trigger reference with exact parity.
 */

import type uPlot from "uplot";
import { cssPxRatio } from "./axesConfig";

/** Glyph geometry in CSS px (drawn in the top margin above the plot area). */
export const GLYPH_HALF_WIDTH_PX = 12;
export const GLYPH_WIDTH_PX = GLYPH_HALF_WIDTH_PX;
export const GLYPH_HEIGHT_PX = 14;
export const GLYPH_STROKE_PX = 1.75;
/** Clear-zone padding around the glyph, in CSS px. */
export const CLEAR_PAD_PX = 2.5;

/** Resolves the t = 0 device-x coordinate, or null when it is out of view. */
function triggerXDev(u: uPlot): number | null {
  const xMin = u.scales.x?.min;
  const xMax = u.scales.x?.max;
  if (xMin == null || xMax == null || 0 < xMin || 0 > xMax) {
    return null; // t = 0 outside the visible window: hide cleanly
  }
  const pxRatio = cssPxRatio(u);
  const plotLeftCss = u.bbox.left / pxRatio;
  // Snap to the device-pixel grid (0.5 offset centers a 1px stroke on one
  // pixel column) so the line renders crisp instead of antialiasing across
  // two columns.
  return Math.round((plotLeftCss + u.valToPos(0, "x")) * pxRatio - 0.5) + 0.5;
}

/**
 * Accented vertical graticule line at t = 0 (issues #61, #85): spans
 * continuously from the top graticule border (u.bbox.top) down to the
 * bottom of the plot area, meeting the trigger marker at the top border.
 * Drawn from the drawAxes hook (beneath the traces, per issue #61).
 */
export function drawTriggerLine(u: uPlot, accentColor: string): void {
  const xDev = triggerXDev(u);
  if (xDev == null) return;

  const pxRatio = cssPxRatio(u);
  const topDev = u.bbox.top;
  const bottomDev = u.bbox.top + u.bbox.height;

  u.ctx.save();
  u.ctx.strokeStyle = accentColor;
  u.ctx.lineWidth = pxRatio;
  u.ctx.beginPath();
  u.ctx.moveTo(xDev, topDev);
  u.ctx.lineTo(xDev, bottomDev);
  u.ctx.stroke();
  u.ctx.restore();
}

/**
 * Rising-edge trigger glyph pinned to the top border over t = 0 (issues #77, #85):
 * positioned in the top margin immediately above topDev (riding the top graticule border).
 *
 * Collinear alignment (issue #85):
 * - Rising edge and arrow stem are centered exactly at x = cx (xDev / t = 0).
 * - Low horizontal level extends from cx - GLYPH_HALF_WIDTH_PX to cx.
 * - High horizontal level extends from cx to cx + GLYPH_HALF_WIDTH_PX.
 * - Clear zone is confined above topDev, leaving the top border 100% continuous and unbroken.
 * Drawn from the post-series "draw" hook.
 */
export function drawTriggerGlyph(
  u: uPlot,
  accentColor: string,
  backgroundColor: string,
): void {
  const xDev = triggerXDev(u);
  if (xDev == null) return;

  const pxRatio = cssPxRatio(u);
  const topDev = u.bbox.top;
  const cx = xDev;
  const baseY = topDev;
  const midY = topDev - 6 * pxRatio;
  const arrowTipY = topDev - 12 * pxRatio;
  const step = GLYPH_STROKE_PX * pxRatio;

  u.ctx.save();
  u.ctx.strokeStyle = accentColor;
  u.ctx.fillStyle = accentColor;
  u.ctx.lineWidth = step;
  u.ctx.lineJoin = "miter";

  // Clear zone: a background-filled pill in the top margin above the top
  // graticule border (issue #85), bounded strictly above topDev so the
  // topmost horizontal gridline/frame border remains continuous and unbroken.
  const pad = CLEAR_PAD_PX * pxRatio;
  const zoneHalf = GLYPH_HALF_WIDTH_PX * pxRatio + pad;
  const zoneL = Math.round(cx - zoneHalf);
  const zoneR = Math.round(cx + zoneHalf);
  const zoneT = Math.max(0, Math.round(arrowTipY - pad));
  const zoneB = Math.round(topDev - pxRatio);
  if (zoneB > zoneT) {
    u.ctx.fillStyle = backgroundColor;
    u.ctx.fillRect(zoneL, zoneT, zoneR - zoneL, zoneB - zoneT);
    u.ctx.fillStyle = accentColor;
  }

  // Low-to-high step: a short low level, the rising edge, then the high
  // level running to the right edge of the glyph.
  u.ctx.beginPath();
  u.ctx.moveTo(cx - GLYPH_HALF_WIDTH_PX * pxRatio, baseY);
  u.ctx.lineTo(cx, baseY);
  u.ctx.lineTo(cx, midY);
  u.ctx.lineTo(cx + GLYPH_HALF_WIDTH_PX * pxRatio, midY);
  u.ctx.stroke();

  // Upward arrow riding the rising edge, collinearly aligned at cx.
  const arrowX = cx;
  const headWidth = 3.5 * pxRatio;
  u.ctx.beginPath();
  u.ctx.moveTo(arrowX, baseY);
  u.ctx.lineTo(arrowX, arrowTipY);
  u.ctx.stroke();
  u.ctx.beginPath();
  u.ctx.moveTo(arrowX, arrowTipY);
  u.ctx.lineTo(arrowX - headWidth, arrowTipY + headWidth);
  u.ctx.lineTo(arrowX + headWidth, arrowTipY + headWidth);
  u.ctx.closePath();
  u.ctx.fill();

  u.ctx.restore();
}

/**
 * Falling-edge T₂ glyph (issue #97): the distinct secondary trigger —
 * a high-to-low step with a downward arrow — riding the top graticule
 * border immediately above u.bbox.top, stroked in the given accent.
 * Mirrors drawTriggerGlyph's #85 geometry with the edge inverted.
 */
export function drawT2Glyph(
  u: uPlot,
  accentColor: string,
  backgroundColor: string,
  t2Time: number,
): void {
  const xMin = u.scales.x?.min;
  const xMax = u.scales.x?.max;
  if (xMin == null || xMax == null || t2Time < xMin || t2Time > xMax) {
    return;
  }

  const pxRatio = cssPxRatio(u);
  const plotLeftCss = u.bbox.left / pxRatio;
  const xCss = plotLeftCss + u.valToPos(t2Time, "x");
  const cx = Math.round(xCss * pxRatio - 0.5) + 0.5;
  const topDev = u.bbox.top;
  const baseY = topDev;
  const midY = topDev - 6 * pxRatio;
  const arrowTipY = topDev - 12 * pxRatio;
  const step = GLYPH_STROKE_PX * pxRatio;
  const halfWidth = GLYPH_HALF_WIDTH_PX * pxRatio;

  u.ctx.save();
  u.ctx.strokeStyle = accentColor;
  u.ctx.fillStyle = accentColor;
  u.ctx.lineWidth = step;
  u.ctx.lineJoin = "miter";

  // Clear zone strictly above the top graticule border (#85 rule).
  const pad = CLEAR_PAD_PX * pxRatio;
  const zoneHalf = halfWidth + pad;
  const zoneL = Math.round(cx - zoneHalf);
  const zoneR = Math.round(cx + zoneHalf);
  const zoneT = Math.max(0, Math.round(arrowTipY - pad));
  const zoneB = Math.round(topDev - pxRatio);
  if (zoneB > zoneT) {
    u.ctx.fillStyle = backgroundColor;
    u.ctx.fillRect(zoneL, zoneT, zoneR - zoneL, zoneB - zoneT);
    u.ctx.fillStyle = accentColor;
  }

  // High-to-low falling step: high level, falling edge, low level.
  u.ctx.beginPath();
  u.ctx.moveTo(cx - halfWidth, midY);
  u.ctx.lineTo(cx, midY);
  u.ctx.lineTo(cx, baseY);
  u.ctx.lineTo(cx + halfWidth, baseY);
  u.ctx.stroke();

  // Downward arrow riding the falling edge, collinearly aligned at cx.
  const headWidth = 3.5 * pxRatio;
  u.ctx.beginPath();
  u.ctx.moveTo(cx, baseY);
  u.ctx.lineTo(cx, arrowTipY + headWidth);
  u.ctx.stroke();
  u.ctx.beginPath();
  u.ctx.moveTo(cx, arrowTipY);
  u.ctx.lineTo(cx - headWidth, arrowTipY + headWidth);
  u.ctx.lineTo(cx + headWidth, arrowTipY + headWidth);
  u.ctx.closePath();
  u.ctx.fill();

  u.ctx.restore();
}
