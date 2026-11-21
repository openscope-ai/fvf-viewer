/**
 * Shared ground-flag geometry + drawing (issue #249, #355).
 *
 * Pure rendering module: reads zero global Zustand stores and uses the single
 * guarded `cssPxRatio` from `axesConfig.ts`. Both live viewport and offscreen
 * PNG export pass an explicit `ChartRenderState`.
 */

import uPlot from "uplot";
import { effectiveOffset, type ChannelKey } from "./channelDisplay";
import { cssPxRatio } from "./axesConfig";
import { laneBandCss } from "./stackLaneDecorations";
import type { ChartRenderState } from "./chartRenderState";

/** Flag triangle geometry in CSS px. */
export const MARKER_WIDTH_PX = 10;
export const MARKER_HEIGHT_PX = 8;
/** Inset of the flag apex from its column's plot-adjacent edge (CSS px). */
export const FLAG_INSET_PX = 2;
/** Hit-strip half-height around the flag (CSS px). */
export const MARKER_HIT_HALF_PX = 10;
/** Chevron arm length for the edge-clamp directional cue (CSS px). */
export const CLAMP_CHEVRON_PX = 4;
/** Gap between the clamped flag and its chevron cue (CSS px). */
const CHEVRON_GAP_PX = 1.5;

export type GroundFlagCue = "up" | "down" | null;

export interface GroundFlag {
  key: ChannelKey;
  /** Full channel label ("A", "Ref-A"). */
  label: string;
  /** Short glyph letter riding the flag ("A", "RA"). */
  letter: string;
  isRef: boolean;
  color: string;
  scaleKey: string;
  /** Unclamped CSS-px y of the displayed 0V baseline, plot-area-relative. */
  yCss: number;
  /** Band-clamped CSS-px y, plot-area-relative. */
  clampedY: number;
  /** Directional cue when the baseline left the visible band. */
  cue: GroundFlagCue;
  /** Axis-column extents, canvas-root-relative CSS px. */
  colLeft: number;
  colRight: number;
  /** Vertical band, plot-area-relative CSS px. */
  bandTop: number;
  bandBottom: number;
}

export interface GroundFlagGeometry {
  clampedY: number;
  cue: GroundFlagCue;
  colLeft: number;
  colRight: number;
}

interface AxisLayout {
  pos: number;
  size: number;
  lpos: number | null;
  labelSize: number;
}

/** Live layout of one side-3 axis column, or null when it has none. */
function axisLayout(u: uPlot, scaleKey: string): AxisLayout | null {
  const axis = u.axes.find((a) => a.scale === scaleKey) as
    | {
        show?: boolean;
        _pos?: number;
        _size?: number;
        _lpos?: number;
        label?: unknown;
        labelSize?: number;
      }
    | undefined;
  if (!axis || axis.show === false) return null;
  if (axis._pos == null || axis._size == null) return null;
  return {
    pos: axis._pos,
    size: axis._size,
    lpos: typeof axis._lpos === "number" ? axis._lpos : null,
    labelSize:
      axis.label != null && typeof axis.labelSize === "number"
        ? axis.labelSize
        : 0,
  };
}

/**
 * Clamps a plot-relative baseline y into the channel's visible band and
 * resolves its axis-column extents. Null when the channel has no
 * visible axis column.
 */
export function groundFlagGeometry(
  u: uPlot,
  scaleKey: string,
  yCss: number,
  bandTop: number,
  bandBottom: number,
): GroundFlagGeometry | null {
  const layout = axisLayout(u, scaleKey);
  if (!layout) return null;
  const half = MARKER_HEIGHT_PX / 2;
  const lo = bandTop + half;
  const hi = bandBottom - half;
  const clampedY = Math.min(Math.max(yCss, lo), hi);
  const cue: GroundFlagCue = yCss < lo ? "up" : yCss > hi ? "down" : null;
  return {
    clampedY,
    cue,
    colLeft:
      layout.lpos != null
        ? layout.lpos - layout.labelSize
        : layout.pos - layout.size,
    colRight: layout.pos,
  };
}

/**
 * Computes the ground flags for a uPlot instance from an explicit
 * `ChartRenderState`. Serves both the live viewport and the offscreen print
 * render with zero global store reads.
 */
export function computeGroundFlags(
  u: uPlot,
  state: ChartRenderState,
): GroundFlag[] {
  const pxRatio = cssPxRatio(u);
  const plotHeight = u.bbox.height / pxRatio;
  const visible = state.catalog.visibleLanes();

  const flags: GroundFlag[] = [];
  visible.forEach((entry) => {
    const scale = u.scales[entry.scaleKey];
    if (!scale || scale.min == null || scale.max == null) return;
    // Physical 0 transforms to exactly `offset` in display space.
    const yCss = u.valToPos(
      effectiveOffset(state.displayConfigs, entry.displayKey),
      entry.scaleKey,
    );
    if (!Number.isFinite(yCss)) return;
    const band = state.stackMode ? laneBandCss(u, state, entry.scaleKey) : null;
    const bandTop = band?.top ?? 0;
    const bandBottom = band?.bottom ?? plotHeight;
    const geometry = groundFlagGeometry(
      u,
      entry.scaleKey,
      yCss,
      bandTop,
      bandBottom,
    );
    if (!geometry) return;
    const isRef = entry.slot === "reference";
    flags.push({
      key: entry.displayKey,
      label: entry.id,
      letter: isRef ? `R${entry.rawTag}` : entry.rawTag,
      isRef,
      color: state.chrome.channelColor(entry),
      scaleKey: entry.scaleKey,
      yCss,
      clampedY: geometry.clampedY,
      cue: geometry.cue,
      colLeft: geometry.colLeft,
      colRight: geometry.colRight,
      bandTop,
      bandBottom,
    });
  });
  return flags;
}

/**
 * Strokes the flags onto a uPlot canvas: a filled right-pointing
 * triangle with its tag letter inside the channel's own axis column at
 * the (clamped) displayed 0V baseline.
 */
export function drawGroundFlags(
  u: uPlot,
  flags: GroundFlag[],
  textColor: string,
): void {
  const pxRatio = cssPxRatio(u);
  const plotTopDev = u.bbox.top;
  const ctx = u.ctx;

  ctx.save();
  ctx.font = `${10 * pxRatio}px ui-monospace, monospace`;
  for (const flag of flags) {
    const apexCss = flag.colRight - FLAG_INSET_PX;
    const baseCss = apexCss - MARKER_WIDTH_PX;
    const yDev = plotTopDev + flag.clampedY * pxRatio;
    const half = (MARKER_HEIGHT_PX / 2) * pxRatio;

    ctx.fillStyle = flag.color;
    if (flag.cue === null) {
      const baseX = baseCss * pxRatio;
      const apexX = apexCss * pxRatio;
      ctx.beginPath();
      ctx.moveTo(baseX, yDev - half);
      ctx.lineTo(baseX, yDev + half);
      ctx.lineTo(apexX, yDev);
      ctx.closePath();
      ctx.fill();
    } else {
      const edgeDev =
        plotTopDev +
        (flag.cue === "up" ? flag.bandTop : flag.bandBottom) * pxRatio;
      const inward = flag.cue === "up" ? 1 : -1;
      const baseX = baseCss * pxRatio;
      const apexX = apexCss * pxRatio;
      ctx.beginPath();
      ctx.moveTo(baseX, edgeDev);
      ctx.lineTo(baseX, edgeDev + inward * half);
      ctx.lineTo(apexX, edgeDev + inward * (half / 2));
      ctx.closePath();
      ctx.fill();

      const tipDev =
        edgeDev - inward * (CHEVRON_GAP_PX + CLAMP_CHEVRON_PX) * pxRatio;
      const armX = (baseCss + MARKER_WIDTH_PX / 2) * pxRatio;
      ctx.strokeStyle = flag.color;
      ctx.lineWidth = Math.max(1, pxRatio);
      ctx.beginPath();
      ctx.moveTo(
        armX - CLAMP_CHEVRON_PX * pxRatio,
        edgeDev - inward * CHEVRON_GAP_PX * pxRatio,
      );
      ctx.lineTo(armX, tipDev);
      ctx.lineTo(
        armX + CLAMP_CHEVRON_PX * pxRatio,
        edgeDev - inward * CHEVRON_GAP_PX * pxRatio,
      );
      ctx.stroke();
    }

    ctx.fillStyle = textColor;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.fillText(flag.letter, baseCss * pxRatio - 3 * pxRatio, yDev);
  }
  ctx.restore();
}
