/**
 * Pan and Wheel-Zoom plugin for uPlot (Issue #286).
 *
 * Implements tactile canvas navigation:
 * - Wheel zoom: expands/contracts time viewport centered at the pointer position,
 *   clamping at capture time bounds [t_min, t_max].
 *   Wheeling with Alt key zooms amplitude around pointer y.
 * - Drag pan: Middle-click drag (button === 1) or Shift + Left-drag
 *   (button === 0 && event.shiftKey) moves the viewport without changing its
 *   span, clamped at capture bounds [t_min, t_max].
 * - Escape cancels in-progress pan and restores pre-pan bounds.
 * - Double-click on canvas resets viewport to full capture fit.
 * - Coexists cleanly with box-zoom (unmodified left drag), cursor drag (Ctrl+drag),
 *   ground marker offset (Ctrl+vertical drag), and lane resizing.
 */

import uPlot from "uplot";
import type { ParsedCapture } from "../../../types/capture";
import { useViewportStore } from "../../../state/viewportStore";
import { useChannelDisplayStore } from "../../../state/channelDisplayStore";
import { laneBandsCss } from "../stackLaneDecorations";
import { stackLaneBoundsWeighted } from "../channelLayout";

export interface PanZoomPluginOptions {
  /** Supplier for the parsed capture backing the plot. */
  getCapture: () => ParsedCapture | null;
  /** Callback when lane-scoped zoom commits in Stack mode. */
  onLaneZoom?: (
    scaleKey: string,
    baseBounds: { min: number; max: number },
  ) => void;
}

interface PanDragState {
  startClientX: number;
  initialXMin: number;
  initialXMax: number;
  plotWidth: number;
}

export function panZoomPlugin(options: PanZoomPluginOptions): uPlot.Plugin {
  let uplot: uPlot | null = null;
  let plotArea: HTMLElement | null = null;
  let panDrag: PanDragState | null = null;

  function detachPanListeners(): void {
    document.removeEventListener("mousemove", onDocumentMouseMove);
    document.removeEventListener("mouseup", onDocumentMouseUp);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("blur", onBlur);
    if (plotArea) {
      plotArea.style.cursor = "";
    }
    document.body.style.cursor = "";
  }

  function onBlur(): void {
    if (panDrag !== null) {
      panDrag = null;
      detachPanListeners();
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && panDrag !== null && uplot !== null) {
      event.preventDefault();
      const { initialXMin, initialXMax } = panDrag;
      panDrag = null;
      detachPanListeners();
      uplot.setScale("x", { min: initialXMin, max: initialXMax });
    }
  }

  function onPlotMouseDown(event: MouseEvent): void {
    if (uplot === null || plotArea === null || panDrag !== null) return;

    // Pan is triggered by Middle-click (button === 1) or Shift + Left-click (button === 0 && shiftKey)
    const isMiddleClick = event.button === 1;
    const isShiftLeftClick =
      event.button === 0 && event.shiftKey && !event.ctrlKey && !event.metaKey;

    if (!isMiddleClick && !isShiftLeftClick) return;

    const capture = options.getCapture();
    if (!capture || capture.timestamps.length === 0) return;

    event.preventDefault();
    event.stopPropagation();

    const curMin = uplot.scales.x?.min ?? capture.timestamps[0]!;
    const curMax =
      uplot.scales.x?.max ?? capture.timestamps[capture.timestamps.length - 1]!;

    const rect = plotArea.getBoundingClientRect();
    panDrag = {
      startClientX: event.clientX,
      initialXMin: curMin,
      initialXMax: curMax,
      plotWidth: rect.width || uplot.width || 800,
    };

    plotArea.style.cursor = "grabbing";
    document.body.style.cursor = "grabbing";

    document.addEventListener("mousemove", onDocumentMouseMove);
    document.addEventListener("mouseup", onDocumentMouseUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
  }

  function onDocumentMouseMove(event: MouseEvent): void {
    if (panDrag === null || uplot === null || plotArea === null) return;

    // If middle click was used, ensure button 4 is still held; if left click, ensure button 1 is held
    const isMiddleHeld = (event.buttons & 4) !== 0;
    const isLeftHeld = (event.buttons & 1) !== 0;
    if (!isMiddleHeld && !isLeftHeld) {
      panDrag = null;
      detachPanListeners();
      return;
    }

    const capture = options.getCapture();
    if (!capture || capture.timestamps.length === 0) return;

    const captureMin = capture.timestamps[0]!;
    const captureMax = capture.timestamps[capture.timestamps.length - 1]!;
    const fullSpan = captureMax - captureMin;
    const span = panDrag.initialXMax - panDrag.initialXMin;

    if (span >= fullSpan) {
      // Full view already; cannot pan
      return;
    }

    const deltaPx = event.clientX - panDrag.startClientX;
    const deltaT = -(deltaPx * span) / panDrag.plotWidth;

    let nextMin = panDrag.initialXMin + deltaT;
    let nextMax = panDrag.initialXMax + deltaT;

    // Clamp at capture bounds while strictly preserving span
    if (nextMin < captureMin) {
      nextMin = captureMin;
      nextMax = captureMin + span;
    } else if (nextMax > captureMax) {
      nextMax = captureMax;
      nextMin = captureMax - span;
    }

    uplot.setScale("x", { min: nextMin, max: nextMax });
  }

  function onDocumentMouseUp(): void {
    if (panDrag === null) return;
    panDrag = null;
    detachPanListeners();
  }

  function onWheel(event: WheelEvent): void {
    // Ctrl/Cmd + wheel is reserved for measurement cursor stepping (AC6 of Issue #14)
    if (event.ctrlKey || event.metaKey || uplot === null || plotArea === null) {
      return;
    }

    const capture = options.getCapture();
    if (!capture || capture.timestamps.length === 0) return;

    const rect = plotArea.getBoundingClientRect();
    let clientX = event.clientX;
    let clientY = event.clientY;
    if (clientX === 0 && clientY === 0) {
      clientX = rect.left + rect.width / 2;
      clientY = rect.top + rect.height / 2;
    } else if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // Alt + wheel: vertical amplitude zoom around pointer y
    if (event.altKey) {
      zoomAmplitudeAtPointer(event, capture, clientY);
      return;
    }

    // Default wheel: horizontal time zoom around pointer x
    zoomTimeAtPointer(event, capture, clientX);
  }

  function zoomTimeAtPointer(
    event: WheelEvent,
    capture: ParsedCapture,
    clientX: number,
  ): void {
    if (!uplot || !plotArea) return;
    const rect = plotArea.getBoundingClientRect();
    const xPx = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const tPointer = uplot.posToVal(xPx, "x");

    const curMin = uplot.scales.x?.min ?? capture.timestamps[0]!;
    const curMax =
      uplot.scales.x?.max ?? capture.timestamps[capture.timestamps.length - 1]!;
    const curSpan = curMax - curMin;
    if (curSpan <= 0) return;

    const captureMin = capture.timestamps[0]!;
    const captureMax = capture.timestamps[capture.timestamps.length - 1]!;
    const fullSpan = captureMax - captureMin;

    // deltaY < 0 = zoom in (span contracts); deltaY > 0 = zoom out (span expands)
    const zoomIn = event.deltaY < 0;
    const factor = 0.15;
    let nextSpan = zoomIn ? curSpan * (1 - factor) : curSpan * (1 + factor);

    const minInterval =
      capture.timestamps.length > 1
        ? capture.timestamps[1]! - capture.timestamps[0]!
        : 1e-9;
    const minSpan = Math.max(minInterval * 4, 1e-12);

    if (nextSpan < minSpan) {
      nextSpan = minSpan;
    }
    if (nextSpan >= fullSpan) {
      uplot.setScale("x", { min: captureMin, max: captureMax });
      return;
    }

    // Anchor at pointer position
    const frac = (tPointer - curMin) / curSpan;
    let nextMin = tPointer - frac * nextSpan;
    let nextMax = tPointer + (1 - frac) * nextSpan;

    // Clamp at capture bounds
    if (nextMin < captureMin) {
      const shift = captureMin - nextMin;
      nextMin = captureMin;
      nextMax = Math.min(captureMax, nextMax + shift);
    } else if (nextMax > captureMax) {
      const shift = nextMax - captureMax;
      nextMax = captureMax;
      nextMin = Math.max(captureMin, nextMin - shift);
    }

    uplot.setScale("x", { min: nextMin, max: nextMax });
  }

  function zoomAmplitudeAtPointer(
    event: WheelEvent,
    capture: ParsedCapture,
    clientY: number,
  ): void {
    if (!uplot || !plotArea) return;
    const rect = plotArea.getBoundingClientRect();
    const yPx = Math.min(Math.max(clientY - rect.top, 0), rect.height);
    const isStacked = useChannelDisplayStore.getState().stackMode;
    const zoomIn = event.deltaY < 0;
    const factor = 0.15;

    if (isStacked) {
      const bands = laneBandsCss(uplot, capture);
      const targetBand =
        bands.find((b) => yPx >= b.top && yPx <= b.bottom) ??
        bands[bands.length - 1];
      if (!targetBand) return;

      const curVal = uplot.posToVal(yPx, targetBand.scaleKey);
      const scale = uplot.scales[targetBand.scaleKey];
      if (!scale || scale.min == null || scale.max == null) return;
      const curSpan = scale.max - scale.min;
      if (curSpan <= 0) return;

      const nextSpan = zoomIn ? curSpan * (1 - factor) : curSpan * (1 + factor);
      const frac = (curVal - scale.min) / curSpan;
      const nextMin = curVal - frac * nextSpan;
      const nextMax = curVal + (1 - frac) * nextSpan;

      const pxRatio =
        uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
      const plotHeight = uplot.bbox.height / pxRatio;
      const bandStart = targetBand.top / plotHeight;
      const bandFraction = (targetBand.bottom - targetBand.top) / plotHeight;

      const laned = stackLaneBoundsWeighted(
        { min: nextMin, max: nextMax },
        bandStart,
        bandFraction,
      );
      options.onLaneZoom?.(targetBand.scaleKey, {
        min: nextMin,
        max: nextMax,
      });
      uplot.setScale(targetBand.scaleKey, { min: laned.min, max: laned.max });
      return;
    }

    // Overlay mode: zoom visible Y scales
    const visibleScales = uplot.series
      .filter(
        (s, idx) =>
          idx > 0 &&
          s.show !== false &&
          typeof s.scale === "string" &&
          s.scale !== "x",
      )
      .map((s) => s.scale as string);

    uplot.batch(() => {
      for (const key of visibleScales) {
        const scale = uplot!.scales[key];
        if (!scale || scale.min == null || scale.max == null) continue;
        const curVal = uplot!.posToVal(yPx, key);
        const curSpan = scale.max - scale.min;
        if (curSpan <= 0) continue;
        const nextSpan = zoomIn
          ? curSpan * (1 - factor)
          : curSpan * (1 + factor);
        const frac = (curVal - scale.min) / curSpan;
        uplot!.setScale(key, {
          min: curVal - frac * nextSpan,
          max: curVal + (1 - frac) * nextSpan,
        });
      }
    });
  }

  function onDoubleClick(event: MouseEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    useViewportStore.getState().requestFit();
  }

  return {
    hooks: {
      init(u) {
        uplot = u;
        plotArea = u.over;

        plotArea.addEventListener("mousedown", onPlotMouseDown);
        plotArea.addEventListener("wheel", onWheel, { passive: false });
        u.root.addEventListener("wheel", onWheel, { passive: false });
        plotArea.addEventListener("dblclick", onDoubleClick);
      },
      destroy(u) {
        if (panDrag !== null) {
          panDrag = null;
          detachPanListeners();
        }
        if (plotArea) {
          plotArea.removeEventListener("mousedown", onPlotMouseDown);
          plotArea.removeEventListener("wheel", onWheel);
          plotArea.removeEventListener("dblclick", onDoubleClick);
        }
        if (u) {
          u.root.removeEventListener("wheel", onWheel);
        }
        uplot = null;
        plotArea = null;
      },
    },
  };
}
