/**
 * Rectangular box-zoom plugin for uPlot (issue #13, architecture.md §4.2.1).
 *
 * A custom 2D drag-selection plugin: while the user drags across the plot
 * area, a translucent selection rectangle overlay tracks the pointer.
 * Releasing the mouse commits a zoom only when the dragged bounding box
 * meets {@link BOX_ZOOM_MIN_DRAG_PX} on BOTH axes (click-safe threshold);
 * pressing Escape during the drag cancels the selection completely and
 * leaves the axis scales untouched.
 *
 * Coordinate discipline (AC: repeated nested zooms remain stable): every
 * pointer position is converted to plot-area-relative CSS pixels and value
 * ranges are derived exclusively through `uPlot.posToVal`, so each zoom is
 * an exact value-space window over the current scales — no accumulated
 * pixel offsets, no geometric drift across nested zooms.
 *
 * Both axis scales are committed inside a single `uPlot.batch()` so the X
 * (time) and Y (amplitude) updates land atomically in one redraw.
 *
 * The built-in uPlot drag selection (`cursor.drag.{x,y,setScale}`) is
 * disabled by Oscilloscope.tsx; this plugin fully owns drag-zoom.
 */

import uPlot from "uplot";

/** Minimum drag extent (CSS px) required on each axis before a zoom commits. */
export const BOX_ZOOM_MIN_DRAG_PX = 8;

export interface BoxZoomPluginOptions {
  /**
   * Minimum dragged bounding-box size (CSS px) on both the horizontal and
   * the vertical axis for the zoom to trigger. Drags narrower than this on
   * either axis are discarded (click-safe). Default: 8.
   */
  minDragPx?: number;
}

interface BoxZoomDragState {
  /** Drag origin, plot-area-relative CSS px. */
  startX: number;
  startY: number;
}

/**
 * Creates the box-zoom uPlot plugin. Each call produces an independent
 * plugin instance bound to the chart that mounts it (one instance per
 * uPlot instantiation).
 */
export function boxZoomPlugin(
  options: BoxZoomPluginOptions = {},
): uPlot.Plugin {
  const minDragPx = options.minDragPx ?? BOX_ZOOM_MIN_DRAG_PX;

  // Translucent selection rectangle. Anchored to `u.over`, which uPlot
  // positions exactly over the plot area, so left/top are plot-area-relative
  // CSS pixels (identical coordinate space as `posToVal`). Inline
  // positioning/disabling keeps the drag mechanics independent of stylesheet
  // load order; visual styling lives in index.css.
  const overlay = document.createElement("div");
  overlay.className = "box-zoom-overlay";
  overlay.setAttribute("data-testid", "box-zoom-overlay");
  overlay.style.position = "absolute";
  overlay.style.pointerEvents = "none";
  overlay.style.display = "none";

  let uplot: uPlot | null = null;
  let plotArea: HTMLElement | null = null;
  let drag: BoxZoomDragState | null = null;
  let currentX = 0;
  let currentY = 0;
  let overlayFrame = 0;

  /** Converts a mouse event to plot-area-relative CSS px, clamped to bounds. */
  function toPlotPos(event: MouseEvent): { x: number; y: number } {
    const rect = plotArea!.getBoundingClientRect();
    return {
      x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height),
    };
  }

  /** Applies the pending selection geometry to the overlay, once per frame. */
  function scheduleOverlayUpdate(): void {
    if (overlayFrame !== 0) return;
    overlayFrame = requestAnimationFrame(() => {
      overlayFrame = 0;
      if (!drag) return;
      overlay.style.left = `${Math.min(drag.startX, currentX)}px`;
      overlay.style.top = `${Math.min(drag.startY, currentY)}px`;
      overlay.style.width = `${Math.abs(currentX - drag.startX)}px`;
      overlay.style.height = `${Math.abs(currentY - drag.startY)}px`;
    });
  }

  function showOverlay(): void {
    overlay.style.left = "0px";
    overlay.style.top = "0px";
    overlay.style.width = "0px";
    overlay.style.height = "0px";
    overlay.style.display = "block";
  }

  function hideOverlay(): void {
    if (overlayFrame !== 0) {
      cancelAnimationFrame(overlayFrame);
      overlayFrame = 0;
    }
    overlay.style.display = "none";
    overlay.style.width = "0px";
    overlay.style.height = "0px";
  }

  function detachDragListeners(): void {
    drag = null;
    document.removeEventListener("mousemove", onDocumentMouseMove);
    document.removeEventListener("mouseup", onDocumentMouseUp);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("blur", onBlur);
  }

  function onBlur(): void {
    if (drag !== null) {
      detachDragListeners();
      hideOverlay();
    }
  }

  function onPlotMouseDown(event: MouseEvent): void {
    if (
      event.button !== 0 ||
      drag !== null ||
      uplot === null ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    const start = toPlotPos(event);
    drag = { startX: start.x, startY: start.y };
    currentX = start.x;
    currentY = start.y;
    showOverlay();
    // Track and commit at document level so the drag survives the pointer
    // temporarily leaving the plot area (clamped at its edges).
    document.addEventListener("mousemove", onDocumentMouseMove);
    document.addEventListener("mouseup", onDocumentMouseUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
  }

  function onDocumentMouseMove(event: MouseEvent): void {
    if (drag === null) return;
    if ((event.buttons & 1) === 0) {
      detachDragListeners();
      hideOverlay();
      return;
    }
    const pos = toPlotPos(event);
    currentX = pos.x;
    currentY = pos.y;
    scheduleOverlayUpdate();
  }

  /** Escape during an active drag: cancel selection, keep scales untouched. */
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || drag === null) return;
    event.preventDefault();
    detachDragListeners();
    hideOverlay();
  }

  function onDocumentMouseUp(event: MouseEvent): void {
    if (drag === null || uplot === null) return;
    const u = uplot;
    const { startX, startY } = drag;
    const end = toPlotPos(event);
    detachDragListeners();
    hideOverlay();

    // Click-safe threshold: zoom only when BOTH axes meet the minimum drag.
    const width = Math.abs(end.x - startX);
    const height = Math.abs(end.y - startY);
    if (width < minDragPx || height < minDragPx) return;

    // Value conversion purely from plot-area positions via posToVal keeps
    // nested zooms exact (no pixel-space state carried across zooms).
    const xMin = u.posToVal(Math.min(startX, end.x), "x");
    const xMax = u.posToVal(Math.max(startX, end.x), "x");
    // Issue #106: one Y scale per channel — the same pixel band maps into
    // every visible series' own scale, so each trace zooms vertically
    // within its own range instead of sharing one blended amplitude axis.
    // The Y axis grows upward: the smaller plot-relative y is the larger
    // amplitude value.
    const yTop = Math.min(startY, end.y);
    const yBottom = Math.max(startY, end.y);
    const yZooms = u.series
      .map((series, seriesIdx) => ({ series, seriesIdx }))
      .filter(
        ({ series, seriesIdx }) =>
          seriesIdx > 0 &&
          series.show !== false &&
          typeof series.scale === "string" &&
          series.scale !== "x",
      )
      .map(({ series }) => {
        const key = series.scale as string;
        return {
          key,
          min: u.posToVal(yBottom, key),
          max: u.posToVal(yTop, key),
        };
      });

    // Atomic multi-axis commit: X (time) and every visible Y (amplitude)
    // land in one deferred redraw.
    u.batch(() => {
      u.setScale("x", { min: xMin, max: xMax });
      for (const zoom of yZooms) {
        u.setScale(zoom.key, { min: zoom.min, max: zoom.max });
      }
    });
  }

  return {
    hooks: {
      init(u) {
        uplot = u;
        plotArea = u.over;
        plotArea.appendChild(overlay);
        plotArea.addEventListener("mousedown", onPlotMouseDown);
      },
      destroy(u) {
        detachDragListeners();
        hideOverlay();
        u.over.removeEventListener("mousedown", onPlotMouseDown);
        if (overlay.parentElement === u.over) {
          u.over.removeChild(overlay);
        }
        plotArea = null;
        uplot = null;
      },
    },
  };
}
