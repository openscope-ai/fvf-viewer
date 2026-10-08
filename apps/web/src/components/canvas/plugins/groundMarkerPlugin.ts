/**
 * Ground reference markers + tactile vertical offset (issue #98).
 *
 * Rendering (issue #249): every visible channel (primary A… and
 * reference Ref-A…) gets a colored ground flag (A▶, B▶, Ref-A▶) — a
 * right-pointing triangle rendered on that channel's OWN left y-axis
 * column at the channel's displayed 0V baseline (the #224 display
 * transform maps physical 0 to exactly the offset value, so the marker
 * sits at display value = offset, moving live with the trace). The
 * column belongs to the channel alone, so traces can never occlude the
 * flag. Geometry + drawing live in groundFlags.ts, shared with the PNG
 * print pass for export parity; canvas-drawn from the draw hook like
 * the T₁/T₂ glyphs, with per-channel DOM hit strips on the axis column
 * for interaction. A baseline pushed outside the visible band (plot
 * height in Overlay, the lane band in Stack) clamps to the nearest band
 * edge with a half-height flag + chevron cue and stays draggable.
 *
 * Interaction:
 * - Ctrl + vertical drag over a trace — or a plain vertical drag on a
 *   ground marker strip — slides that channel's vertical offset in the
 *   shared `channelDisplayStore` at rAF cadence — the #238 display
 *   pipeline rewrites just that lane and repaints synchronously, and
 *   the popover's offset field tracks live (bidirectional sync).
 * - A plain click on a marker strip bubbles to the container's
 *   axis-column click-to-select (it selects that channel); the
 *   trailing click after a real drag is swallowed so offset drags never
 *   re-select (drag vs click disambiguation, same activation threshold
 *   as the trace gesture).
 * - Double-clicking a ground marker resets the offset to 0.
 * - Ctrl+click on a trace without a vertical drag still relocates the
 *   active measurement cursor (the #14 semantics this plugin guards by
 *   intercepting ctrl+mousedown before the cursor plugin and forwarding
 *   unclaimed clicks).
 * - Ctrl+drag that is horizontal-dominant, or starts away from every
 *   trace/marker, stays owned by the cursor plugin.
 */

import uPlot from "uplot";
import {
  displayKeyForChannel,
  effectiveOffset,
  type ChannelKey,
} from "../channelDisplay";
import { useChannelDisplayStore } from "../../../state/channelDisplayStore";
import { useReferenceStore } from "../../../state/referenceStore";
import { refChannelName as toRefName } from "../../../state/referenceStore";
import { useViewportStore } from "../../../state/viewportStore";
import { resolveThemePalette } from "../themePalette";
import { useThemeStore } from "../../../state/themeStore";
import { usePaletteStore } from "../../../state/paletteStore";
import {
  computeGroundFlags,
  drawGroundFlags,
  MARKER_HIT_HALF_PX,
  type GroundFlag,
} from "../groundFlags";
import { useCursorStore } from "../../../state/cursorStore";
import { findNearestSampleIndex } from "../../cursors/cursorPlugin";
import { yScaleKey } from "../../../capture/channelUnits";
import type { ParsedCapture } from "../../../types/capture";

export interface GroundMarkerPluginOptions {
  getCapture: () => ParsedCapture | null;
}

/** Vertical trace-snap radius for ctrl+drag takeover (plot px). */
export const TRACE_SNAP_PX = 48;
/** Drag distance (px) before a press becomes a claimed offset drag. */
const DRAG_ACTIVATION_PX = 3;

/** One visible channel's trace proximity to a plot-area point. */
interface TraceHit {
  key: ChannelKey;
  scaleKey: string;
  distance: number;
}

/**
 * Nearest visible trace (primary or reference) to a plot-area point:
 * the vertically closest rendered sample within the ±8-sample window
 * of the x-nearest index, when it lies within TRACE_SNAP_PX.
 */
function nearestTraceProbe(
  u: uPlot,
  capture: ParsedCapture,
  point: { x: number; y: number },
  seriesIdx: number,
  key: ChannelKey,
): TraceHit | null {
  const time = u.posToVal(point.x, "x");
  const sample = findNearestSampleIndex(capture.timestamps, time);
  const series = u.series[seriesIdx];
  if (!series || series.show === false) return null;
  const lane = u.data[seriesIdx];
  if (!lane) return null;
  const scaleKey =
    typeof series.scale === "string" && series.scale !== "x"
      ? series.scale
      : yScaleKey(seriesIdx - 1);
  const from = Math.max(0, sample - 8);
  const to = Math.min(lane.length - 1, sample + 8);
  let best: TraceHit | null = null;
  for (let s = from; s <= to; s += 1) {
    const value = lane[s];
    if (value == null || !Number.isFinite(value)) continue;
    const candidate: TraceHit = {
      key,
      scaleKey,
      distance: Math.abs(u.valToPos(value, scaleKey) - point.y),
    };
    if (best === null || candidate.distance < best.distance) {
      best = candidate;
    }
  }
  return best;
}

/** The winning trace hit across every visible channel, or null. */
function nearestTrace(
  u: uPlot,
  capture: ParsedCapture,
  point: { x: number; y: number },
): TraceHit | null {
  const viewport = useViewportStore.getState();
  const reference = useReferenceStore.getState();
  const winner: { hit: TraceHit | null } = { hit: null };
  const consider = (hit: TraceHit | null): void => {
    if (
      hit !== null &&
      (winner.hit === null || hit.distance < winner.hit.distance)
    ) {
      winner.hit = hit;
    }
  };
  capture.channels.forEach((channel, index) => {
    if (!viewport.activeChannels.includes(channel.name)) return;
    const key = displayKeyForChannel(channel.name);
    if (key) consider(nearestTraceProbe(u, capture, point, index + 1, key));
  });
  (reference.lanes ?? []).forEach((_lane, refIdx) => {
    const raw = reference.capture?.channels[refIdx];
    const name = raw ? toRefName(raw.name) : null;
    if (!name || !reference.refActiveChannels.includes(name)) return;
    const key = displayKeyForChannel(name);
    if (key) {
      consider(
        nearestTraceProbe(
          u,
          capture,
          point,
          capture.channels.length + refIdx + 1,
          key,
        ),
      );
    }
  });
  const best = winner.hit;
  return best !== null && best.distance <= TRACE_SNAP_PX ? best : null;
}

export function groundMarkerPlugin(
  options: GroundMarkerPluginOptions,
): uPlot.Plugin {
  let uplot: uPlot | null = null;
  let root: HTMLElement | null = null;
  let plotArea: HTMLElement | null = null;
  const unsubs: Array<() => void> = [];

  let dragging: {
    key: ChannelKey;
    scaleKey: string;
    startClientY: number;
    startOffset: number;
  } | null = null;
  let pendingClientY: number | null = null;
  let rafId: number | null = null;
  /**
   * True while re-dispatching an intercepted ctrl+mousedown to the
   * cursor plugin (horizontal-dominant drags stay cursor-owned, #14).
   */
  let forwarding = false;

  function cssPxPerDisplayUnit(scaleKey: string): number {
    if (!uplot) return 1;
    const scale = uplot.scales[scaleKey];
    if (!scale || scale.min == null || scale.max == null) return 1;
    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const heightCss = uplot.bbox.height / pxRatio;
    const span = scale.max - scale.min;
    return heightCss > 0 && span > 0 ? span / heightCss : 1;
  }

  function processDragMove(): void {
    rafId = null;
    if (!dragging || pendingClientY === null) return;
    const dy = pendingClientY - dragging.startClientY;
    const units = cssPxPerDisplayUnit(dragging.scaleKey);
    // Dragging down moves the trace down: the offset decreases.
    useChannelDisplayStore
      .getState()
      .setOffset(dragging.key, dragging.startOffset - dy * units);
  }

  function endDrag(): void {
    dragging = null;
    pendingClientY = null;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    document.removeEventListener("mousemove", onDragMove, { capture: true });
    document.removeEventListener("mouseup", onDragEnd, { capture: true });
  }

  function onDragMove(event: MouseEvent): void {
    if (!dragging) return;
    if ((event.buttons & 1) === 0) {
      endDrag();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    pendingClientY = event.clientY;
    if (rafId === null) {
      rafId = requestAnimationFrame(processDragMove);
    }
  }

  function onDragEnd(event: MouseEvent): void {
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

  function beginOffsetDrag(
    key: ChannelKey,
    scaleKey: string,
    clientY: number,
  ): void {
    dragging = {
      key,
      scaleKey,
      startClientY: clientY,
      startOffset: effectiveOffset(
        useChannelDisplayStore.getState().keyConfigs,
        key,
      ),
    };
    pendingClientY = clientY;
    document.addEventListener("mousemove", onDragMove, { capture: true });
    document.addEventListener("mouseup", onDragEnd, { capture: true });
  }

  /** Strip bookkeeping: element + the scaleKey its handlers bind to. */
  const stripMeta = new Map<
    ChannelKey,
    { el: HTMLDivElement; scaleKey: string }
  >();

  /** Computes the live flags (shared with the print pass). */
  function liveFlags(): GroundFlag[] {
    if (!uplot) return [];
    const capture = options.getCapture();
    if (!capture) return [];
    return computeGroundFlags(uplot, capture);
  }

  /** Creates one interactive strip bound to a live scale key. */
  function createStrip(
    key: ChannelKey,
    scaleKey: string,
    label: string,
  ): HTMLDivElement {
    const strip = document.createElement("div");
    strip.className = "ground-marker-hit";
    // Inline positioning (the wrapper is the positioned ancestor;
    // stylesheet-independent layout, same discipline as the cursor
    // overlays and the T2 hit strip).
    strip.style.position = "absolute";
    strip.style.zIndex = "12";
    strip.style.cursor = "ns-resize";
    strip.style.display = "none";
    strip.setAttribute("data-testid", `ground-marker-${key}`);
    strip.setAttribute("role", "button");
    strip.setAttribute("tabindex", "0");
    strip.setAttribute(
      "aria-label",
      `${label} ground marker: Ctrl+drag (or drag here) to move the vertical offset; double-click resets to 0; when focused, Up/Down nudge the offset by one unit (Shift by ten) and Enter resets to 0`,
    );
    strip.title = `${label} ground — drag to offset, double-click resets 0; focus + ↑/↓ nudges, Enter resets`;
    // Review F2: the handlers read the scale key from stripMeta at event
    // time, so a capture swap that moves the channel to another axis
    // (scaleKey change recreates the strip) never drags against a stale
    // axis rate.
    //
    // Issue #249: the strip lives on the channel's axis column, so a
    // plain click must keep reaching the container's axis-column
    // click-to-select (it selects this channel) while a real drag
    // claims the offset gesture and swallows its trailing click. The
    // press waits for DRAG_ACTIVATION_PX of movement before claiming —
    // the same threshold the trace gesture uses.
    let suppressNextClick = false;
    strip.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const meta = stripMeta.get(key);
      if (!meta) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const onArmedMove = (move: MouseEvent): void => {
        if ((move.buttons & 1) === 0) return;
        if (
          Math.hypot(move.clientX - startX, move.clientY - startY) <
          DRAG_ACTIVATION_PX
        ) {
          return;
        }
        cleanupArmed();
        suppressNextClick = true;
        beginOffsetDrag(key, meta.scaleKey, startY);
        // The drag's own document listener attaches mid-dispatch and
        // will not see THIS event (DOM dispatch semantics) — seed the
        // pending position and schedule the frame ourselves so a
        // single-move flick still lands (same note as the trace path).
        pendingClientY = move.clientY;
        if (rafId === null) {
          rafId = requestAnimationFrame(processDragMove);
        }
      };
      const cleanupArmed = (): void => {
        document.removeEventListener("mousemove", onArmedMove, {
          capture: true,
        });
        document.removeEventListener("mouseup", cleanupArmed, {
          capture: true,
        });
      };
      document.addEventListener("mousemove", onArmedMove, { capture: true });
      document.addEventListener("mouseup", cleanupArmed, { capture: true });
    });
    strip.addEventListener("click", (event) => {
      // A clean click bubbles on to the axis-column click-to-select; a
      // click trailing a completed offset drag is swallowed.
      if (suppressNextClick) {
        suppressNextClick = false;
        event.stopPropagation();
      }
    });
    strip.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      useChannelDisplayStore.getState().setOffset(key, 0);
    });
    // Review F3: keyboard parity — nudges and reset from the focused
    // marker (the popover field remains the precise numeric surface).
    strip.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        useChannelDisplayStore.getState().setOffset(key, 0);
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        const configs = useChannelDisplayStore.getState().keyConfigs;
        const step =
          (event.shiftKey ? 10 : 1) * (event.key === "ArrowUp" ? 1 : -1);
        useChannelDisplayStore
          .getState()
          .setOffset(key, effectiveOffset(configs, key) + step);
      }
    });
    return strip;
  }

  function syncStrips(): void {
    if (!uplot || !root) return;
    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const plotTopCss = uplot.bbox.top / pxRatio;
    const markers = liveFlags();
    const live = new Set<ChannelKey>();
    // Issue #249: each flag's hit strip spans exactly its channel's own
    // axis column (canvas-root-relative CSS px), vertically clamped to
    // the same band as the drawn flag. Columns never overlap, so the
    // old coincident-baseline staggering is unnecessary.
    markers.forEach((marker) => {
      live.add(marker.key);
      let meta = stripMeta.get(marker.key);
      if (meta && meta.scaleKey !== marker.scaleKey) {
        meta.el.remove();
        stripMeta.delete(marker.key);
        meta = undefined;
      }
      if (!meta) {
        const el = createStrip(
          marker.key,
          marker.scaleKey,
          marker.isRef
            ? `Reference channel ${marker.key}`
            : `Channel ${marker.key}`,
        );
        root?.appendChild(el);
        meta = { el, scaleKey: marker.scaleKey };
        stripMeta.set(marker.key, meta);
      }
      const strip = meta.el;
      strip.style.display = "block";
      strip.style.left = `${Math.round(marker.colLeft)}px`;
      strip.style.top = `${Math.round(
        plotTopCss + marker.clampedY - MARKER_HIT_HALF_PX,
      )}px`;
      strip.style.width = `${Math.round(marker.colRight - marker.colLeft)}px`;
      strip.style.height = `${MARKER_HIT_HALF_PX * 2}px`;
      strip.dataset.offsetUnits = String(
        useChannelDisplayStore.getState().keyConfigs[marker.key]?.offset ?? 0,
      );
      strip.dataset.clamped = marker.cue ?? "";
    });
    for (const [key, meta] of stripMeta) {
      if (!live.has(key)) {
        meta.el.remove();
        stripMeta.delete(key);
      }
    }
  }

  /**
   * Ctrl+mousedown interception (capture phase, registered BEFORE the
   * cursor plugin): a press on a trace claims the vertical-drag gesture
   * for the channel offset; an unclaimed press (no vertical movement)
   * forwards the #14 ctrl+click cursor relocation.
   */
  function onPlotAreaMouseDown(event: MouseEvent): void {
    if (forwarding) return; // re-dispatched gesture: cursor plugin owns it
    if (event.button !== 0 || !uplot || !plotArea) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    const capture = options.getCapture();
    if (!capture) return;

    const rect = plotArea.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    // Near an active cursor line stays with the cursor plugin (#14).
    const cursorState = useCursorStore.getState();
    const nearCursor =
      (cursorState.c1Active &&
        Math.abs(
          uplot.valToPos(
            capture.timestamps[
              Math.min(cursorState.c1SampleIndex, capture.timestamps.length - 1)
            ]!,
            "x",
          ) - point.x,
        ) <= 12) ||
      (cursorState.c2Active &&
        Math.abs(
          uplot.valToPos(
            capture.timestamps[
              Math.min(cursorState.c2SampleIndex, capture.timestamps.length - 1)
            ]!,
            "x",
          ) - point.x,
        ) <= 12);
    if (nearCursor) return;

    const hit = nearestTrace(uplot, capture, point);
    if (!hit) return; // away from every trace: cursor plugin keeps it

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    // Pending claim: vertical-dominant movement takes the offset drag;
    // a release without it forwards the cursor relocation.
    const startX = event.clientX;
    const startY = event.clientY;
    const time = uplot.posToVal(point.x, "x");
    const sampleIdx = findNearestSampleIndex(capture.timestamps, time);
    const candidate =
      cursorState.selectedCursor ??
      (cursorState.c1Active ? "C1" : cursorState.c2Active ? "C2" : null);
    let claimed = false;

    const onMove = (moveEvent: MouseEvent): void => {
      if ((moveEvent.buttons & 1) === 0) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!claimed && Math.hypot(dx, dy) >= DRAG_ACTIVATION_PX) {
        if (Math.abs(dy) > Math.abs(dx)) {
          claimed = true;
          beginOffsetDrag(hit.key, hit.scaleKey, startY);
          // The drag's own document listener attaches mid-dispatch and
          // will not see THIS event (DOM dispatch semantics) — seed the
          // pending position and schedule the frame ourselves so a
          // single-move vertical flick still lands.
          pendingClientY = moveEvent.clientY;
          if (rafId === null) {
            rafId = requestAnimationFrame(processDragMove);
          }
        } else {
          // Horizontal-dominant: the gesture belongs to the cursor
          // plugin (#14). The original mousedown was consumed above, so
          // re-dispatch it from the live pointer position under a
          // forwarding flag this handler ignores — the cursor drag (and
          // its Escape-cancel semantics) then proceeds exactly as
          // before, and this pending claim stands down.
          cleanup();
          forwarding = true;
          try {
            plotArea!.dispatchEvent(
              new MouseEvent("mousedown", {
                bubbles: true,
                cancelable: true,
                button: 0,
                ctrlKey: true,
                clientX: moveEvent.clientX,
                clientY: moveEvent.clientY,
              }),
            );
          } finally {
            forwarding = false;
          }
        }
      }
      if (claimed) {
        moveEvent.preventDefault();
        moveEvent.stopPropagation();
      }
    };
    const onUp = (): void => {
      if (!claimed && candidate) {
        useCursorStore
          .getState()
          .setCursorSample(candidate, sampleIdx, capture.timestamps.length);
        useCursorStore.getState().selectCursor(candidate);
      }
      cleanup();
    };
    const cleanup = (): void => {
      claimed = false;
      document.removeEventListener("mousemove", onMove, { capture: true });
      document.removeEventListener("mouseup", onUp, { capture: true });
    };
    document.addEventListener("mousemove", onMove, { capture: true });
    document.addEventListener("mouseup", onUp, { capture: true });
  }

  function drawMarkers(): void {
    if (!uplot) return;
    const flags = liveFlags();
    const palette = resolveThemePalette(useThemeStore.getState().theme);
    drawGroundFlags(uplot, flags, palette.axisText);
  }

  return {
    hooks: {
      init(u) {
        uplot = u;
        root = u.root;
        plotArea = u.over;
        // BEFORE the cursor plugin's own capture listener: plugin order
        // in the Oscilloscope options puts this plugin first.
        plotArea.addEventListener("mousedown", onPlotAreaMouseDown, {
          capture: true,
        });

        unsubs.push(
          useChannelDisplayStore.subscribe(syncStrips),
          useViewportStore.subscribe(syncStrips),
          useReferenceStore.subscribe(syncStrips),
          useThemeStore.subscribe(syncStrips),
          usePaletteStore.subscribe(syncStrips),
        );
        syncStrips();
      },
      draw() {
        drawMarkers();
        syncStrips();
      },
      setScale() {
        syncStrips();
      },
      destroy() {
        endDrag();
        plotArea?.removeEventListener("mousedown", onPlotAreaMouseDown, {
          capture: true,
        });
        unsubs.forEach((off) => off());
        unsubs.length = 0;
        stripMeta.forEach((meta) => meta.el.remove());
        stripMeta.clear();
        plotArea = null;
        root = null;
        uplot = null;
      },
    },
  };
}
