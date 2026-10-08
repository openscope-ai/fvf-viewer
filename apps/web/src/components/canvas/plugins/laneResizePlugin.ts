/**
 * Stack-view lane resizing (issue #251): each lane separator carries a
 * thin drag handle — a small vertical grip rendered on the separator
 * midpoint (canvas, in stackLaneDecorations, for PNG parity) with a
 * narrow DOM hit strip around it, claimed up-front in the capture phase
 * exactly like the ground-marker strips, so the gesture never fights
 * the plot-area interactions (box-zoom, cursor drags, Ctrl+drag
 * offset).
 *
 * Dragging a handle redistributes height between the two ADJACENT lanes
 * only: their weights change by a common delta (every other lane keeps
 * its weight, the total stays constant, so the fractions always sum to
 * 1), live at rAF cadence through the laneLayoutStore — the stack
 * effect re-windows each lane from its SAVED pre-stack bounds, so the
 * resize keeps each trace's content view and scales its visual
 * unit-per-pixel with the lane. A lane never shrinks below 10% of the
 * plot height. Double-clicking a separator equalizes all lanes.
 */

import uPlot from "uplot";
import type { ParsedCapture } from "../../../types/capture";
import type { ChannelKey } from "../channelDisplay";
import {
  DEFAULT_LANE_WEIGHT,
  LANE_MIN_FRACTION,
  useLaneLayoutStore,
} from "../../../state/laneLayoutStore";
import {
  LANE_HANDLE_HEIGHT_PX,
  laneBandsCss,
  visibleLaneChannels,
} from "../stackLaneDecorations";
import { useChannelDisplayStore } from "../../../state/channelDisplayStore";
import { useViewportStore } from "../../../state/viewportStore";
import { useReferenceStore } from "../../../state/referenceStore";

/** Hit-strip width around the grip (CSS px). */
const HIT_WIDTH_PX = 48;

interface LaneKeyEntry {
  scaleKey: string;
  key: ChannelKey;
}

/** Maps the visible lanes to their channel keys (shared enumeration). */
function laneChannelKeys(capture: ParsedCapture): LaneKeyEntry[] {
  return visibleLaneChannels(capture).map(({ scaleKey, key }) => ({
    scaleKey,
    key,
  }));
}

export function laneResizePlugin(options: {
  getCapture: () => ParsedCapture | null;
}): uPlot.Plugin {
  let uplot: uPlot | null = null;
  let root: HTMLElement | null = null;
  const unsubs: Array<() => void> = [];

  /** Boundary strips: element + the two adjacent channel keys. */
  const stripMeta = new Map<
    number,
    { el: HTMLDivElement; above: ChannelKey; below: ChannelKey }
  >();

  let dragging: {
    boundaryIndex: number;
    above: ChannelKey;
    below: ChannelKey;
    startClientY: number;
    startAbove: number;
    startBelow: number;
    totalWeight: number;
    weightPerPx: number;
  } | null = null;
  let pendingClientY: number | null = null;
  let rafId: number | null = null;

  function processDragMove(): void {
    rafId = null;
    if (!dragging || pendingClientY === null) return;
    const dy = pendingClientY - dragging.startClientY;
    const dWeight = dy * dragging.weightPerPx;
    const floor = LANE_MIN_FRACTION * dragging.totalWeight - Number.EPSILON;
    const above = Math.max(dragging.startAbove + dWeight, floor);
    const below = Math.max(dragging.startBelow - dWeight, floor);
    // Clamped at the floor on either side: keep both at/above it. When
    // one lane hits the floor the other absorbs the remainder.
    const sum = dragging.startAbove + dragging.startBelow;
    const aboveClamped = Math.min(above, sum - floor);
    const belowClamped = Math.min(below, sum - floor);
    useLaneLayoutStore.getState().setWeights({
      [dragging.above]: aboveClamped,
      [dragging.below]: belowClamped,
    });
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

  function beginResize(
    boundaryIndex: number,
    above: ChannelKey,
    below: ChannelKey,
    clientY: number,
  ): void {
    const capture = options.getCapture();
    if (!uplot || !capture) return;
    const keys = laneChannelKeys(capture).map((entry) => entry.key);
    const weights = useLaneLayoutStore.getState().weights;
    const effective = keys.map((key) => weights[key] ?? DEFAULT_LANE_WEIGHT);
    const totalWeight = effective.reduce((sum, weight) => sum + weight, 0);
    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const plotHeightCss = uplot.bbox.height / pxRatio;
    // weightPerPx: moving 1 px shifts height fraction 1/plotHeight,
    // i.e. totalWeight/plotHeight weight units.
    dragging = {
      boundaryIndex,
      above,
      below,
      startClientY: clientY,
      startAbove: weights[above] ?? DEFAULT_LANE_WEIGHT,
      startBelow: weights[below] ?? DEFAULT_LANE_WEIGHT,
      totalWeight,
      weightPerPx: totalWeight / Math.max(plotHeightCss, 1),
    };
    pendingClientY = clientY;
    document.addEventListener("mousemove", onDragMove, { capture: true });
    document.addEventListener("mouseup", onDragEnd, { capture: true });
  }

  function createStrip(
    boundaryIndex: number,
    above: ChannelKey,
    below: ChannelKey,
  ): HTMLDivElement {
    const strip = document.createElement("div");
    strip.className = "lane-resize-hit";
    strip.style.position = "absolute";
    strip.style.zIndex = "12";
    strip.style.cursor = "ns-resize";
    strip.style.display = "none";
    strip.setAttribute("data-testid", `lane-resize-${boundaryIndex}`);
    strip.setAttribute("role", "slider");
    strip.setAttribute("tabindex", "0");
    strip.setAttribute(
      "aria-label",
      `Lane divider ${boundaryIndex}: drag to resize the adjacent lanes (minimum 10% each); double-click equalizes all lanes`,
    );
    strip.title =
      "Drag to resize the adjacent lanes (min 10%); double-click equalizes";
    strip.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      // Claimed up-front (capture-phase discipline of the ground-marker
      // strips): box-zoom, cursor drags, and Ctrl+drag offset never see
      // a press that starts on the handle.
      event.preventDefault();
      event.stopPropagation();
      beginResize(boundaryIndex, above, below, event.clientY);
      // Seed the pending position from the pointer so the first move
      // frame is relative to the press.
      pendingClientY = event.clientY;
      if (rafId === null) {
        rafId = requestAnimationFrame(processDragMove);
      }
    });
    strip.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      useLaneLayoutStore.getState().equalize();
    });
    strip.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        useLaneLayoutStore.getState().equalize();
      }
    });
    return strip;
  }

  function syncStrips(): void {
    if (!uplot || !root) return;
    const capture = options.getCapture();
    if (!capture) return;
    const stacked = useChannelDisplayStore.getState().stackMode;
    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const plotTopCss = uplot.bbox.top / pxRatio;
    const plotLeftCss = uplot.bbox.left / pxRatio;
    const plotWidthCss = uplot.bbox.width / pxRatio;

    if (!stacked) {
      for (const [, meta] of stripMeta) meta.el.remove();
      stripMeta.clear();
      return;
    }

    const entries = laneChannelKeys(capture);
    const bands = laneBandsCss(uplot, capture);
    const live = new Set<number>();
    for (let i = 1; i < bands.length; i += 1) {
      live.add(i);
      const above = entries[i - 1]!.key;
      const below = entries[i]!.key;
      let meta = stripMeta.get(i);
      if (meta && (meta.above !== above || meta.below !== below)) {
        meta.el.remove();
        stripMeta.delete(i);
        meta = undefined;
      }
      if (!meta) {
        const el = createStrip(i, above, below);
        root.appendChild(el);
        meta = { el, above, below };
        stripMeta.set(i, meta);
      }
      const y = plotTopCss + bands[i]!.top;
      meta.el.style.display = "block";
      meta.el.style.left = `${Math.round(plotLeftCss + plotWidthCss / 2 - HIT_WIDTH_PX / 2)}px`;
      meta.el.style.top = `${Math.round(y - LANE_HANDLE_HEIGHT_PX / 2 - 4)}px`;
      meta.el.style.width = `${HIT_WIDTH_PX}px`;
      meta.el.style.height = `${LANE_HANDLE_HEIGHT_PX + 8}px`;
    }
    for (const [index, meta] of stripMeta) {
      if (!live.has(index)) {
        meta.el.remove();
        stripMeta.delete(index);
      }
    }
  }

  return {
    hooks: {
      init(u) {
        uplot = u;
        root = u.root;
        unsubs.push(
          useChannelDisplayStore.subscribe(syncStrips),
          useViewportStore.subscribe(syncStrips),
          useReferenceStore.subscribe(syncStrips),
          useLaneLayoutStore.subscribe(syncStrips),
        );
        syncStrips();
      },
      draw() {
        syncStrips();
      },
      setScale() {
        syncStrips();
      },
      destroy() {
        endDrag();
        unsubs.forEach((off) => off());
        unsubs.length = 0;
        stripMeta.forEach((meta) => meta.el.remove());
        stripMeta.clear();
        uplot = null;
        root = null;
      },
    },
  };
}
