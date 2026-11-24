/**
 * PNG snapshot export core (issue #18, overview §5.2-E): offscreen
 * compositing pass. Raw `canvas.toBlob()` on the uPlot base canvas cannot
 * capture DOM-overlay elements, so the exporter draws the base canvas onto a
 * device-pixel-ratio-scaled export canvas and then explicitly re-draws the
 * overlay state — C1/C2 cursor lines + handles, out-of-view recovery badges,
 * and the visible-channel legend — before finalizing with `canvas.toBlob()`.
 */

import type uPlot from "uplot";
import type { ParsedCapture } from "../../types/capture";
import type {
  ReadoutCardSnapshot,
  ReadoutSnapshotRow,
} from "../cursors/readoutSnapshot";
import {
  buildChartSpec,
  cssPxRatio,
  syncChartAdapters,
} from "../canvas/axesConfig";
import { DARK_THEME, LIGHT_THEME } from "../canvas/themePalette";
import type { ChartRenderState, LaneWeights } from "../canvas/chartRenderState";
import type { ChannelDisplayConfigs } from "../canvas/channelDisplay";
import {
  createTimeAxisAdapter,
  type TimeAxisUnitKey,
} from "../canvas/timeAxis";
import type { LineStyle } from "../../state/cursorDisplayStore";
import { createYAxisAdapter, type YAxisAdapter } from "../canvas/yAxis";
import { buildDisplayData, yScaleKey } from "../../capture/channelUnits";
import {
  buildChannelCatalog,
  type ChannelCatalog,
} from "../../capture/channelCatalog";

export interface SnapshotOverlayState {
  /** Effective (theme + user override) cursor colors. */
  cursor1: string;
  cursor2: string;
  /**
   * Issue #226: per-cursor line styles; omitted/`solid` keeps the plain
   * filled line. `dashed`/`dotted` stroke the line with a dash pattern
   * instead of filling it, mirroring the live canvas border rendering.
   */
  lineStyles?: { C1: LineStyle; C2: LineStyle };
  /** Active viewport theme background (fills axis margins too). */
  background: string;
  /** Visible-channel legend entries (label + effective trace color). */
  legend: Array<{ label: string; color: string }>;
  /** Currently selected cursor (handle highlight). */
  selected: "C1" | "C2" | null;
  /** Selected-handle outline; readable against the chosen background. */
  selectedRingColor?: string;
}

export interface SnapshotCursorState {
  c1Active: boolean;
  c1SampleIndex: number;
  c2Active: boolean;
  c2SampleIndex: number;
}

export interface SnapshotOptions {
  /** Device pixel ratio; defaults to the live `devicePixelRatio`. */
  pixelRatio?: number;
  /**
   * Issue #252: skip every background fill for a transparent-alpha
   * export (the selected theme's ink on transparency).
   */
  transparent?: boolean;
  cursor?: SnapshotCursorState;
  /**
   * Floating cursor readout card at its live canvas position (issue #58).
   * `null`/omitted: the card is not rendered (no active cursors).
   */
  readoutCard?: ReadoutCardSnapshot | null;
}

export interface ComposedSnapshot {
  canvas: HTMLCanvasElement;
  /** CSS-pixel size of the composite (canvas backing store is × pixelRatio). */
  cssWidth: number;
  cssHeight: number;
  pixelRatio: number;
  /** Active adaptive time unit of the export's X axis (issue #63). */
  timeAxisUnit?: TimeAxisUnitKey;
  /** Active adaptive Y unit of the export's Y axis (issue #86). */
  yAxisUnit?: string;
}

const CURSOR_LINE_WIDTH_PX = 2;

/**
 * Issue #226 dash patterns (canvas-space CSS px): `null` = solid fill.
 * Dotted uses round caps so each dash reads as a dot.
 */
export function cursorLineDashPattern(style: LineStyle): number[] | null {
  if (style === "dashed") return [6, 4];
  if (style === "dotted") return [1, 3];
  return null;
}
const CURSOR_HANDLE_WIDTH_PX = 24;
const CURSOR_HANDLE_HEIGHT_PX = 16;
const BADGE_WIDTH_PX = 56;
const BADGE_HEIGHT_PX = 16;
const BADGE_MARGIN_PX = 4;
const LEGEND_SWATCH_WIDTH_PX = 14;
const LEGEND_SWATCH_HEIGHT_PX = 3;
const LEGEND_ROW_HEIGHT_PX = 14;
const READOUT_CARD_TITLE_HEIGHT_PX = 25;
const READOUT_CARD_ROW_HEIGHT_PX = 17;
const READOUT_CARD_PAD_X_PX = 12;
const READOUT_CARD_RADIUS_PX = 8;

/** Chrome colors for the composited readout card per snapshot theme. */
interface ReadoutCardChrome {
  panel: string;
  border: string;
  titleBar: string;
  titleText: string;
  valueText: string;
  arrowText: string;
}

const DARK_READOUT_CHROME: ReadoutCardChrome = {
  panel: "#0C0C0C",
  border: "#2A2A2A",
  titleBar: "#181818",
  titleText: "#888888",
  valueText: "#E0E0E0",
  arrowText: "#888888",
};

const LIGHT_READOUT_CHROME: ReadoutCardChrome = {
  panel: "#FFFFFF",
  border: "#C8C8C8",
  titleBar: "#F0F0F0",
  titleText: "#555555",
  valueText: "#222222",
  arrowText: "#555555",
};

/** Promise wrapper around the finalizing `canvas.toBlob("image/png")` pass. */
export function snapshotToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("canvas.toBlob returned null"));
      }
    }, "image/png");
  });
}

/**
 * Builds the offscreen composite. Everything is drawn in CSS-pixel
 * coordinates under a `pixelRatio` context transform, so the export stays
 * crisp at device pixel ratio (HiDPI) without any coordinate math changes.
 */
export function composeSnapshotCanvas(
  uplot: uPlot,
  capture: ParsedCapture,
  overlay: SnapshotOverlayState,
  options: SnapshotOptions = {},
): ComposedSnapshot {
  const pixelRatio = options.pixelRatio ?? (globalThis.devicePixelRatio || 1);
  const cssWidth = uplot.width;
  const cssHeight = uplot.height;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(pixelRatio, pixelRatio);

  // 1. Background: the base canvas leaves axis margins transparent.
  // Issue #252: `transparent` exports keep the alpha channel (no fill).
  if (!options.transparent) {
    ctx.fillStyle = overlay.background;
    ctx.fillRect(0, 0, cssWidth, cssHeight);
  }

  // 2. The uPlot base render (waveform, grid, axes) at 1:1 CSS mapping.
  ctx.drawImage(uplot.ctx.canvas, 0, 0, cssWidth, cssHeight);

  // 3. Explicit overlay re-draw in CSS coordinates. uPlot's bbox is in the
  // base canvas's DEVICE pixels (plotLft = plotLftCss * instancePxRatio),
  // so it converts back to CSS px using the instance's own ratio — not the
  // export pixelRatio (they differ when exporting above the live dpr).
  const bbox = uplot.bbox;
  const instancePxRatio = cssPxRatio(uplot);
  const plotLeft = bbox.left / instancePxRatio;
  const plotTop = bbox.top / instancePxRatio;
  const plotWidth = bbox.width / instancePxRatio;
  const plotHeight = bbox.height / instancePxRatio;
  const cursor = options.cursor ?? {
    c1Active: false,
    c1SampleIndex: 0,
    c2Active: false,
    c2SampleIndex: 0,
  };

  const totalSamples = capture.timestamps.length;
  const xMin = uplot.scales.x?.min ?? null;
  const xMax = uplot.scales.x?.max ?? null;

  const cursorSpecs: Array<{
    id: "C1" | "C2";
    active: boolean;
    sampleIndex: number;
    color: string;
  }> = [
    {
      id: "C1",
      active: cursor.c1Active,
      sampleIndex: Math.max(
        0,
        Math.min(cursor.c1SampleIndex, totalSamples - 1),
      ),
      color: overlay.cursor1,
    },
    {
      id: "C2",
      active: cursor.c2Active,
      sampleIndex: Math.max(
        0,
        Math.min(cursor.c2SampleIndex, totalSamples - 1),
      ),
      color: overlay.cursor2,
    },
  ];

  // Recovery badges first (they pin to the margins when the cursor is
  // outside the visible window; the line itself is not drawn then).
  let badgeRow = 0;
  for (const spec of cursorSpecs) {
    if (!spec.active || xMin === null || xMax === null) continue;
    const time = capture.timestamps[spec.sampleIndex];
    if (time === undefined) continue;
    if (time >= xMin && time <= xMax) continue;

    const isLeft = time < xMin;
    const x = isLeft
      ? plotLeft + BADGE_MARGIN_PX
      : plotLeft + plotWidth - BADGE_MARGIN_PX - BADGE_WIDTH_PX;
    const y = plotTop + BADGE_MARGIN_PX + badgeRow * (BADGE_HEIGHT_PX + 4);
    badgeRow += 1;

    ctx.fillStyle = overlay.background;
    ctx.fillRect(x, y, BADGE_WIDTH_PX, BADGE_HEIGHT_PX);
    ctx.strokeStyle = spec.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, BADGE_WIDTH_PX - 1, BADGE_HEIGHT_PX - 1);
    ctx.fillStyle = spec.color;
    ctx.font = "700 10px system-ui, -apple-system, sans-serif";
    ctx.textBaseline = "middle";
    const label = spec.id === "C1" ? "◀ C1" : "C2 ▶";
    const labelX = isLeft
      ? x + 6
      : x + BADGE_WIDTH_PX - 6 - ctx.measureText(label).width;
    ctx.fillText(label, labelX, y + BADGE_HEIGHT_PX / 2);
  }

  // Cursor lines + handles for cursors inside the visible window.
  for (const spec of cursorSpecs) {
    if (!spec.active) continue;
    const time = capture.timestamps[spec.sampleIndex];
    if (time === undefined) continue;
    if (xMin !== null && xMax !== null && (time < xMin || time > xMax)) {
      continue; // pinned outside: only the recovery badge represents it
    }
    // valToPos returns plot-area-relative CSS px; offset by the plot's
    // left edge to land in full-chart composite coordinates.
    const x = plotLeft + uplot.valToPos(time, "x");
    // Issue #226: dashed/dotted cursors stroke with a dash pattern
    // instead of the solid fill; the handle above stays solid.
    const dash = cursorLineDashPattern(
      overlay.lineStyles?.[spec.id] ?? "solid",
    );
    if (dash) {
      ctx.save();
      ctx.strokeStyle = spec.color;
      ctx.lineWidth = CURSOR_LINE_WIDTH_PX;
      ctx.lineCap = "round";
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotTop + plotHeight);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = spec.color;
      ctx.fillRect(
        x - CURSOR_LINE_WIDTH_PX / 2,
        plotTop,
        CURSOR_LINE_WIDTH_PX,
        plotHeight,
      );
    }

    const handleX = x - CURSOR_HANDLE_WIDTH_PX / 2;
    ctx.fillRect(
      handleX,
      plotTop,
      CURSOR_HANDLE_WIDTH_PX,
      CURSOR_HANDLE_HEIGHT_PX,
    );
    if (overlay.selected === spec.id) {
      ctx.strokeStyle = overlay.selectedRingColor ?? "#ffffff";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        handleX + 0.5,
        plotTop + 0.5,
        CURSOR_HANDLE_WIDTH_PX - 1,
        CURSOR_HANDLE_HEIGHT_PX - 1,
      );
    }
    ctx.fillStyle = overlay.background;
    ctx.font = "700 10px system-ui, -apple-system, sans-serif";
    ctx.textBaseline = "middle";
    const labelWidth = ctx.measureText(spec.id).width;
    ctx.fillText(
      spec.id,
      x - labelWidth / 2,
      plotTop + CURSOR_HANDLE_HEIGHT_PX / 2,
    );
  }

  // Legend: visible-channel swatches + labels at the top-left of the plot.
  let legendY = plotTop + 6;
  for (const entry of overlay.legend) {
    ctx.fillStyle = entry.color;
    ctx.fillRect(
      plotLeft + 8,
      legendY,
      LEGEND_SWATCH_WIDTH_PX,
      LEGEND_SWATCH_HEIGHT_PX,
    );
    ctx.fillStyle = legendTextColor(overlay);
    ctx.font = "10px system-ui, -apple-system, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(
      entry.label,
      plotLeft + 8 + LEGEND_SWATCH_WIDTH_PX + 5,
      legendY + 2,
    );
    legendY += LEGEND_ROW_HEIGHT_PX;
  }

  // Issue #58: the floating cursor readout card, composited last so it
  // overlays the legend exactly like the live DOM stacking order.
  if (options.readoutCard) {
    drawReadoutCard(ctx, options.readoutCard, overlay);
  }

  return { canvas, cssWidth, cssHeight, pixelRatio };
}

function traceRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.arcTo(x + width, y, x + width, y + radius, radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
  ctx.lineTo(x + radius, y + height);
  ctx.arcTo(x, y + height, x, y + height - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/**
 * Issue #58: composites the floating cursor readout card at its live
 * canvas position and state. The card chrome follows the snapshot theme:
 * the dark HUD style for Dark OLED exports and a contrast-adapted light
 * palette for print-inverted exports (selected via the overlay background,
 * matching the legend text tone derivation).
 */
function drawReadoutCard(
  ctx: CanvasRenderingContext2D,
  card: ReadoutCardSnapshot,
  overlay: SnapshotOverlayState,
): void {
  const chrome =
    overlay.background === "#FFFFFF"
      ? LIGHT_READOUT_CHROME
      : DARK_READOUT_CHROME;

  ctx.save();
  traceRoundedRectPath(
    ctx,
    card.x,
    card.y,
    card.width,
    card.height,
    READOUT_CARD_RADIUS_PX,
  );
  ctx.fillStyle = chrome.panel;
  ctx.fill();
  ctx.strokeStyle = chrome.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.clip();

  // Titlebar strip with title text and the collapse-state arrow.
  ctx.fillStyle = chrome.titleBar;
  ctx.fillRect(card.x, card.y, card.width, READOUT_CARD_TITLE_HEIGHT_PX);
  ctx.fillStyle = chrome.titleText;
  ctx.font = "600 8px system-ui, -apple-system, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(
    "MEASUREMENT CURSORS",
    card.x + READOUT_CARD_PAD_X_PX,
    card.y + READOUT_CARD_TITLE_HEIGHT_PX / 2,
  );
  ctx.fillStyle = chrome.arrowText;
  ctx.font = "8px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "right";
  const arrow = card.collapsed ? "▲" : "▼";
  ctx.fillText(
    arrow,
    card.x + card.width - READOUT_CARD_PAD_X_PX,
    card.y + READOUT_CARD_TITLE_HEIGHT_PX / 2,
  );

  // Body rows mirror the live DOM card content (shared row builder).
  if (!card.collapsed) {
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    let rowY =
      card.y +
      READOUT_CARD_TITLE_HEIGHT_PX +
      READOUT_CARD_ROW_HEIGHT_PX / 2 +
      2;
    for (const row of card.rows) {
      drawReadoutRow(ctx, row, card, chrome, rowY);
      rowY += READOUT_CARD_ROW_HEIGHT_PX;
    }
  }
  ctx.restore();
}

function drawReadoutRow(
  ctx: CanvasRenderingContext2D,
  row: ReadoutSnapshotRow,
  card: ReadoutCardSnapshot,
  chrome: ReadoutCardChrome,
  rowY: number,
): void {
  const baseX = card.x + READOUT_CARD_PAD_X_PX + (row.indent ? 10 : 0);
  let rightX = card.x + card.width - READOUT_CARD_PAD_X_PX;
  let x = baseX;
  const rightCells = row.cells.filter((cell) => cell.alignRight);
  const leftCells = row.cells.filter((cell) => !cell.alignRight);
  for (const cell of leftCells) {
    ctx.textAlign = "left";
    ctx.font = cell.bold
      ? "700 10px ui-monospace, SFMono-Regular, Menlo, monospace"
      : "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = cell.color ?? chrome.valueText;
    ctx.fillText(cell.text, x, rowY);
    x += ctx.measureText(cell.text).width + 8;
  }
  // Right-aligned cells stack from the right edge (values column).
  for (let i = rightCells.length - 1; i >= 0; i -= 1) {
    const cell = rightCells[i]!;
    ctx.textAlign = "right";
    ctx.fillStyle = cell.color ?? chrome.valueText;
    ctx.fillText(cell.text, rightX, rowY);
    rightX -= ctx.measureText(cell.text).width + 8;
  }
}

function legendTextColor(overlay: SnapshotOverlayState): string {
  // Axis-text-toned legend labels keep both themes legible; derive a
  // mid-tone that is visible on either background.
  return overlay.background === "#FFFFFF" ? "#555555" : "#888888";
}

/** Series descriptor for the offscreen print render (issue #39). */
export interface PrintSeriesSpec {
  label: string;
  color: string;
  show: boolean;
}

/** Per-palette chrome for the offscreen render (issue #252). */
const RENDER_CHROME = {
  light: {
    axisText: "#555555",
    grid: "#C8C8C8",
    ticks: "#C8C8C8",
    trigger: "#888888",
    triggerGlyphClear: "#FFFFFF",
    separator: LIGHT_THEME.laneSeparator,
  },
  dark: {
    axisText: "#888888",
    grid: "#222222",
    ticks: "#333333",
    trigger: "#555555",
    triggerGlyphClear: "#000000",
    separator: DARK_THEME.laneSeparator,
  },
} as const;

export type RenderPalette = keyof typeof RENDER_CHROME;

/** Frozen render context injected by the caller so `pngSnapshot.ts` reads zero Zustand stores. */
export interface PrintRenderContext {
  readonly catalog: ChannelCatalog;
  readonly stackMode: boolean;
  readonly laneWeights: LaneWeights;
  readonly displayConfigs: ChannelDisplayConfigs;
  readonly refLanes?: readonly Float32Array[];
  readonly t2?: {
    readonly timeSlipSamples: number;
    readonly accentColor: string;
  } | null;
}

export interface PrintComposeOptions extends SnapshotOptions {
  /** Per-channel strokes for the render (theme-resolved by the caller). */
  series: PrintSeriesSpec[];
  /**
   * Issue #252: render palette — "light" keeps the historical print
   * pass verbatim; "dark" renders the dark screen palette offscreen.
   */
  palette?: RenderPalette;
  /** Issue #252: omit the graticule grid (on-screen view untouched). */
  omitGrid?: boolean;
  /** Explicit frozen render context (falls back to a pure Overlay primary/series catalog). */
  renderContext?: PrintRenderContext;
}

/**
 * Issue #39/#355: composes a print-friendly (or dark/transparent/gridless)
 * offscreen snapshot WITHOUT touching the live viewport, using the same
 * `buildChartSpec` and `syncChartAdapters` module as `Oscilloscope.tsx`.
 */
export async function composePrintSnapshot(
  liveUplot: uPlot,
  capture: ParsedCapture,
  overlay: SnapshotOverlayState,
  options: PrintComposeOptions,
): Promise<ComposedSnapshot> {
  const uPlotCtor = (await import("uplot")).default;
  const printTimeAxis = createTimeAxisAdapter();

  const liveX = liveUplot.scales.x;
  if (liveX?.min == null || liveX?.max == null) {
    throw new Error("live viewport scales are not initialized");
  }

  const refLanes = options.renderContext?.refLanes ?? [];
  const trailingSeriesCount = Math.max(
    refLanes.length,
    Math.max(0, options.series.length - capture.channels.length),
  );
  const catalog =
    options.renderContext?.catalog ??
    buildChannelCatalog({
      primaryCapture: capture,
      referenceCapture: null,
      referenceLaneCount: trailingSeriesCount,
      activeChannels: capture.channels
        .filter((_, idx) => options.series[idx]?.show ?? true)
        .map((c) => c.name),
      selectedChannel: null,
      refActiveChannels: Array.from(
        { length: trailingSeriesCount },
        (_, refIdx) => ({
          id: `Ref-${String.fromCharCode(65 + refIdx)}`,
          show: options.series[capture.channels.length + refIdx]?.show ?? true,
        }),
      )
        .filter((e) => e.show)
        .map((e) => e.id),
    });

  const liveBoundsMap = new Map<string, { min: number; max: number }>();
  catalog.channels.forEach((ch) => {
    const scale = liveUplot.scales[ch.scaleKey];
    liveBoundsMap.set(ch.scaleKey, {
      min: scale?.min ?? -1,
      max: scale?.max ?? 1,
    });
  });

  printTimeAxis.sync({
    scales: { x: { min: liveX.min, max: liveX.max } },
    axes: [{ label: undefined }],
  });

  const liveSelectedAxis = (
    liveUplot.axes as
      | Array<{ scale?: string; grid?: { show?: boolean } } | undefined>
      | undefined
  )?.find(
    (a) =>
      typeof a?.scale === "string" && a.scale !== "x" && a.grid?.show === true,
  );
  const selectedScaleKey =
    liveSelectedAxis?.scale ??
    (capture.channels.length > 0 ? yScaleKey(0) : null);

  const palette = options.palette ?? "light";
  const chrome = RENDER_CHROME[palette];
  const staticRenderState: ChartRenderState = {
    capture,
    catalog,
    stackMode: options.renderContext?.stackMode ?? false,
    laneWeights: options.renderContext?.laneWeights ?? {},
    displayConfigs: options.renderContext?.displayConfigs ?? {},
    t2: options.renderContext?.t2 ?? null,
    chrome: {
      background: overlay.background,
      grid: chrome.grid,
      ticks: chrome.ticks,
      axisText: chrome.axisText,
      triggerAccent: chrome.trigger,
      triggerGlyphClear: chrome.triggerGlyphClear,
      separatorColor: chrome.separator,
      drawLaneHandles: false,
      fillBackground: !options.transparent,
      omitGrid: Boolean(options.omitGrid),
      groundFlagText: "#555555",
      channelColor: (ch) =>
        options.series[ch.channelIndex]?.color ?? chrome.axisText,
      channelStroke: (ch) =>
        options.series[ch.channelIndex]?.color ?? chrome.axisText,
    },
  };

  const printYAdapters = new Map<number, YAxisAdapter>();
  catalog.channels.forEach((ch) => {
    const liveAxis = (
      liveUplot.axes as
        | Array<
            | { scale?: string; label?: string | ((u: unknown) => string) }
            | undefined
          >
        | undefined
    )?.find((a) => a?.scale === ch.scaleKey);
    const liveLabel = liveAxis?.label;
    const initialUnit =
      typeof liveLabel === "string"
        ? liveLabel
        : typeof liveLabel === "function"
          ? (liveLabel as (u: unknown) => string)(liveUplot)
          : undefined;
    const adapter = createYAxisAdapter({
      quantity: ch.axisQuantity,
      unit: ch.baseUnit,
      scaleKey: ch.scaleKey,
      initialUnit,
    });
    printYAdapters.set(ch.channelIndex, adapter);
  });
  syncChartAdapters(liveUplot, staticRenderState, printYAdapters);

  const chartOpts = buildChartSpec({
    width: liveUplot.width,
    height: liveUplot.height,
    xBounds: { min: liveX.min, max: liveX.max },
    yBounds: liveBoundsMap,
    timeAxis: printTimeAxis,
    yAdapters: printYAdapters,
    getRenderState: () => staticRenderState,
    initAllAxesShown: false,
    selectedScaleKey,
    drawGroundFlagsInHook: true,
    drawT2InHook: true,
    cursor: { show: false },
  });

  // Honor explicit `options.series[i].show` / `label` overrides from direct callers.
  catalog.channels.forEach((ch) => {
    const spec = options.series[ch.channelIndex];
    if (!spec) return;
    const seriesEntry = chartOpts.series[ch.seriesIdx];
    if (seriesEntry) {
      seriesEntry.label = spec.label;
      seriesEntry.show = spec.show;
      seriesEntry.stroke = spec.color;
    }
    const axisEntry = chartOpts.axes?.find((a) => a.scale === ch.scaleKey);
    if (axisEntry) {
      axisEntry.show = spec.show;
    }
  });

  const host = document.createElement("div");
  let print: uPlot | null = null;
  try {
    print = new uPlotCtor(
      chartOpts,
      [
        capture.timestamps,
        // Issue #106/#224: reuse the live canvas's clipped/transformed display lanes.
        ...catalog.channels.map((ch) => {
          const liveLane = liveUplot.data[ch.seriesIdx];
          if (liveLane) return liveLane;
          if (ch.slot === "primary" && ch.channel) {
            const info = capture.metadata.channels[ch.slotIndex];
            const physical = info && !info.derived ? info : undefined;
            return buildDisplayData(
              ch.channel.data,
              ch.channel.rawCounts,
              physical?.windowMin,
              physical?.windowMax,
            );
          }
          return (
            refLanes[ch.slotIndex] ??
            new Float32Array(capture.timestamps.length)
          );
        }),
      ] as uPlot.AlignedData,
      host,
    );

    print.setScale("x", { min: liveX.min, max: liveX.max });
    for (const [scaleKey, bounds] of liveBoundsMap) {
      if (bounds.min != null && bounds.max != null) {
        print.setScale(scaleKey, {
          min: bounds.min,
          max: bounds.max,
        });
      }
    }
    // uPlot defers scale commits/draws to a scheduled task — let it flush,
    // then force a full layout + draw pass so unified Stack axes and multi-column
    // Overlay axes have settled bbox.left before composeSnapshotCanvas reads it.
    await new Promise((resolve) => setTimeout(resolve, 30));
    print.redraw(true, true);

    const selectedIdx = selectedScaleKey
      ? capture.channels.findIndex(
          (_, idx) => yScaleKey(idx) === selectedScaleKey,
        )
      : 0;
    const selectedAdapter =
      printYAdapters.get(selectedIdx) ?? printYAdapters.get(0);
    const composed = composeSnapshotCanvas(print, capture, overlay, options);
    return {
      ...composed,
      timeAxisUnit: printTimeAxis.unit.key,
      yAxisUnit: selectedAdapter?.unit.key,
    };
  } finally {
    print?.destroy();
    host.remove();
  }
}
