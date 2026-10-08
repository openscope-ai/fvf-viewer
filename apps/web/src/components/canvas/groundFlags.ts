/**
 * Shared ground-flag geometry + drawing (issue #249).
 *
 * Every visible channel's ground flag (A▶, B▶, Ref-A▶…) renders on that
 * channel's OWN left y-axis column (#119) at the y-position of its
 * displayed 0V baseline, so traces riding near the baseline can never
 * occlude the flag (the reported defect: in-plot flags were hidden by
 * the waveform). One module backs both canvases that must stay in
 * pixel-parity:
 *
 * - the live viewport (groundMarkerPlugin's draw hook), and
 * - the offscreen print render (pngSnapshot's print pass).
 *
 * Geometry comes from uPlot's own axis layout: a side-3 axis occupies
 * the horizontal band `[_pos - _size - labelSize, _pos]` in CSS px from
 * the canvas root — `_pos` is the column's plot-adjacent RIGHT edge
 * (tick numbers render right-aligned just left of it), the rotated
 * title sits at `_lpos = _pos - _size`, and the title's own width
 * (`labelSize`) extends to the column's left edge. When a large offset pushes
 * the displayed 0V outside the visible band (the full plot height in
 * Overlay mode, the channel's lane band in Stack mode), the flag clamps
 * to the nearest band edge with a directional cue (half-height flag +
 * chevron) and stays draggable; readouts keep reporting true values.
 */

import uPlot from "uplot";
import {
  effectiveOffset,
  isRefChannelKey,
  type ChannelKey,
} from "./channelDisplay";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import { effectiveTraceColor } from "./themePalette";
import { laneBandCss, visibleLaneChannels } from "./stackLaneDecorations";
import type { ParsedCapture } from "../../types/capture";

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

function cssPxRatio(u: uPlot): number {
  return u.width > 0 ? u.ctx.canvas.width / u.width : 1;
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
 * visible axis column (hidden channel, or a reference channel in a
 * render without ref axes — e.g. the primary-only print pass).
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
 * Enumerates every visible channel top-first (the shared lane
 * enumeration): primaries in file order, then visible references.
 */
function visibleChannels(
  capture: ParsedCapture,
): Array<{ key: ChannelKey; label: string; scaleKey: string }> {
  return visibleLaneChannels(capture).map(({ key, label, scaleKey }) => ({
    key,
    label,
    scaleKey,
  }));
}

/**
 * Computes the live ground flags for a uPlot instance. Visibility,
 * offsets, and the Stack/Overlay mode come from the shared stores; the
 * geometry comes from the given instance's axis layout, so the same
 * routine serves the live viewport and the offscreen print render
 * (whose axes mirror the live per-channel columns). `colorFor` lets the
 * print pass inject its contrast-adapted strokes; the default resolves
 * the live theme + palette color.
 */
export function computeGroundFlags(
  u: uPlot,
  capture: ParsedCapture,
  colorFor?: (key: ChannelKey, liveColor: string) => string,
): GroundFlag[] {
  const configs = useChannelDisplayStore.getState().keyConfigs;
  const stacked = useChannelDisplayStore.getState().stackMode;
  const theme = useThemeStore.getState().theme;
  const customColors = usePaletteStore.getState().customColors;
  const pxRatio = cssPxRatio(u);
  const plotHeight = u.bbox.height / pxRatio;
  const visible = visibleChannels(capture);

  const flags: GroundFlag[] = [];
  visible.forEach((entry) => {
    const scale = u.scales[entry.scaleKey];
    if (!scale || scale.min == null || scale.max == null) return;
    // Physical 0 transforms to exactly `offset` in display space.
    const yCss = u.valToPos(
      effectiveOffset(configs, entry.key),
      entry.scaleKey,
    );
    if (!Number.isFinite(yCss)) return;
    // Issue #250: the lane band comes from the shared lane geometry
    // (identical arithmetic to the axis banding + separators).
    const band = stacked ? laneBandCss(u, capture, entry.scaleKey) : null;
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
    const liveColor = effectiveTraceColor(theme, customColors, entry.key);
    flags.push({
      key: entry.key,
      label: entry.label,
      letter: isRefChannelKey(entry.key)
        ? entry.key.replace("Ref-", "R")
        : entry.key,
      isRef: isRefChannelKey(entry.key),
      color: colorFor ? colorFor(entry.key, liveColor) : liveColor,
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
 * the (clamped) displayed 0V baseline. Clamped flags render at half
 * height hugging the band edge with a chevron pointing toward the true
 * baseline. The triangle never enters the plot area.
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
      // Half-height flag hugging the band edge, plus a chevron pointing
      // toward the off-screen baseline.
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

      // Chevron: two strokes meeting at a point off the band edge.
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

    // Tag letter rides just left of the triangle, inside the column.
    ctx.fillStyle = textColor;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.fillText(flag.letter, baseCss * pxRatio - 3 * pxRatio, yDev);
  }
  ctx.restore();
}
