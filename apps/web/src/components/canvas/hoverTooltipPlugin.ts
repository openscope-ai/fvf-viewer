/**
 * Waveform hover tooltip plugin (issue #150).
 *
 * While the pointer hovers the plot, uPlot's built-in cursor points render a
 * small dot on every visible channel line at the hovered x (the snap dot).
 * After `HOVER_DWELL_MS` of dwell on the *same* snap point — the nearest
 * visible channel sample within the trace-snap radius, i.e. the point the
 * trace-click selection would snap to — a minimalist tooltip shows that
 * sample's x (time) and y (channel value) coordinates in the channel's
 * canonical SI unit. Moving to a different sample or channel, leaving the
 * canvas, zooming, or starting any drag resets the dwell timer and hides
 * the tooltip.
 */

import uPlot from "uplot";
import { findNearestSampleIndex } from "../cursors/cursorPlugin";
import { formatTime } from "../cursors/siFormat";
import { formatReadoutChannelName } from "../../state/channelNamesStore";
import {
  formatChannelValue,
  getPhysicalChannelUnit,
  yScaleKey,
} from "../../capture/channelUnits";
import { effectiveTraceColor, resolveThemePalette } from "./themePalette";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import type { ParsedCapture } from "../../types/capture";
import type { ChannelTag } from "../../state/viewportStore";

/** Dwell time on the same snap point before the tooltip appears. */
export const HOVER_DWELL_MS = 500;

/**
 * Snap radius (plot px) around a channel's snap dot for the hover target —
 * identical to the trace-click selection radius (FOCUS_CLICK_SNAP_PX).
 */
export const HOVER_SNAP_PX = 48;

/** Sample window around the x-nearest index probed for the snap dot. */
const NEAREST_SAMPLE_WINDOW = 8;

/** Minimal uPlot surface the resolver touches. */
export interface UPlotLike {
  posToVal(px: number, scale: string): number;
  valToPos(val: number, scale: string): number;
  series: Array<{ scale?: string | number; show?: boolean }>;
  data: ArrayLike<ArrayLike<number | null> | null>;
}

export interface HoverSample {
  /** Index into `capture.channels`. */
  channelIndex: number;
  sampleIndex: number;
  /** Snap-dot position in plot-area CSS pixels. */
  x: number;
  y: number;
}

/**
 * Resolves the snap point for a plot-area pointer position: the nearest
 * visible channel sample (within `NEAREST_SAMPLE_WINDOW` of the x-nearest
 * index) whose rendered dot lies within `HOVER_SNAP_PX` of the pointer.
 * Returns null when no channel dot is in proximity.
 */
export function resolveHoverSample(
  u: UPlotLike,
  capture: ParsedCapture,
  point: { x: number; y: number },
  activeChannels: readonly ChannelTag[],
): HoverSample | null {
  const totalSamples = capture.timestamps.length;
  if (totalSamples === 0) return null;
  const time = u.posToVal(point.x, "x");
  const sample = findNearestSampleIndex(capture.timestamps, time);
  let best: HoverSample | null = null;
  let bestDistance = Infinity;
  capture.channels.forEach((channel, index) => {
    if (!activeChannels.includes(channel.name)) return;
    const series = u.series[index + 1];
    if (!series || series.show === false) return;
    const lane = u.data[index + 1];
    if (!lane) return;
    const key =
      typeof series.scale === "string" && series.scale !== "x"
        ? series.scale
        : yScaleKey(index);
    const from = Math.max(0, sample - NEAREST_SAMPLE_WINDOW);
    const to = Math.min(lane.length - 1, sample + NEAREST_SAMPLE_WINDOW);
    for (let s = from; s <= to; s += 1) {
      const value = lane[s];
      if (value == null || !Number.isFinite(value)) continue;
      const dotY = u.valToPos(value, key);
      const distance = Math.hypot(
        u.valToPos(capture.timestamps[s]!, "x") - point.x,
        dotY - point.y,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = {
          channelIndex: index,
          sampleIndex: s,
          x: u.valToPos(capture.timestamps[s]!, "x"),
          y: dotY,
        };
      }
    }
  });
  return best !== null && bestDistance <= HOVER_SNAP_PX ? best : null;
}

/** Builds the tooltip's coordinate text for one snap sample. */
export function formatHoverTooltipLines(
  capture: ParsedCapture,
  hover: HoverSample,
  customNames?: Record<string, string>,
): { name: string; x: string; y: string } {
  const channel = capture.channels[hover.channelIndex]!;
  const value = channel.data[hover.sampleIndex] ?? Number.NaN;
  const time = capture.timestamps[hover.sampleIndex] ?? 0;
  const unit = getPhysicalChannelUnit(capture, hover.channelIndex);
  return {
    name: formatReadoutChannelName(
      channel.name,
      channel.label,
      customNames?.[channel.name],
    ),
    x: formatTime(time),
    y: formatChannelValue(value, unit),
  };
}

export interface HoverTooltipPluginOptions {
  getCapture: () => ParsedCapture | null;
  getActiveChannels: () => readonly ChannelTag[];
  getCustomNames: () => Record<string, string>;
}

export function hoverTooltipPlugin(
  options: HoverTooltipPluginOptions,
): uPlot.Plugin {
  let uplot: uPlot | null = null;
  let plotArea: HTMLElement | null = null;
  let tooltip: HTMLDivElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastKey: string | null = null;
  let unsubscribeTheme: (() => void) | null = null;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function hide(): void {
    clearTimer();
    lastKey = null;
    if (tooltip) tooltip.style.display = "none";
  }

  function applyTheme(): void {
    if (!tooltip) return;
    const palette = resolveThemePalette(useThemeStore.getState().theme);
    tooltip.style.backgroundColor =
      useThemeStore.getState().theme === "light" ? "#1a1a1c" : "#0d0d0f";
    tooltip.style.borderColor = palette.ticks;
  }

  function show(hover: HoverSample): void {
    if (!uplot || !plotArea || !tooltip) return;
    const capture = options.getCapture();
    if (!capture) return;
    const lines = formatHoverTooltipLines(
      capture,
      hover,
      options.getCustomNames(),
    );
    const channel = capture.channels[hover.channelIndex]!;
    const color = effectiveTraceColor(
      useThemeStore.getState().theme,
      usePaletteStore.getState().customColors,
      channel.name,
    );
    tooltip.innerHTML = "";
    const name = document.createElement("span");
    name.className = "hover-tooltip-name";
    name.style.color = color;
    name.textContent = lines.name;
    const coords = document.createElement("span");
    coords.className = "hover-tooltip-coords";
    coords.textContent = `x ${lines.x}   y ${lines.y}`;
    tooltip.appendChild(name);
    tooltip.appendChild(coords);
    applyTheme();

    // Anchor beside the dot, flipped below / inside the plot when clamped.
    const bbox = uplot.bbox;
    const margin = 14;
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";
    tooltip.style.display = "block";
    const tooltipW = tooltip.offsetWidth || 160;
    const tooltipH = tooltip.offsetHeight || 40;
    let left = hover.x + margin;
    if (left + tooltipW > bbox.width - 4) {
      left = Math.max(4, hover.x - margin - tooltipW);
    }
    let top = hover.y - tooltipH - 10;
    if (top < 4) {
      top = Math.min(hover.y + 14, Math.max(4, bbox.height - tooltipH - 4));
    }
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function onMouseMove(event: MouseEvent): void {
    if (!uplot || !plotArea) return;
    const rect = plotArea.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    const capture = options.getCapture();
    if (!capture) {
      hide();
      return;
    }
    const hover = resolveHoverSample(
      uplot as unknown as UPlotLike,
      capture,
      point,
      options.getActiveChannels(),
    );
    if (!hover) {
      hide();
      return;
    }
    const key = `${hover.channelIndex}:${hover.sampleIndex}`;
    if (key !== lastKey) {
      clearTimer();
      lastKey = key;
      if (tooltip) tooltip.style.display = "none";
      timer = setTimeout(() => {
        timer = null;
        if (lastKey === key) show(hover);
      }, HOVER_DWELL_MS);
    }
  }

  return {
    hooks: {
      init(u) {
        uplot = u;
        plotArea = u.over;
        tooltip = document.createElement("div");
        tooltip.className = "hover-tooltip";
        tooltip.setAttribute("data-testid", "hover-tooltip");
        tooltip.setAttribute("role", "status");
        tooltip.style.display = "none";
        plotArea.appendChild(tooltip);
        plotArea.addEventListener("mousemove", onMouseMove);
        plotArea.addEventListener("mouseleave", hide);
        plotArea.addEventListener("mousedown", hide);
        // Theme restyle in place when the viewport theme changes while shown.
        unsubscribeTheme = useThemeStore.subscribe(() => applyTheme());
      },
      setScale() {
        // Zoom/pan moves the dot; the dwell restarts on the next mousemove.
        hide();
      },
      destroy() {
        clearTimer();
        if (unsubscribeTheme) {
          unsubscribeTheme();
          unsubscribeTheme = null;
        }
        if (plotArea) {
          plotArea.removeEventListener("mousemove", onMouseMove);
          plotArea.removeEventListener("mouseleave", hide);
          plotArea.removeEventListener("mousedown", hide);
          if (tooltip && tooltip.parentElement === plotArea) {
            plotArea.removeChild(tooltip);
          }
        }
        tooltip = null;
        plotArea = null;
        uplot = null;
      },
    },
  };
}
