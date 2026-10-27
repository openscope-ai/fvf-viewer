/**
 * uPlot measurement cursors plugin (Issue #14, architecture.md §4.2).
 *
 * Implements interactive dual measurement cursors (C1 #E040FB / C2 #B0B0B0):
 * - Snaps strictly to discrete sample indices [0, N-1] at 60 FPS
 * - Ctrl+drag (or Cmd+drag) moves cursor along horizontal axis
 * - Ctrl+click repositions active/selected cursor to clicked sample
 * - Ctrl+Left/Right arrows micro-step cursor by 1 sample
 * - Ctrl+wheel steps cursor with dynamic acceleration
 * - Escape key cancels active drag and restores pre-drag position
 * - Unmodified canvas drag leaves box-zoom completely untouched
 */

import uPlot from "uplot";
import {
  effectiveCursorColor,
  effectiveCursorStroke,
  resolveThemePalette,
} from "../canvas/themePalette";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import {
  useCursorStore,
  type CursorId,
  type HorizontalCursorId,
} from "../../state/cursorStore";
import {
  useCursorDisplayStore,
  type LineStyle,
} from "../../state/cursorDisplayStore";
import { useViewportStore } from "../../state/viewportStore";
import { yScaleKey } from "../../capture/channelUnits";
import { getCursorHandleAriaLabel, getCursorHandleTitle } from "./cursorHelp";
import type { ParsedCapture } from "../../types/capture";

export function findNearestSampleIndex(
  timestamps: ArrayLike<number>,
  targetTime: number,
): number {
  const len = timestamps.length;
  if (len === 0) return 0;
  if (targetTime <= timestamps[0]!) return 0;
  if (targetTime >= timestamps[len - 1]!) return len - 1;

  let low = 0;
  let high = len - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const val = timestamps[mid]!;
    if (val === targetTime) return mid;
    if (val < targetTime) low = mid + 1;
    else high = mid - 1;
  }
  const d1 = Math.abs(timestamps[low]! - targetTime);
  const d0 = Math.abs(timestamps[low - 1]! - targetTime);
  return d0 <= d1 ? low - 1 : low;
}

export interface CursorPluginOptions {
  getCapture: () => ParsedCapture | null;
}

/** Resolves the cursor palette for the active viewport theme (issue #38). */
function currentPalette() {
  return resolveThemePalette(useThemeStore.getState().theme);
}

/** Issue #40: effective cursor color — user override first, theme default second. */
function effectiveCursor(id: "C1" | "C2" | "Y1" | "Y2"): string {
  return effectiveCursorColor(
    useThemeStore.getState().theme,
    usePaletteStore.getState().customColors,
    id,
  );
}

/**
 * Issue #204: effective cursor stroke at the per-key opacity — the line
 * renders rgba() below full opacity while the handle keeps the solid
 * color so its label stays legible.
 */
function effectiveCursorStrokeCss(id: "C1" | "C2"): string {
  const { customColors, keyConfigs } = usePaletteStore.getState();
  return effectiveCursorStroke(
    useThemeStore.getState().theme,
    customColors,
    keyConfigs,
    id,
  );
}

/**
 * Issue #226 line styles: solid keeps the 2px background fill; dashed and
 * dotted switch to a 2px left border (same screen position — the element
 * is positioned by `left`) so the dash gaps show the plot behind the
 * cursor. Handles stay solid in every style.
 */
function applyCursorLineStyle(
  line: HTMLElement,
  strokeCss: string,
  style: LineStyle,
): void {
  if (style === "solid") {
    line.style.width = "2px";
    line.style.backgroundColor = strokeCss;
    line.style.borderLeft = "none";
  } else {
    line.style.width = "0";
    line.style.backgroundColor = "transparent";
    line.style.borderLeft = `2px ${style} ${strokeCss}`;
  }
}

/** Applies a cursor's colors + line style: rgba stroke, solid handle. */
function applyCursorPalette(
  line: HTMLElement,
  handle: HTMLElement,
  strokeCss: string,
  id: "C1" | "C2",
  lineStyle: LineStyle,
): void {
  applyCursorLineStyle(line, strokeCss, lineStyle);
  handle.style.backgroundColor = effectiveCursor(id);
  handle.style.color = currentPalette().cursorHandleText;
}

/** Issue #226: the cursor's configured line style (solid default). */
function effectiveLineStyle(id: "C1" | "C2"): LineStyle {
  return useCursorDisplayStore.getState().lineStyles[id];
}

export function cursorPlugin(options: CursorPluginOptions): uPlot.Plugin {
  let uplot: uPlot | null = null;
  let plotArea: HTMLElement | null = null;

  // DOM elements for C1
  const c1Line = document.createElement("div");
  c1Line.className = "cursor-line cursor-line--c1";
  c1Line.setAttribute("data-testid", "cursor-line-c1");
  c1Line.style.position = "absolute";
  c1Line.style.top = "0";
  c1Line.style.bottom = "0";
  c1Line.style.width = "2px";
  c1Line.style.display = "none";
  c1Line.style.zIndex = "10";
  c1Line.style.pointerEvents = "auto";
  c1Line.style.cursor = "col-resize";

  const c1Handle = document.createElement("div");
  c1Handle.className = "cursor-handle cursor-handle--c1";
  c1Handle.setAttribute("data-testid", "cursor-handle-c1");
  c1Handle.innerText = "C1";
  c1Handle.style.position = "absolute";
  c1Handle.style.top = "0";
  c1Handle.style.left = "-12px";
  c1Handle.style.width = "24px";
  c1Handle.style.height = "16px";
  c1Handle.style.lineHeight = "16px";
  c1Handle.style.textAlign = "center";
  c1Handle.style.fontSize = "10px";
  c1Handle.style.fontWeight = "700";
  applyCursorPalette(
    c1Line,
    c1Handle,
    effectiveCursorStrokeCss("C1"),
    "C1",
    effectiveLineStyle("C1"),
  );
  c1Handle.title = getCursorHandleTitle("C1");
  c1Handle.setAttribute("aria-label", getCursorHandleAriaLabel("C1"));
  c1Handle.style.borderRadius = "0 0 3px 3px";
  c1Handle.style.cursor = "pointer";
  c1Line.appendChild(c1Handle);

  // DOM elements for C2
  const c2Line = document.createElement("div");
  c2Line.className = "cursor-line cursor-line--c2";
  c2Line.setAttribute("data-testid", "cursor-line-c2");
  c2Line.style.position = "absolute";
  c2Line.style.top = "0";
  c2Line.style.bottom = "0";
  c2Line.style.width = "2px";
  c2Line.style.display = "none";
  c2Line.style.zIndex = "10";
  c2Line.style.pointerEvents = "auto";
  c2Line.style.cursor = "col-resize";

  const c2Handle = document.createElement("div");
  c2Handle.className = "cursor-handle cursor-handle--c2";
  c2Handle.setAttribute("data-testid", "cursor-handle-c2");
  c2Handle.innerText = "C2";
  c2Handle.style.position = "absolute";
  c2Handle.style.top = "0";
  c2Handle.style.left = "-12px";
  c2Handle.style.width = "24px";
  c2Handle.style.height = "16px";
  c2Handle.style.lineHeight = "16px";
  c2Handle.style.textAlign = "center";
  c2Handle.style.fontSize = "10px";
  c2Handle.style.fontWeight = "700";
  applyCursorPalette(
    c2Line,
    c2Handle,
    effectiveCursorStrokeCss("C2"),
    "C2",
    effectiveLineStyle("C2"),
  );
  c2Handle.title = getCursorHandleTitle("C2");
  c2Handle.setAttribute("aria-label", getCursorHandleAriaLabel("C2"));
  c2Handle.style.borderRadius = "0 0 3px 3px";
  c2Handle.style.cursor = "pointer";
  c2Line.appendChild(c2Handle);

  // DOM elements for horizontal cursors Y1 and Y2 (Issue #281)
  const y1Line = document.createElement("div");
  y1Line.className = "cursor-line cursor-line--y1 cursor-line--horizontal";
  y1Line.setAttribute("data-testid", "cursor-line-y1");
  y1Line.style.position = "absolute";
  y1Line.style.left = "0";
  y1Line.style.right = "0";
  y1Line.style.height = "2px";
  y1Line.style.backgroundColor = effectiveCursor("Y1");
  y1Line.style.display = "none";
  y1Line.style.zIndex = "10";
  y1Line.style.pointerEvents = "auto";
  y1Line.style.cursor = "row-resize";

  const y1Handle = document.createElement("div");
  y1Handle.className =
    "cursor-handle cursor-handle--y1 cursor-handle--horizontal";
  y1Handle.setAttribute("data-testid", "cursor-handle-y1");
  y1Handle.innerText = "Y1";
  y1Handle.style.position = "absolute";
  y1Handle.style.left = "0";
  y1Handle.style.top = "-9px";
  y1Handle.style.width = "26px";
  y1Handle.style.height = "18px";
  y1Handle.style.lineHeight = "18px";
  y1Handle.style.textAlign = "center";
  y1Handle.style.fontSize = "10px";
  y1Handle.style.fontWeight = "700";
  y1Handle.style.backgroundColor = effectiveCursor("Y1");
  y1Handle.style.color = currentPalette().cursorHandleText;
  y1Handle.style.borderRadius = "0 3px 3px 0";
  y1Handle.style.cursor = "pointer";
  y1Handle.title = getCursorHandleTitle("Y1");
  y1Handle.setAttribute("aria-label", getCursorHandleAriaLabel("Y1"));
  y1Line.appendChild(y1Handle);

  const y2Line = document.createElement("div");
  y2Line.className = "cursor-line cursor-line--y2 cursor-line--horizontal";
  y2Line.setAttribute("data-testid", "cursor-line-y2");
  y2Line.style.position = "absolute";
  y2Line.style.left = "0";
  y2Line.style.right = "0";
  y2Line.style.height = "2px";
  y2Line.style.backgroundColor = effectiveCursor("Y2");
  y2Line.style.display = "none";
  y2Line.style.zIndex = "10";
  y2Line.style.pointerEvents = "auto";
  y2Line.style.cursor = "row-resize";

  const y2Handle = document.createElement("div");
  y2Handle.className =
    "cursor-handle cursor-handle--y2 cursor-handle--horizontal";
  y2Handle.setAttribute("data-testid", "cursor-handle-y2");
  y2Handle.innerText = "Y2";
  y2Handle.style.position = "absolute";
  y2Handle.style.left = "0";
  y2Handle.style.top = "-9px";
  y2Handle.style.width = "26px";
  y2Handle.style.height = "18px";
  y2Handle.style.lineHeight = "18px";
  y2Handle.style.textAlign = "center";
  y2Handle.style.fontSize = "10px";
  y2Handle.style.fontWeight = "700";
  y2Handle.style.backgroundColor = effectiveCursor("Y2");
  y2Handle.style.color = currentPalette().cursorHandleText;
  y2Handle.style.borderRadius = "0 3px 3px 0";
  y2Handle.style.cursor = "pointer";
  y2Handle.title = getCursorHandleTitle("Y2");
  y2Handle.setAttribute("aria-label", getCursorHandleAriaLabel("Y2"));
  y2Line.appendChild(y2Handle);

  let activeDraggingCursor: CursorId | null = null;
  let preDragSampleIndex = 0;
  let activeDraggingYCursor: HorizontalCursorId | null = null;
  let preDragYValue = 0;
  let unsubscribeStore: (() => void) | null = null;
  let unsubscribeTheme: (() => void) | null = null;
  let unsubscribePalette: (() => void) | null = null;
  let unsubscribeCursorDisplay: (() => void) | null = null;
  let unsubscribeViewport: (() => void) | null = null;
  let pendingClientX: number | null = null;
  let pendingClientY: number | null = null;
  let rafId: number | null = null;
  let rafYId: number | null = null;

  function updateVisuals() {
    if (!uplot) return;
    // Issue #38/#40: cursor line/handle colors follow the active viewport
    // theme and any user palette overrides
    applyCursorPalette(
      c1Line,
      c1Handle,
      effectiveCursorStrokeCss("C1"),
      "C1",
      effectiveLineStyle("C1"),
    );
    applyCursorPalette(
      c2Line,
      c2Handle,
      effectiveCursorStrokeCss("C2"),
      "C2",
      effectiveLineStyle("C2"),
    );
    const capture = options.getCapture();
    if (!capture || capture.timestamps.length === 0) {
      c1Line.style.display = "none";
      c2Line.style.display = "none";
      return;
    }

    const { timestamps } = capture;
    const totalSamples = timestamps.length;
    const state = useCursorStore.getState();

    // Update C1
    if (state.c1Active) {
      const idx1 = Math.max(0, Math.min(state.c1SampleIndex, totalSamples - 1));
      const t1 = timestamps[idx1]!;
      const pos1 = uplot.valToPos(t1, "x");
      c1Line.style.left = `${pos1}px`;
      c1Line.style.display = "block";
      if (state.selectedCursor === "C1") {
        c1Line.style.boxShadow = `0 0 10px ${effectiveCursor("C1")}`;
        c1Handle.style.boxShadow = `0 0 8px #ffffff`;
      } else {
        c1Line.style.boxShadow = "none";
        c1Handle.style.boxShadow = "none";
      }
    } else {
      c1Line.style.display = "none";
    }

    // Update C2
    if (state.c2Active) {
      const idx2 = Math.max(0, Math.min(state.c2SampleIndex, totalSamples - 1));
      const t2 = timestamps[idx2]!;
      const pos2 = uplot.valToPos(t2, "x");
      c2Line.style.left = `${pos2}px`;
      c2Line.style.display = "block";
      if (state.selectedCursor === "C2") {
        c2Line.style.boxShadow = `0 0 10px ${effectiveCursor("C2")}`;
        c2Handle.style.boxShadow = `0 0 8px #ffffff`;
      } else {
        c2Line.style.boxShadow = "none";
        c2Handle.style.boxShadow = "none";
      }
    } else {
      c2Line.style.display = "none";
    }

    // Update Y1 & Y2 (Issue #281)
    const selectedChannel =
      useViewportStore.getState().selectedChannel ?? capture.channels[0]?.name;
    const chIdx = capture.channels.findIndex((c) => c.name === selectedChannel);
    if (chIdx !== -1) {
      const scaleKey = yScaleKey(chIdx);
      const info = capture.metadata.channels[chIdx];
      const scaleMin = uplot.scales[scaleKey]?.min ?? info?.windowMin ?? -1;
      const scaleMax = uplot.scales[scaleKey]?.max ?? info?.windowMax ?? 1;
      const yMin = Number.isFinite(scaleMin) ? scaleMin : -1;
      const yMax = Number.isFinite(scaleMax) ? scaleMax : 1;

      const y1Color = effectiveCursor("Y1");
      const y2Color = effectiveCursor("Y2");
      const handleTextColor = currentPalette().cursorHandleText;

      // Update Y1
      if (state.y1Active) {
        const val1 =
          state.y1Value !== null ? state.y1Value : yMin + 0.75 * (yMax - yMin);
        if (state.y1Value === null) {
          state.setHorizontalCursorValue("Y1", val1);
        }
        const pos1 = uplot.valToPos(val1, scaleKey);
        y1Line.style.top = `${pos1}px`;
        y1Line.style.display = "block";
        y1Line.style.backgroundColor = y1Color;
        y1Handle.style.backgroundColor = y1Color;
        y1Handle.style.color = handleTextColor;
        if (state.selectedYCursor === "Y1") {
          y1Line.style.boxShadow = `0 0 10px ${y1Color}`;
          y1Handle.style.boxShadow = `0 0 8px #ffffff`;
        } else {
          y1Line.style.boxShadow = "none";
          y1Handle.style.boxShadow = "none";
        }
      } else {
        y1Line.style.display = "none";
      }

      // Update Y2
      if (state.y2Active) {
        const val2 =
          state.y2Value !== null ? state.y2Value : yMin + 0.25 * (yMax - yMin);
        if (state.y2Value === null) {
          state.setHorizontalCursorValue("Y2", val2);
        }
        const pos2 = uplot.valToPos(val2, scaleKey);
        y2Line.style.top = `${pos2}px`;
        y2Line.style.display = "block";
        y2Line.style.backgroundColor = y2Color;
        y2Handle.style.backgroundColor = y2Color;
        y2Handle.style.color = handleTextColor;
        if (state.selectedYCursor === "Y2") {
          y2Line.style.boxShadow = `0 0 10px ${y2Color}`;
          y2Handle.style.boxShadow = `0 0 8px #ffffff`;
        } else {
          y2Line.style.boxShadow = "none";
          y2Handle.style.boxShadow = "none";
        }
      } else {
        y2Line.style.display = "none";
      }
    } else {
      y1Line.style.display = "none";
      y2Line.style.display = "none";
    }
  }

  function getPlotX(clientX: number): number {
    if (!plotArea) return 0;
    const rect = plotArea.getBoundingClientRect();
    return Math.min(Math.max(clientX - rect.left, 0), rect.width);
  }

  function getPlotY(clientY: number): number {
    if (!plotArea) return 0;
    const rect = plotArea.getBoundingClientRect();
    return Math.min(Math.max(clientY - rect.top, 0), rect.height);
  }

  function processDragMove() {
    rafId = null;
    if (
      pendingClientX === null ||
      !activeDraggingCursor ||
      !uplot ||
      !plotArea
    ) {
      return;
    }
    const capture = options.getCapture();
    if (!capture) return;

    const xPx = getPlotX(pendingClientX);
    const timeVal = uplot.posToVal(xPx, "x");
    const idx = findNearestSampleIndex(capture.timestamps, timeVal);
    useCursorStore
      .getState()
      .setCursorSample(activeDraggingCursor, idx, capture.timestamps.length);
  }

  function processYDragMove() {
    rafYId = null;
    if (
      pendingClientY === null ||
      !activeDraggingYCursor ||
      !uplot ||
      !plotArea
    ) {
      return;
    }
    const capture = options.getCapture();
    if (!capture) return;
    const selectedChannel =
      useViewportStore.getState().selectedChannel ?? capture.channels[0]?.name;
    const chIdx = capture.channels.findIndex((c) => c.name === selectedChannel);
    if (chIdx === -1) return;
    const scaleKey = yScaleKey(chIdx);
    const yPx = getPlotY(pendingClientY);
    const val = uplot.posToVal(yPx, scaleKey);
    useCursorStore
      .getState()
      .setHorizontalCursorValue(activeDraggingYCursor, val);
  }

  function endDrag() {
    activeDraggingCursor = null;
    pendingClientX = null;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    document.removeEventListener("mousemove", onMouseMove, { capture: true });
    document.removeEventListener("mouseup", onMouseUp, { capture: true });
    window.removeEventListener("keydown", onKeyDown, { capture: true });
    window.removeEventListener("blur", onBlur, { capture: true });
  }

  function endYDrag() {
    activeDraggingYCursor = null;
    pendingClientY = null;
    if (rafYId !== null) {
      cancelAnimationFrame(rafYId);
      rafYId = null;
    }
    document.removeEventListener("mousemove", onYMouseMove, { capture: true });
    document.removeEventListener("mouseup", onYMouseUp, { capture: true });
    window.removeEventListener("keydown", onYKeyDown, { capture: true });
    window.removeEventListener("blur", onYBlur, { capture: true });
  }

  function onYMouseMove(event: MouseEvent) {
    if (!activeDraggingYCursor || !uplot || !plotArea) return;
    if ((event.buttons & 1) === 0) {
      endYDrag();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    pendingClientY = event.clientY;
    if (rafYId === null) {
      rafYId = requestAnimationFrame(processYDragMove);
    }
  }

  function onYMouseUp(event: MouseEvent) {
    if (!activeDraggingYCursor) return;
    event.preventDefault();
    event.stopPropagation();
    if (rafYId !== null) {
      cancelAnimationFrame(rafYId);
      rafYId = null;
      processYDragMove();
    }
    endYDrag();
  }

  function onYBlur() {
    if (activeDraggingYCursor) {
      endYDrag();
    }
  }

  function onYKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && activeDraggingYCursor) {
      event.preventDefault();
      event.stopPropagation();
      const cursorToRestore = activeDraggingYCursor;
      endYDrag();
      useCursorStore
        .getState()
        .setHorizontalCursorValue(cursorToRestore, preDragYValue);
    }
  }

  function onYLineMouseDown(id: HorizontalCursorId, event: MouseEvent) {
    if (event.button !== 0 || !uplot || !plotArea) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    activeDraggingYCursor = id;
    preDragYValue =
      (id === "Y1"
        ? useCursorStore.getState().y1Value
        : useCursorStore.getState().y2Value) ?? 0;
    useCursorStore.getState().selectHorizontalCursor(id);

    document.addEventListener("mousemove", onYMouseMove, { capture: true });
    document.addEventListener("mouseup", onYMouseUp, { capture: true });
    window.addEventListener("keydown", onYKeyDown, { capture: true });
    window.addEventListener("blur", onYBlur, { capture: true });
  }

  function onYLineClick(id: HorizontalCursorId, event: MouseEvent) {
    event.stopPropagation();
    useCursorStore.getState().selectHorizontalCursor(id);
  }

  function onLineClick(id: CursorId, event: MouseEvent) {
    event.stopPropagation();
    useCursorStore.getState().selectCursor(id);
  }

  function onMouseDown(event: MouseEvent) {
    if (event.button !== 0 || !uplot || !plotArea) return;
    const isCtrlOrCmd = event.ctrlKey || event.metaKey;
    if (!isCtrlOrCmd) return;

    const capture = options.getCapture();
    if (!capture || capture.timestamps.length === 0) return;
    const totalSamples = capture.timestamps.length;
    const state = useCursorStore.getState();

    // Check if clicking near C1 or C2
    const xPx = getPlotX(event.clientX);
    const clickTime = uplot.posToVal(xPx, "x");
    const sampleIdx = findNearestSampleIndex(capture.timestamps, clickTime);

    let targetCursor: CursorId | null = null;

    if (state.c1Active && state.c2Active) {
      const x1 = uplot.valToPos(capture.timestamps[state.c1SampleIndex]!, "x");
      const x2 = uplot.valToPos(capture.timestamps[state.c2SampleIndex]!, "x");
      const dist1 = Math.abs(xPx - x1);
      const dist2 = Math.abs(xPx - x2);
      if (dist1 <= 12 && dist1 <= dist2) {
        targetCursor = "C1";
      } else if (dist2 <= 12) {
        targetCursor = "C2";
      }
    } else if (state.c1Active) {
      const x1 = uplot.valToPos(capture.timestamps[state.c1SampleIndex]!, "x");
      if (Math.abs(xPx - x1) <= 12) {
        targetCursor = "C1";
      }
    } else if (state.c2Active) {
      const x2 = uplot.valToPos(capture.timestamps[state.c2SampleIndex]!, "x");
      if (Math.abs(xPx - x2) <= 12) {
        targetCursor = "C2";
      }
    }

    const candidateCursor =
      targetCursor ??
      state.selectedCursor ??
      (state.c1Active ? "C1" : state.c2Active ? "C2" : null);
    const preDragIndex =
      candidateCursor === "C1"
        ? state.c1SampleIndex
        : candidateCursor === "C2"
          ? state.c2SampleIndex
          : 0;

    // Direct relocation (AC4) or line grab (AC3)
    if (!targetCursor && candidateCursor) {
      targetCursor = candidateCursor;
      state.setCursorSample(candidateCursor, sampleIdx, totalSamples);
      state.selectCursor(candidateCursor);
    }

    if (targetCursor) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      activeDraggingCursor = targetCursor;
      preDragSampleIndex = preDragIndex;
      state.selectCursor(targetCursor);

      document.addEventListener("mousemove", onMouseMove, { capture: true });
      document.addEventListener("mouseup", onMouseUp, { capture: true });
      window.addEventListener("keydown", onKeyDown, { capture: true });
      window.addEventListener("blur", onBlur, { capture: true });
    }
  }

  function onBlur() {
    if (activeDraggingCursor) {
      endDrag();
    }
  }

  function onMouseMove(event: MouseEvent) {
    if (!activeDraggingCursor || !uplot || !plotArea) return;
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

  function onMouseUp(event: MouseEvent) {
    if (!activeDraggingCursor) return;
    event.preventDefault();
    event.stopPropagation();

    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
      processDragMove();
    }
    endDrag();
  }

  function onKeyDown(event: KeyboardEvent) {
    // AC7: Escape cancels drag
    if (event.key === "Escape" && activeDraggingCursor) {
      event.preventDefault();
      event.stopPropagation();
      const cursorToRestore = activeDraggingCursor;
      endDrag();

      const capture = options.getCapture();
      if (capture) {
        useCursorStore
          .getState()
          .setCursorSample(
            cursorToRestore,
            preDragSampleIndex,
            capture.timestamps.length,
          );
      }
      return;
    }

    // AC5: Ctrl + Left/Right arrows micro-stepping for vertical cursors
    if (
      (event.ctrlKey || event.metaKey) &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      const state = useCursorStore.getState();
      const selected = state.selectedCursor;
      if (selected) {
        const capture = options.getCapture();
        if (capture) {
          event.preventDefault();
          state.stepCursor(
            selected,
            event.key === "ArrowLeft" ? -1 : 1,
            capture.timestamps.length,
          );
        }
      }
    }

    // Ctrl + Up/Down arrows micro-stepping for horizontal cursors
    if (
      (event.ctrlKey || event.metaKey) &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      const state = useCursorStore.getState();
      const selectedY = state.selectedYCursor;
      if (selectedY && uplot) {
        const capture = options.getCapture();
        if (capture) {
          const selectedChannel =
            useViewportStore.getState().selectedChannel ??
            capture.channels[0]?.name;
          const chIdx = capture.channels.findIndex(
            (c) => c.name === selectedChannel,
          );
          if (chIdx !== -1) {
            const scaleKey = yScaleKey(chIdx);
            const scale = uplot.scales[scaleKey];
            const info = capture.metadata.channels[chIdx];
            const scaleMin = scale?.min ?? info?.windowMin ?? -1;
            const scaleMax = scale?.max ?? info?.windowMax ?? 1;
            const span = scaleMax > scaleMin ? scaleMax - scaleMin : 2;
            const step = span * 0.01 * (event.key === "ArrowUp" ? 1 : -1);
            event.preventDefault();
            state.stepHorizontalCursor(selectedY, step);
          }
        }
      }
    }
  }

  function onWheel(event: WheelEvent) {
    // AC6: Ctrl + wheel steps cursor with dynamic acceleration
    if (event.ctrlKey || event.metaKey) {
      const state = useCursorStore.getState();
      const selected = state.selectedCursor;
      if (!selected) return;

      const capture = options.getCapture();
      if (!capture) return;

      event.preventDefault();
      event.stopPropagation();

      // Velocity acceleration
      const absDelta = Math.abs(event.deltaY);
      const stepMagnitude = Math.max(
        1,
        Math.min(500, Math.round(absDelta / 20)),
      );
      const delta = event.deltaY < 0 ? -stepMagnitude : stepMagnitude;

      state.stepCursor(selected, delta, capture.timestamps.length);
    }
  }

  return {
    hooks: {
      init(u) {
        uplot = u;
        plotArea = u.over;
        plotArea.appendChild(c1Line);
        plotArea.appendChild(c2Line);
        plotArea.appendChild(y1Line);
        plotArea.appendChild(y2Line);

        // Click line or handle to select cursor (AC2)
        c1Line.addEventListener("click", (e) => onLineClick("C1", e));
        c2Line.addEventListener("click", (e) => onLineClick("C2", e));
        y1Line.addEventListener("click", (e) => onYLineClick("Y1", e));
        y2Line.addEventListener("click", (e) => onYLineClick("Y2", e));
        y1Line.addEventListener("mousedown", (e) => onYLineMouseDown("Y1", e));
        y2Line.addEventListener("mousedown", (e) => onYLineMouseDown("Y2", e));

        plotArea.addEventListener("mousedown", onMouseDown, { capture: true });
        plotArea.addEventListener("wheel", onWheel, { passive: false });
        window.addEventListener("keydown", onKeyDown);

        unsubscribeStore = useCursorStore.subscribe(() => {
          updateVisuals();
        });

        // Issue #38/#40: restyle cursors in place when the viewport theme
        // or the user palette changes
        unsubscribeTheme = useThemeStore.subscribe(() => {
          updateVisuals();
        });
        unsubscribePalette = usePaletteStore.subscribe(() => {
          updateVisuals();
        });
        // Issue #226: line-style edits restyle the lines in place.
        unsubscribeCursorDisplay = useCursorDisplayStore.subscribe(() => {
          updateVisuals();
        });

        // Channel switch re-binding (Issue #281)
        let lastSelectedChannel = useViewportStore.getState().selectedChannel;
        unsubscribeViewport = useViewportStore.subscribe((vpState) => {
          if (
            vpState.selectedChannel &&
            vpState.selectedChannel !== lastSelectedChannel
          ) {
            const prevName = lastSelectedChannel;
            lastSelectedChannel = vpState.selectedChannel;
            const capture = options.getCapture();
            if (capture && prevName) {
              const prevIdx = capture.channels.findIndex(
                (c) => c.name === prevName,
              );
              const nextIdx = capture.channels.findIndex(
                (c) => c.name === lastSelectedChannel,
              );
              if (prevIdx !== -1 && nextIdx !== -1) {
                const prevScaleKey = yScaleKey(prevIdx);
                const nextScaleKey = yScaleKey(nextIdx);
                const prevScale = uplot?.scales[prevScaleKey];
                const nextScale = uplot?.scales[nextScaleKey];
                const prevInfo = capture.metadata.channels[prevIdx];
                const nextInfo = capture.metadata.channels[nextIdx];
                const prevMin = prevScale?.min ?? prevInfo?.windowMin ?? -1;
                const prevMax = prevScale?.max ?? prevInfo?.windowMax ?? 1;
                const nextMin = nextScale?.min ?? nextInfo?.windowMin ?? -1;
                const nextMax = nextScale?.max ?? nextInfo?.windowMax ?? 1;
                useCursorStore
                  .getState()
                  .rebindHorizontalCursors(
                    prevMin,
                    prevMax,
                    nextMin,
                    nextMax,
                    lastSelectedChannel,
                  );
              }
            }
            updateVisuals();
          }
        });

        updateVisuals();
      },
      draw() {
        updateVisuals();
      },
      setScale() {
        updateVisuals();
      },
      destroy() {
        endDrag();
        endYDrag();
        if (unsubscribeStore) {
          unsubscribeStore();
          unsubscribeStore = null;
        }
        if (unsubscribeTheme) {
          unsubscribeTheme();
          unsubscribeTheme = null;
        }
        if (unsubscribePalette) {
          unsubscribePalette();
          unsubscribePalette = null;
        }
        if (unsubscribeCursorDisplay) {
          unsubscribeCursorDisplay();
          unsubscribeCursorDisplay = null;
        }
        if (unsubscribeViewport) {
          unsubscribeViewport();
          unsubscribeViewport = null;
        }
        window.removeEventListener("keydown", onKeyDown);
        if (plotArea) {
          plotArea.removeEventListener("mousedown", onMouseDown, {
            capture: true,
          });
          plotArea.removeEventListener("wheel", onWheel);
          if (c1Line.parentElement === plotArea) plotArea.removeChild(c1Line);
          if (c2Line.parentElement === plotArea) plotArea.removeChild(c2Line);
          if (y1Line.parentElement === plotArea) plotArea.removeChild(y1Line);
          if (y2Line.parentElement === plotArea) plotArea.removeChild(y2Line);
        }
        plotArea = null;
        uplot = null;
      },
    },
  };
}
