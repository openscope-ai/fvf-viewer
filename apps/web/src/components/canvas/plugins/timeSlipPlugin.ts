/**
 * Time slip interaction plugin (issue #97): renders File 2's secondary
 * trigger glyph (T₂▼, falling-edge, stroked in the Ref-A secondary
 * palette color) pinned to the top graticule border, and owns the three
 * tactile time-slip surfaces:
 *
 * - Dragging the T₂ hit-strip along the top margin shifts File 2
 *   horizontally (Δt) with rAF-throttled 60 FPS redraws that rewrite
 *   the reference lanes in place (fused slip + #224 transform, reused
 *   scratch buffers — the uPlot instance is never re-created).
 * - Keyboard: with the strip focused ("File 2 selected or focused"),
 *   unmodified Left/Right nudges the slip by 1 grid sample index
 *   (Shift = 10). Ctrl/Cmd+arrows stay owned by the measurement
 *   cursors (#14); editable targets (popover fields) are skipped.
 * - Escape cancels an active drag (restores the pre-drag slip) and
 *   releases focus; a fresh File 2 load resets the slip (store).
 *
 * The glyph is canvas-drawn from the `draw` hook exactly like the T₁
 * marker (issue #85 geometry, mirrored as a falling edge), so PNG
 * snapshots composite it with parity; only the invisible hit-strip is
 * DOM. Slip state itself lives in `referenceStore` — this plugin is a
 * pure view/controller over it.
 */

import uPlot from "uplot";
import { slippedTriggerTime, slippedRefDisplayLane } from "../timeSlip";
import {
  displayKeyForChannel,
  effectiveInverted,
  effectiveOffset,
  effectiveYScale,
} from "../channelDisplay";
import { refChannelName as toRefName } from "../../../state/referenceStore";
import { useReferenceStore } from "../../../state/referenceStore";
import { useChannelDisplayStore } from "../../../state/channelDisplayStore";
import { effectiveTraceColor, resolveThemePalette } from "../themePalette";
import { useThemeStore } from "../../../state/themeStore";
import { usePaletteStore } from "../../../state/paletteStore";
import { findNearestSampleIndex } from "../../cursors/cursorPlugin";
import { invalidateSeriesPaths } from "../seriesPathCache";
import type { ParsedCapture } from "../../../types/capture";

export interface TimeSlipPluginOptions {
  getCapture: () => ParsedCapture | null;
}

/** Hit-strip geometry in CSS px (covers the canvas glyph with margin). */
export const T2_HIT_WIDTH_PX = 30;
export const T2_HIT_HEIGHT_PX = 16;

/** Device-px x of File 2's slipped trigger, or null when out of view. */
function t2XDev(u: uPlot, t2Time: number): number | null {
  const xMin = u.scales.x?.min;
  const xMax = u.scales.x?.max;
  if (xMin == null || xMax == null || t2Time < xMin || t2Time > xMax) {
    return null;
  }
  const pxRatio = u.width > 0 ? u.ctx.canvas.width / u.width : 1;
  const plotLeftCss = u.bbox.left / pxRatio;
  return plotLeftCss + u.valToPos(t2Time, "x");
}

/**
 * Falling-edge T₂ glyph (issue #97): the distinct secondary trigger —
 * a high-to-low step with a downward arrow — riding the top graticule
 * border immediately above u.bbox.top, stroked in the given accent.
 * Mirrors drawTriggerGlyph's #85 geometry with the edge inverted.
 */
function drawT2Glyph(
  u: uPlot,
  accentColor: string,
  backgroundColor: string,
  t2Time: number,
): void {
  const xCss = t2XDev(u, t2Time);
  if (xCss == null) return;

  const pxRatio = u.width > 0 ? u.ctx.canvas.width / u.width : 1;
  const cx = Math.round(xCss * pxRatio - 0.5) + 0.5;
  const topDev = u.bbox.top;
  const baseY = topDev;
  const midY = topDev - 6 * pxRatio;
  const arrowTipY = topDev - 12 * pxRatio;
  const step = 1.75 * pxRatio;
  const halfWidth = 12 * pxRatio;

  u.ctx.save();
  u.ctx.strokeStyle = accentColor;
  u.ctx.fillStyle = accentColor;
  u.ctx.lineWidth = step;
  u.ctx.lineJoin = "miter";

  // Clear zone strictly above the top graticule border (#85 rule).
  const pad = 2.5 * pxRatio;
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

/** Resolves the T₂ accent: the Ref-A secondary palette identity. */
function t2Accent(): string {
  return effectiveTraceColor(
    useThemeStore.getState().theme,
    usePaletteStore.getState().customColors,
    "Ref-A",
  );
}

export function timeSlipPlugin(options: TimeSlipPluginOptions): uPlot.Plugin {
  let uplot: uPlot | null = null;
  let root: HTMLElement | null = null;
  let unsubscribeStore: (() => void) | null = null;

  // Reused scratch lanes per reference series index (drag-budget GC).
  const scratch = new Map<number, Float32Array>();

  const hitStrip = document.createElement("div");
  hitStrip.className = "t2-hitstrip";
  // Inline positioning (u.root is position:static; the wrapper is the
  // positioned ancestor and shares its origin) so the strip lays out
  // identically with or without the stylesheet — same discipline as
  // the cursor plugin's DOM overlays.
  hitStrip.style.position = "absolute";
  hitStrip.style.zIndex = "12";
  hitStrip.style.cursor = "ew-resize";
  hitStrip.style.display = "none";
  hitStrip.setAttribute("data-testid", "t2-trigger-handle");
  hitStrip.setAttribute("role", "button");
  hitStrip.setAttribute("tabindex", "0");
  hitStrip.setAttribute(
    "aria-label",
    "File 2 trigger T2: drag to time-slip the reference capture; when focused, Left and Right arrow keys nudge by one sample (Shift by ten)",
  );
  hitStrip.title =
    "T2 — File 2 trigger. Drag to time-slip; focus + ←/→ nudges 1 sample (Shift = 10)";

  let dragging = false;
  let preDragSlip = 0;
  let startClientX = 0;
  let startSlip = 0;
  let pendingClientX: number | null = null;
  let rafId: number | null = null;
  let lastSlip = Number.NaN;
  let lastLanes: Float32Array[] | null = null;

  /**
   * CSS px per grid sample across the visible x window (drag mapping):
   * the index span of the visible timestamps over its pixel span.
   */
  function pxPerGridSample(u: uPlot): number {
    const capture = options.getCapture();
    if (!capture || capture.timestamps.length < 2) return 1;
    const ts = capture.timestamps;
    const xMin = u.scales.x?.min ?? ts[0]!;
    const xMax = u.scales.x?.max ?? ts[ts.length - 1]!;
    let i0 = findNearestSampleIndex(ts, xMin);
    let i1 = findNearestSampleIndex(ts, xMax);
    if (i1 < i0) [i0, i1] = [i1, i0];
    if (i1 - i0 < 1) {
      // Degenerate zoom: fall back to the local spacing around center.
      const mid = findNearestSampleIndex(ts, (xMin + xMax) / 2);
      i0 = Math.max(0, mid - 1);
      i1 = Math.min(ts.length - 1, mid + 1);
    }
    const px = Math.abs(u.valToPos(ts[i1]!, "x") - u.valToPos(ts[i0]!, "x"));
    return px > 0 && i1 - i0 > 0 ? px / (i1 - i0) : 1;
  }

  /**
   * Recomputes the slipped reference lanes in place and repaints — one
   * uPlot immediate-mode batch per update, with each rewritten series'
   * path cache invalidated so the geometry rebuilds (#238/#245 paint
   * discipline: each
   * drag frame paints synchronously inside its rAF callback instead of
   * riding the deferred commit() microtask), with the same
   * pre-first-paint fallback as the Oscilloscope display effect.
   */
  function updateReferenceLanes(): void {
    if (!uplot) return;
    const capture = options.getCapture();
    if (!capture) return;
    const reference = useReferenceStore.getState();
    const lanes = reference.lanes;
    if (!lanes) return;
    const refNames = reference.capture
      ? reference.capture.channels.map((c) => toRefName(c.name))
      : [];
    const displayConfigs = useChannelDisplayStore.getState().keyConfigs;
    const instance = uplot;
    const writeLanes = () => {
      lanes.forEach((lane, refIdx) => {
        const refKey = displayKeyForChannel(refNames[refIdx] ?? "");
        let buffer = scratch.get(refIdx);
        if (!buffer || buffer.length !== lane.length) {
          buffer = new Float32Array(lane.length);
          scratch.set(refIdx, buffer);
        }
        const seriesIdx = capture.channels.length + refIdx + 1;
        // Issue #245: clear the stale Path2D cache so each drag frame
        // repaints the slipped reference geometry (uPlot only rebuilds
        // paths whose cache is null; the lane swap alone is invisible).
        invalidateSeriesPaths(instance, seriesIdx);
        instance.data[seriesIdx] = slippedRefDisplayLane(
          lane,
          reference.timeSlipSamples,
          effectiveYScale(displayConfigs, refKey),
          effectiveOffset(displayConfigs, refKey),
          effectiveInverted(displayConfigs, refKey),
          buffer,
        );
      });
    };
    const axesReady = instance.axes.every(
      (axis) => (axis as unknown as { _found?: unknown })._found != null,
    );
    if (axesReady) {
      instance.batch(writeLanes);
    } else {
      writeLanes();
      instance.redraw(false, true);
    }
  }

  function positionHitStrip(): void {
    if (!uplot || !root) return;
    const capture = options.getCapture();
    const reference = useReferenceStore.getState();
    if (!capture || !reference.capture || !reference.lanes) {
      hitStrip.style.display = "none";
      return;
    }
    const t2Time = slippedTriggerTime(
      capture.timestamps,
      reference.timeSlipSamples,
    );
    const xCss = t2XDev(uplot, t2Time);
    if (xCss == null) {
      hitStrip.style.display = "none";
      return;
    }
    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const topCss = uplot.bbox.top / pxRatio;
    hitStrip.style.display = "block";
    hitStrip.style.left = `${Math.round(xCss - T2_HIT_WIDTH_PX / 2)}px`;
    hitStrip.style.top = `${Math.round(topCss - T2_HIT_HEIGHT_PX)}px`;
    hitStrip.style.width = `${T2_HIT_WIDTH_PX}px`;
    hitStrip.style.height = `${T2_HIT_HEIGHT_PX}px`;
    hitStrip.dataset.slipSamples = String(reference.timeSlipSamples);
  }

  function syncFromStore(): void {
    if (!uplot) return;
    const reference = useReferenceStore.getState();
    const lanesChanged = reference.lanes !== lastLanes;
    const slipChanged = reference.timeSlipSamples !== lastSlip;
    if (!lanesChanged && !slipChanged) return;
    lastSlip = reference.timeSlipSamples;
    lastLanes = reference.lanes;
    updateReferenceLanes();
    positionHitStrip();
  }

  function processDragMove(): void {
    rafId = null;
    if (pendingClientX === null || !uplot || !dragging) return;
    const dxPx = pendingClientX - startClientX;
    const samples = dxPx / pxPerGridSample(uplot);
    useReferenceStore.getState().setTimeSlip(startSlip + samples);
  }

  function endDrag(): void {
    dragging = false;
    pendingClientX = null;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    document.removeEventListener("mousemove", onMouseMove, { capture: true });
    document.removeEventListener("mouseup", onMouseUp, { capture: true });
  }

  function onMouseMove(event: MouseEvent): void {
    if (!dragging) return;
    if ((event.buttons & 1) === 0) {
      endDrag();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    pendingClientX = event.clientX;
    if (rafId === null) {
      rafId = requestAnimationFrame(processDragMove);
    }
  }

  function onMouseUp(event: MouseEvent): void {
    if (!dragging) return;
    event.preventDefault();
    event.stopPropagation();
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
      processDragMove();
    }
    endDrag();
  }

  function onStripMouseDown(event: MouseEvent): void {
    if (event.button !== 0 || !uplot) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    dragging = true;
    preDragSlip = useReferenceStore.getState().timeSlipSamples;
    startClientX = event.clientX;
    startSlip = preDragSlip;
    pendingClientX = event.clientX;
    hitStrip.focus();
    document.addEventListener("mousemove", onMouseMove, { capture: true });
    document.addEventListener("mouseup", onMouseUp, { capture: true });
  }

  function onKeyDown(event: KeyboardEvent): void {
    // Escape cancels an active drag (restores the pre-drag slip) and
    // releases the keyboard focus either way.
    if (event.key === "Escape") {
      if (dragging) {
        event.preventDefault();
        event.stopPropagation();
        endDrag();
        useReferenceStore.getState().setTimeSlip(preDragSlip);
      } else if (document.activeElement === hitStrip) {
        hitStrip.blur();
      }
      return;
    }

    // Keyboard sample nudging (AC3): only while the strip is focused
    // ("File 2 selected or focused") and never for the cursor-owned
    // Ctrl/Cmd+arrow chords or editable targets.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (document.activeElement !== hitStrip) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }
    const reference = useReferenceStore.getState();
    if (!reference.capture || !reference.lanes) return;

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      const magnitude = event.shiftKey ? 10 : 1;
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      reference.nudgeTimeSlip(direction * magnitude);
    }
  }

  return {
    hooks: {
      init(u) {
        uplot = u;
        root = u.root;
        root.appendChild(hitStrip);
        hitStrip.addEventListener("mousedown", onStripMouseDown);

        window.addEventListener("keydown", onKeyDown);
        unsubscribeStore = useReferenceStore.subscribe(syncFromStore);

        lastSlip = Number.NaN;
        lastLanes = null;
        positionHitStrip();
      },
      draw() {
        if (!uplot) return;
        const capture = options.getCapture();
        const reference = useReferenceStore.getState();
        if (!capture || !reference.capture || !reference.lanes) return;
        const background = resolveThemePalette(
          useThemeStore.getState().theme,
        ).background;
        drawT2Glyph(
          uplot,
          t2Accent(),
          background,
          slippedTriggerTime(capture.timestamps, reference.timeSlipSamples),
        );
        positionHitStrip();
      },
      setScale() {
        positionHitStrip();
      },
      destroy() {
        endDrag();
        window.removeEventListener("keydown", onKeyDown);
        if (unsubscribeStore) {
          unsubscribeStore();
          unsubscribeStore = null;
        }
        hitStrip.removeEventListener("mousedown", onStripMouseDown);
        const rootEl = root;
        if (rootEl && hitStrip.parentElement === rootEl) {
          rootEl.removeChild(hitStrip);
        }
        root = null;
        uplot = null;
      },
    },
  };
}
