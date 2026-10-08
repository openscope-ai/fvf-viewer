/**
 * Oscilloscope component (issues #10, #12, #13, #119 / ADR 0011):
 * Canvas 2D uPlot wrapper with dark OLED theme, channel color palette, decoupled
 * viewport sync, zero-copy Float32Array consumption, scale-stable channel toggling,
 * one-click Fit Waveform (100%) reset, explicitly disabled mouse wheel zoom, and the
 * custom rectangular box-zoom plugin (8px click-safe threshold, Escape cancellation,
 * atomic two-axis zoom).
 *
 * Per-Channel Y-Axes & Selected Channel Grid (Issue #119 / ADR 0011):
 * - Every visible channel renders its own left-edge axis column in the shared graticule:
 *   own scale (per-channel yN, auto: false, explicit bounds), own SI ladder, own tick formatter,
 *   rotated title `<letter> (<unit>)` stroked in the channel color (custom name replaces letter).
 * - Columns follow channel file order (outermost = first visible) and compact leftward when
 *   channels hide (implemented by registering left axes in reverse channel file order in uPlot).
 * - Horizontal grid is owned by the Selected Channel (other axes are tick-only).
 * - Selection is presentational: never mutates scales or bounds.
 * - Selection surfaces: channel badge click cycle (hidden → visible → selected → hidden),
 *   trace click (nearest visible trace y within tolerance), and axis-column click.
 * - Degenerate state: when all channels are hidden, 0 axis columns render, no horizontal
 *   gridlines draw, gutter collapses to base padding, and viewport store mirrors null Y bounds.
 * - Sizing: shared measured sizing function (measureYAxisSize) for tight tick-to-title spacing.
 */

import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import type { AlignedData, Options } from "uplot";
import "uplot/dist/uPlot.min.css";
import { useResizeObserver } from "../../hooks/useResizeObserver";
import { useCaptureStore } from "../../state/captureStore";
import { useViewportStore } from "../../state/viewportStore";
import type { ChannelTag } from "../../state/viewportStore";
import type { ViewportTheme } from "./themePalette";
import type { ParsedCapture } from "../../types/capture";
import {
  DARK_THEME,
  effectiveCursorColor,
  effectiveCursorStroke,
  effectiveTraceColor,
  effectiveTraceStroke,
  resolveThemePalette,
} from "./themePalette";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import {
  refChannelName as toRefName,
  refLaneFitBounds,
  useReferenceStore,
} from "../../state/referenceStore";
import {
  displayKeyForChannel,
  effectiveInverted,
  effectiveOffset,
  effectiveYScale,
  transformBounds,
  transformDisplayLane,
} from "./channelDisplay";
import { boxZoomPlugin } from "./plugins/boxZoomPlugin";
import { timeSlipPlugin } from "./plugins/timeSlipPlugin";
import { groundMarkerPlugin } from "./plugins/groundMarkerPlugin";
import { stackLaneBounds } from "./channelLayout";
import { slippedRefDisplayLane } from "./timeSlip";
import { physicalDisplayLane } from "./displayLaneCache";
import { invalidateSeriesPaths } from "./seriesPathCache";
import {
  AXIS_FONT,
  AXIS_GAP_PX,
  AXIS_LABEL_GAP_PX,
  AXIS_LABEL_SIZE_PX,
  AXIS_SIZE_X_PX,
  AXIS_TICK_SIZE_PX,
  CANVAS_PADDING,
  measureYAxisSize,
} from "./axesConfig";
import { drawTriggerGlyph, drawTriggerLine } from "./triggerMarker";
import { createTimeAxisAdapter } from "./timeAxis";
import { createYAxisAdapter } from "./yAxis";
import { cursorPlugin } from "../cursors/cursorPlugin";
import { hoverTooltipPlugin } from "./hoverTooltipPlugin";
import { CursorReadoutCard } from "../cursors/CursorReadoutCard";
import {
  buildReadoutRows,
  type ReadoutCardSnapshot,
} from "../cursors/readoutSnapshot";
import { useReadoutCardStore } from "../../state/readoutCardStore";
import {
  channelDisplayName,
  useChannelNamesStore,
} from "../../state/channelNamesStore";
import {
  channelFitRange,
  getPhysicalChannelUnit,
  splitUnit,
  yScaleKey,
} from "../../capture/channelUnits";
import type { YAxisAdapter } from "./yAxis";
import { findNearestSampleIndex } from "../cursors/cursorPlugin";
import { BOX_ZOOM_MIN_DRAG_PX } from "./plugins/boxZoomPlugin";
import { CursorRecoveryBadges } from "../cursors/CursorRecoveryBadges";
import { useCursorStore } from "../../state/cursorStore";
import { useCursorDisplayStore } from "../../state/cursorDisplayStore";
import {
  composePrintSnapshot,
  composeSnapshotCanvas,
  snapshotToBlob,
} from "../export/pngSnapshot";
import { useSnapshotStore } from "../export/snapshotStore";

// Backwards-compatible re-exports (palette moved to channelPalette.ts in #12)
export { CHANNEL_PALETTE, getChannelColor } from "./channelPalette";

/**
 * Dark OLED theme constants (architecture.md §4.1 default).
 */
export { DARK_THEME as THEME_COLORS };

/**
 * Fraction of the visible-channel data span padded on each side of the Y
 * axis by the Fit Waveform (100%) action ("optimal dynamic margins").
 */
export const FIT_PADDING_RATIO = 0.05;

export interface ChannelFitBounds {
  min: number;
  max: number;
}

export interface CaptureFit {
  xMin: number;
  xMax: number;
  /** One entry per physical channel, index-aligned with `capture.channels`. */
  channels: ChannelFitBounds[];
}

/**
 * Computes the Fit Waveform (100%) bounds (issue #129): the full capture timestamp range
 * on X and, per channel, zero-aligned symmetric bounds ([-bound, +bound]) with dynamic
 * margins (FIT_PADDING_RATIO) so all channel Y axes have their zero aligned at the vertical
 * center (50% height). Saturated (NaN) samples never stretch a fit; an all-NaN or all-zero
 * channel falls back to [-1, 1] so the fit action always restores a sane full view.
 */
export function computeCaptureFit(capture: ParsedCapture): CaptureFit {
  const { timestamps, channels } = capture;

  let xMin: number = timestamps.length > 0 ? timestamps[0]! : 0;
  let xMax: number =
    timestamps.length > 0 ? timestamps[timestamps.length - 1]! : 1;
  if (!(xMax - xMin > 0)) {
    const deltaT = capture.metadata.deltaT > 0 ? capture.metadata.deltaT : 1;
    xMin -= deltaT;
    xMax += deltaT;
  }

  return {
    xMin,
    xMax,
    channels: channels.map((channel) => {
      const range = channelFitRange(channel.data);
      if (!range) {
        return { min: -1, max: 1 };
      }
      const maxAbs = Math.max(Math.abs(range.min), Math.abs(range.max));
      const bound = maxAbs > 0 ? maxAbs * (1 + FIT_PADDING_RATIO) : 1;
      return { min: -bound, max: bound };
    }),
  };
}

/**
 * Resolves the active/selected channel index for fit bounds / tests.
 */
export function resolveActiveIndex(
  capture: ParsedCapture,
  activeChannels: readonly ChannelTag[],
  selectedChannel?: ChannelTag | null,
): number {
  if (selectedChannel) {
    const idx = capture.channels.findIndex(
      (c) => c.name === selectedChannel && activeChannels.includes(c.name),
    );
    if (idx >= 0) return idx;
  }
  const firstVisible = capture.channels.findIndex((c) =>
    activeChannels.includes(c.name),
  );
  return firstVisible >= 0 ? firstVisible : 0;
}

/**
 * Applies per-channel fit bounds to the uPlot instance and syncs the store.
 * Issue #224: the physical fit bounds pass through the channel's display
 * transform first, so Fit Waveform frames the *displayed* trace (a scaled,
 * offset, or inverted channel fits exactly like an untouched one).
 */
export function applyFitBounds(
  instance: uPlot,
  capture: ParsedCapture,
  activeChannels: readonly ChannelTag[],
): void {
  const fit = computeCaptureFit(capture);
  const displayConfigs = useChannelDisplayStore.getState().keyConfigs;
  instance.setScale("x", { min: fit.xMin, max: fit.xMax });
  fit.channels.forEach((bounds, index) => {
    const key = displayKeyForChannel(capture.channels[index]!.name);
    const display = transformBounds(
      bounds,
      effectiveYScale(displayConfigs, key),
      effectiveOffset(displayConfigs, key),
      effectiveInverted(displayConfigs, key),
    );
    instance.setScale(yScaleKey(index), {
      min: display.min,
      max: display.max,
    });
  });

  const selectedChannel = useViewportStore.getState().selectedChannel;
  const selectedIndex = selectedChannel
    ? capture.channels.findIndex(
        (c) => c.name === selectedChannel && activeChannels.includes(c.name),
      )
    : -1;
  const selectedFit = selectedIndex >= 0 ? fit.channels[selectedIndex] : null;

  useViewportStore.getState().setBounds({
    xMin: fit.xMin,
    xMax: fit.xMax,
    yMin: selectedFit?.min ?? null,
    yMax: selectedFit?.max ?? null,
  });
}

/** True when two (scale, offset, invert) display triples are equal. */
function tripleEquals(
  a: [number, number, boolean],
  b: [number, number, boolean],
): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** Shallow-compares two per-key config records for restyle decisions. */
function configsEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const av = a[key] as Record<string, unknown> | undefined;
    const bv = b[key] as Record<string, unknown> | undefined;
    if (av?.color !== bv?.color || av?.opacity !== bv?.opacity) return false;
  }
  return true;
}

/** Snap radius (plot px) for trace click selection. */
export const FOCUS_CLICK_SNAP_PX = 48;
/** Sample window around the resolved index probed for the nearest trace. */
const NEAREST_SAMPLE_WINDOW = 8;

interface PlotPoint {
  x: number;
  y: number;
}

/**
 * Nearest visible trace to a plot-area point, measured vertically against
 * the rendered display lanes.
 */
function nearestVisibleSeries(
  u: uPlot,
  capture: ParsedCapture,
  point: PlotPoint,
  activeChannels: readonly ChannelTag[],
): { name: string; label: string; distance: number } | null {
  const totalSamples = capture.timestamps.length;
  if (totalSamples === 0) return null;
  const time = u.posToVal(point.x, "x");
  const sample = findNearestSampleIndex(capture.timestamps, time);
  let best: { name: string; label: string; distance: number } | null = null;
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
      const distance = Math.abs(u.valToPos(value, key) - point.y);
      if (best === null || distance < best.distance) {
        best = { name: channel.name, label: channel.label, distance };
      }
    }
  });
  return best;
}

/**
 * Applies effective trace strokes to the live uPlot instance in place.
 * Issue #204: strokes render as rgba() at the per-key opacity (hex stays
 * canonical at full opacity).
 */
function applyTraceStrokes(
  instance: uPlot,
  capture: ParsedCapture,
  theme: ViewportTheme,
): void {
  const { customColors, keyConfigs } = usePaletteStore.getState();
  const names = capture.channels.map((channel) => channel.name);
  // Issue #96: reference series trail the primary channels.
  const reference = useReferenceStore.getState();
  if (reference.capture) {
    names.push(...reference.capture.channels.map((c) => toRefName(c.name)));
  }
  names.forEach((name, index) => {
    const series = instance.series[index + 1];
    if (series) {
      series.stroke = () =>
        effectiveTraceStroke(theme, customColors, keyConfigs, name);
    }
  });
  instance.redraw();
}

export interface OscilloscopeProps {
  capture?: ParsedCapture | null;
  onUPlotInit?: (uplot: uPlot) => void;
  className?: string;
}

export default function Oscilloscope({
  capture: explicitCapture,
  onUPlotInit,
  className,
}: OscilloscopeProps) {
  const storeCapture = useCaptureStore((state) => state.capture);
  const capture =
    explicitCapture !== undefined ? explicitCapture : storeCapture;

  const activeChannels = useViewportStore((state) => state.activeChannels);
  const selectedChannel = useViewportStore((state) => state.selectedChannel);
  // Issue #96: the File 2 comparison slot — lanes are resampled onto
  // File 1's time grid, so the x axis is shared by construction.
  const refCapture = useReferenceStore((state) => state.capture);
  const refLanes = useReferenceStore((state) => state.lanes);
  const refActiveChannels = useReferenceStore(
    (state) => state.refActiveChannels,
  );
  const fitRequest = useViewportStore((state) => state.fitRequest);
  const theme = useThemeStore((state) => state.theme);
  const keyConfigs = usePaletteStore((state) => state.keyConfigs);

  const {
    ref: containerRef,
    width,
    height,
  } = useResizeObserver<HTMLDivElement>();
  const uplotRef = useRef<uPlot | null>(null);
  const styledThemeRef = useRef<string | null>(null);
  const styledConfigsRef = useRef<Record<string, unknown> | null>(null);
  const lastFitRequestRef = useRef(fitRequest);
  const captureRef = useRef(capture);
  captureRef.current = capture;

  // Per-channel Y-axis adapters: hysteresis state lives here per channel index.
  const adaptersRef = useRef(new Map<number, YAxisAdapter>());

  // Ingesting a new capture file initializes cursors and selection defaults.
  useEffect(() => {
    if (capture) {
      // Issue #224: capture ingestion/replacement clears solo state
      // (restoring the pre-solo visibility set).
      useChannelDisplayStore.getState().clearSolo();
      useCursorStore.getState().initForCapture(capture.timestamps.length);
      const curSelected = useViewportStore.getState().selectedChannel;
      const isValid =
        curSelected != null &&
        capture.channels.some((c) => c.name === curSelected);
      if (!isValid && capture.channels.length > 0) {
        useViewportStore
          .getState()
          .setSelectedChannel(capture.channels[0]!.name);
      }
    }
  }, [capture]);

  const alignedData = useMemo<AlignedData | null>(() => {
    if (!capture || capture.channels.length === 0) {
      return null;
    }
    const displayConfigs = useChannelDisplayStore.getState().keyConfigs;
    // Issue #96: reference lanes trail the primary channels (Wasm-
    // resampled onto File 1's grid, then #224-transformed like any
    // primary lane).
    const reference = useReferenceStore.getState();
    const refNames = reference.capture
      ? reference.capture.channels.map((c) => toRefName(c.name))
      : [];
    return [
      capture.timestamps,
      ...capture.channels.map((_channel, index) => {
        const key = displayKeyForChannel(capture.channels[index]!.name);
        // Issue #224: the rail-clipped physical lane passes through the
        // per-channel display transform (Y-scale %, offset, invert ±) —
        // readouts keep reading the untouched capture buffers. Issue
        // #238: the O(N) rail-clip pass is cached per capture; the
        // transform stays a cheap affine pass.
        return transformDisplayLane(
          physicalDisplayLane(capture, index),
          effectiveYScale(displayConfigs, key),
          effectiveOffset(displayConfigs, key),
          effectiveInverted(displayConfigs, key),
        );
      }),
      ...(reference.lanes ?? []).map((lane, index) => {
        const refKey = displayKeyForChannel(refNames[index] ?? "");
        // Issue #97: the time slip fuses into the same single pass; the
        // plugin owns live slip updates (in-place rewrite, no remount).
        return slippedRefDisplayLane(
          lane,
          reference.timeSlipSamples,
          effectiveYScale(displayConfigs, refKey),
          effectiveOffset(displayConfigs, refKey),
          effectiveInverted(displayConfigs, refKey),
        );
      }),
    ] as AlignedData;
  }, [capture, refLanes]);

  // Mount/re-create uPlot instance only when capture structure/buffers change
  useEffect(() => {
    const container = containerRef.current;
    if (
      !container ||
      !capture ||
      !alignedData ||
      capture.channels.length === 0
    ) {
      return;
    }
    // Issue #98: a new plot invalidates any saved pre-stack windows.
    preStackRef.current.clear();

    const initialW =
      width > 0 ? width : Math.max(container.clientWidth || 800, 100);
    const initialH =
      height > 0 ? height : Math.max(container.clientHeight || 400, 100);

    const mountChannels = useViewportStore.getState().activeChannels;
    const mountSelected =
      useViewportStore.getState().selectedChannel ??
      mountChannels[0] ??
      capture.channels[0]?.name ??
      null;
    const initialFit = computeCaptureFit(capture);

    // Zoom-adaptive SI time units for the X axis
    const timeAxis = createTimeAxisAdapter();
    timeAxis.sync({
      scales: { x: { min: initialFit.xMin, max: initialFit.xMax } },
      axes: [{ label: undefined }],
    });

    // Create per-channel Y-axis adapters
    adaptersRef.current = new Map();
    const customNames = useChannelNamesStore.getState().names;
    capture.channels.forEach((channel, origIdx) => {
      const custom = customNames[channel.name];
      const heading = custom || channel.name;
      const { base } = splitUnit(getPhysicalChannelUnit(capture, origIdx));
      const adapter = createYAxisAdapter({
        quantity: heading,
        unit: base,
        scaleKey: yScaleKey(origIdx),
      });
      const fit = initialFit.channels[origIdx] ?? { min: -1, max: 1 };
      adapter.sync({
        scales: { [yScaleKey(origIdx)]: { min: fit.min, max: fit.max } },
        axes: [],
      });
      adaptersRef.current.set(origIdx, adapter);
    });

    // Left axes registered in REVERSE channel file order:
    // outermost = first visible channel, innermost = last visible channel
    const reversedChannels = capture.channels
      .map((channel, origIdx) => ({ channel, origIdx }))
      .reverse();

    const opts: Options = {
      width: initialW,
      height: initialH,
      padding: CANVAS_PADDING,
      cursor: {
        drag: {
          setScale: false,
          x: false,
          y: false,
        },
        sync: {
          key: "scope",
        },
      },
      plugins: [
        boxZoomPlugin(),
        // Issue #98: ground markers + ctrl+vertical-drag offset —
        // registered BEFORE the cursor plugin so a ctrl+press on a
        // trace can claim the vertical gesture (and forward unclaimed
        // ctrl+clicks to the #14 cursor relocation).
        groundMarkerPlugin({ getCapture: () => captureRef.current }),
        cursorPlugin({ getCapture: () => captureRef.current }),
        // Issue #150: dwell tooltip on the hovered snap point (x/y sample readout)
        hoverTooltipPlugin({
          getCapture: () => captureRef.current,
          getActiveChannels: () => useViewportStore.getState().activeChannels,
          getCustomNames: () => useChannelNamesStore.getState().names,
        }),
        // Issue #97: T2 trigger glyph + tactile time slip for File 2.
        timeSlipPlugin({ getCapture: () => captureRef.current }),
      ],
      scales: {
        x: {
          time: false,
          auto: false,
          min: initialFit.xMin,
          max: initialFit.xMax,
        },
        ...Object.fromEntries(
          capture.channels.map((_channel, index) => {
            const fit = initialFit.channels[index] ?? { min: -1, max: 1 };
            return [
              yScaleKey(index),
              { auto: false, min: fit.min, max: fit.max },
            ];
          }),
        ),
        // Issue #96: reference channels render as trailing series with
        // their own pinned scales (zero-centered symmetric fit of the
        // resampled lane) and NO left axis column — the shared overlay
        // graticule belongs to the primary channels.
        ...Object.fromEntries(
          (useReferenceStore.getState().lanes ?? []).map((lane, index) => {
            const bounds = refLaneFitBounds(lane);
            return [
              yScaleKey(capture.channels.length + index),
              { auto: false, min: bounds.min, max: bounds.max },
            ];
          }),
        ),
      },
      axes: [
        {
          scale: "x",
          stroke: () =>
            resolveThemePalette(useThemeStore.getState().theme).axisText,
          grid: {
            show: true,
            stroke: () =>
              resolveThemePalette(useThemeStore.getState().theme).grid,
            width: 1,
          },
          ticks: {
            show: true,
            stroke: () =>
              resolveThemePalette(useThemeStore.getState().theme).ticks,
            width: 1,
            size: AXIS_TICK_SIZE_PX,
          },
          font: AXIS_FONT,
          label: timeAxis.label,
          labelFont: AXIS_FONT,
          size: AXIS_SIZE_X_PX,
          gap: AXIS_GAP_PX,
          labelGap: AXIS_LABEL_GAP_PX,
          values: timeAxis.values,
        },
        ...reversedChannels.map(({ channel, origIdx }) => {
          const scaleKey = yScaleKey(origIdx);
          const adapter = adaptersRef.current.get(origIdx)!;
          return {
            scale: scaleKey,
            side: 3,
            show: mountChannels.includes(channel.name),
            stroke: () =>
              effectiveTraceColor(
                useThemeStore.getState().theme,
                usePaletteStore.getState().customColors,
                channel.name,
              ),
            grid: {
              show: channel.name === mountSelected,
              stroke: () =>
                resolveThemePalette(useThemeStore.getState().theme).grid,
              width: 1,
            },
            ticks: {
              show: true,
              stroke: () =>
                resolveThemePalette(useThemeStore.getState().theme).ticks,
              width: 1,
              size: AXIS_TICK_SIZE_PX,
            },
            font: AXIS_FONT,
            label: adapter.label,
            labelFont: AXIS_FONT,
            labelSize: AXIS_LABEL_SIZE_PX,
            gap: AXIS_GAP_PX,
            labelGap: AXIS_LABEL_GAP_PX,
            size: (_self: uPlot, values: string[]) => measureYAxisSize(values),
            values: (_self: unknown, splits: number[]) =>
              adaptersRef.current.get(origIdx)?.values(_self, splits) ??
              splits.map(String),
          };
        }),
      ],
      series: [
        {
          label: "Time",
        },
        ...capture.channels.map((channel, index) => ({
          label: channelDisplayName(
            channel.name,
            channel.label,
            useChannelNamesStore.getState().names[channel.name],
          ),
          scale: yScaleKey(index),
          stroke: effectiveTraceStroke(
            useThemeStore.getState().theme,
            usePaletteStore.getState().customColors,
            usePaletteStore.getState().keyConfigs,
            channel.name,
          ),
          width: 1.5,
          points: { show: false },
          show: mountChannels.includes(channel.name),
        })),
        ...(() => {
          // Issue #96: trailing reference series (Ref-A…): secondary
          // palette strokes, own scales, independent visibility, full
          // #204/#224 per-key appearance participation. Selection stays
          // a primary-channel concern (trace-click snap skips them).
          const reference = useReferenceStore.getState();
          const lanes = reference.lanes ?? [];
          const active = reference.refActiveChannels;
          const customNames = useChannelNamesStore.getState().names;
          return lanes.map((lane, index) => {
            const raw = reference.capture?.channels[index];
            const name = raw ? toRefName(raw.name) : `Ref-${index}`;
            return {
              label: channelDisplayName(name, undefined, customNames[name]),
              scale: yScaleKey(capture.channels.length + index),
              stroke: effectiveTraceStroke(
                useThemeStore.getState().theme,
                usePaletteStore.getState().customColors,
                usePaletteStore.getState().keyConfigs,
                name,
              ),
              width: 1.5,
              points: { show: false },
              show: active.includes(name),
            };
          });
        })(),
      ],
      hooks: {
        drawClear: [
          (u) => {
            u.ctx.save();
            const palette = resolveThemePalette(useThemeStore.getState().theme);
            u.ctx.fillStyle = palette.background;
            u.ctx.fillRect(0, 0, u.bbox.width, u.bbox.height);
            u.ctx.restore();
          },
        ],
        drawAxes: [
          (u) => {
            const liveTheme = useThemeStore.getState().theme;
            drawTriggerLine(u, resolveThemePalette(liveTheme).triggerAccent);
          },
        ],
        draw: [
          (u) => {
            const palette = resolveThemePalette(useThemeStore.getState().theme);
            drawTriggerGlyph(u, palette.triggerAccent, palette.background);
          },
        ],
        setScale: [
          (u) => {
            timeAxis.sync(u);
            for (const adapter of adaptersRef.current.values()) {
              adapter.sync(u);
            }
            const curSelected = useViewportStore.getState().selectedChannel;
            const selectedIdx = curSelected
              ? capture.channels.findIndex((c) => c.name === curSelected)
              : -1;
            const selectedKey =
              selectedIdx >= 0 ? yScaleKey(selectedIdx) : null;
            const yMin =
              selectedKey != null ? (u.scales[selectedKey]?.min ?? null) : null;
            const yMax =
              selectedKey != null ? (u.scales[selectedKey]?.max ?? null) : null;
            const xMin = u.scales.x?.min ?? null;
            const xMax = u.scales.x?.max ?? null;
            useViewportStore.getState().setBounds({ xMin, xMax, yMin, yMax });
          },
        ],
        setSelect: [
          (u) => {
            const curSelected = useViewportStore.getState().selectedChannel;
            const selectedIdx = curSelected
              ? capture.channels.findIndex((c) => c.name === curSelected)
              : -1;
            const selectedKey =
              selectedIdx >= 0 ? yScaleKey(selectedIdx) : null;
            const yMin =
              selectedKey != null ? (u.scales[selectedKey]?.min ?? null) : null;
            const yMax =
              selectedKey != null ? (u.scales[selectedKey]?.max ?? null) : null;
            const xMin = u.scales.x?.min ?? null;
            const xMax = u.scales.x?.max ?? null;
            useViewportStore.getState().setBounds({ xMin, xMax, yMin, yMax });
          },
        ],
      },
    };

    const instance = new uPlot(opts, alignedData, container);
    uplotRef.current = instance;
    styledThemeRef.current = useThemeStore.getState().theme;
    styledConfigsRef.current = {
      ...usePaletteStore.getState().keyConfigs,
    };
    (container as HTMLElement & { __uplot?: uPlot }).__uplot = instance;
    onUPlotInit?.(instance);

    // Trace clicks on the plot overlay
    const over = instance.over;
    const toPlotPoint = (event: MouseEvent): PlotPoint => {
      const rect = over.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    let downPoint: PlotPoint | null = null;
    const onPointerDown = (event: MouseEvent): void => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
      downPoint = toPlotPoint(event);
    };
    const onPointerUp = (event: MouseEvent): void => {
      const start = downPoint;
      downPoint = null;
      if (!start || event.button !== 0) return;
      const end = toPlotPoint(event);
      if (
        Math.hypot(end.x - start.x, end.y - start.y) >= BOX_ZOOM_MIN_DRAG_PX
      ) {
        return;
      }
      const live = captureRef.current;
      if (!live) return;
      const nearest = nearestVisibleSeries(
        instance,
        live,
        end,
        useViewportStore.getState().activeChannels,
      );
      if (nearest && nearest.distance <= FOCUS_CLICK_SNAP_PX) {
        useViewportStore.getState().setSelectedChannel(nearest.name);
      }
    };
    over.addEventListener("mousedown", onPointerDown);
    over.addEventListener("mouseup", onPointerUp);

    // Axis column clicks inside container (x < plotLeft)
    const onContainerClick = (event: MouseEvent): void => {
      if (event.button !== 0) return;
      const live = captureRef.current;
      if (!live) return;
      const rect = container.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const instancePxRatio =
        instance.width > 0 ? instance.ctx.canvas.width / instance.width : 1;
      const plotLeft = instance.bbox.left / instancePxRatio;

      if (clickX < plotLeft && clickX >= CANVAS_PADDING[3]) {
        const active = useViewportStore.getState().activeChannels;
        const visible = live.channels.filter((c) => active.includes(c.name));
        let colLeft = CANVAS_PADDING[3];
        for (const ch of visible) {
          const origIdx = live.channels.indexOf(ch);
          const axis = instance.axes.find(
            (a) => a.scale === yScaleKey(origIdx),
          );
          const colWidth = axis
            ? ((axis as unknown as { _size?: number })._size ?? 0) +
              (axis.label != null ? (axis.labelSize ?? 0) : 0)
            : 0;
          if (clickX >= colLeft && clickX < colLeft + colWidth) {
            useViewportStore.getState().setSelectedChannel(ch.name);
            break;
          }
          colLeft += colWidth;
        }
      }
    };
    container.addEventListener("click", onContainerClick);

    // Register PNG snapshot exporter
    useSnapshotStore.getState().registerExporter(async (inverted) => {
      const live = uplotRef.current ?? instance;
      const liveCapture = captureRef.current;
      if (!liveCapture) {
        throw new Error("no capture loaded for PNG snapshot");
      }
      const themeNow = useThemeStore.getState().theme;
      const colorsNow = usePaletteStore.getState().customColors;
      const configsNow = usePaletteStore.getState().keyConfigs;
      const cursorState = useCursorStore.getState();
      const viewportState = useViewportStore.getState();
      const renderTheme = inverted ? "light" : themeNow;
      const customNames = useChannelNamesStore.getState().names;
      // Issue #226: the embedded readout card mirrors the live card's
      // display-unit selections.
      const legend = liveCapture.channels
        .filter((channel) =>
          viewportState.activeChannels.includes(channel.name),
        )
        .map((channel) => ({
          label: channelDisplayName(
            channel.name,
            channel.label,
            customNames[channel.name],
          ),
          color: effectiveTraceColor(renderTheme, colorsNow, channel.name),
        }));
      const displayNow = useCursorDisplayStore.getState();
      const overlay = {
        cursor1: effectiveCursorStroke(
          renderTheme,
          colorsNow,
          configsNow,
          "C1",
        ),
        cursor2: effectiveCursorStroke(
          renderTheme,
          colorsNow,
          configsNow,
          "C2",
        ),
        lineStyles: displayNow.lineStyles,
        background: resolveThemePalette(renderTheme).background,
        legend,
        selected: cursorState.selectedCursor,
        selectedRingColor: inverted ? "#333333" : "#ffffff",
      };
      const cursorSnapshot = {
        cursor: {
          c1Active: cursorState.c1Active,
          c1SampleIndex: cursorState.c1SampleIndex,
          c2Active: cursorState.c2Active,
          c2SampleIndex: cursorState.c2SampleIndex,
        },
      };

      let readoutCard: ReadoutCardSnapshot | null = null;
      const cardEl = container.parentElement?.querySelector(
        "[data-testid='cursor-readout-card']",
      );
      if (cardEl instanceof HTMLElement) {
        const cardRect = cardEl.getBoundingClientRect();
        const canvasRect = container.getBoundingClientRect();
        const effectiveXMin =
          viewportState.xMin ?? liveCapture.timestamps[0] ?? 0;
        const effectiveXMax =
          viewportState.xMax ??
          liveCapture.timestamps[liveCapture.timestamps.length - 1] ??
          1;
        readoutCard = {
          x: cardRect.left - canvasRect.left,
          y: cardRect.top - canvasRect.top,
          width: cardRect.width,
          height: cardRect.height,
          collapsed: useReadoutCardStore.getState().collapsed,
          rows: buildReadoutRows(
            liveCapture,
            cursorState,
            viewportState.activeChannels,
            effectiveXMin,
            effectiveXMax,
            {
              c1: effectiveCursorColor(renderTheme, colorsNow, "C1"),
              c2: effectiveCursorColor(renderTheme, colorsNow, "C2"),
              channel: (name: string) =>
                effectiveTraceColor(renderTheme, colorsNow, name),
            },
            customNames,
            {
              time: displayNow.timeUnit,
              frequency: displayNow.frequencyUnit,
              voltage: displayNow.voltageUnit,
            },
            {
              c1Binding: displayNow.bindings.C1,
              c2Binding: displayNow.bindings.C2,
              deltaLocked: displayNow.deltaLocked,
            },
          ),
        };
      }

      if (inverted) {
        const printSeries = liveCapture.channels.map((channel, index) => ({
          label: channelDisplayName(
            channel.name,
            channel.label,
            customNames[channel.name],
          ),
          color: effectiveTraceColor("light", colorsNow, channel.name),
          show: live.series[index + 1]?.show ?? false,
        }));
        const printComposite = await composePrintSnapshot(
          live,
          liveCapture,
          overlay,
          { ...cursorSnapshot, readoutCard, series: printSeries },
        );
        return snapshotToBlob(printComposite.canvas);
      }

      const composite = composeSnapshotCanvas(live, liveCapture, overlay, {
        ...cursorSnapshot,
        readoutCard,
      });
      return snapshotToBlob(composite.canvas);
    });

    applyFitBounds(
      instance,
      capture,
      useViewportStore.getState().activeChannels,
    );

    const suppressWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    container.addEventListener("wheel", suppressWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", suppressWheel);
      container.removeEventListener("click", onContainerClick);
      over.removeEventListener("mousedown", onPointerDown);
      over.removeEventListener("mouseup", onPointerUp);
      useSnapshotStore.getState().registerExporter(null);
      instance.destroy();
      uplotRef.current = null;
      delete (container as HTMLElement & { __uplot?: uPlot }).__uplot;
    };
  }, [capture, alignedData, onUPlotInit]);

  // Decoupled responsive resize
  useEffect(() => {
    const instance = uplotRef.current;
    if (!instance) return;
    if (width > 0 && height > 0) {
      instance.setSize({ width, height });
    }
  }, [width, height]);

  // Channel visibility toggling via setSeries with Y-scale pinning
  useEffect(() => {
    const instance = uplotRef.current;
    if (!instance || !capture) return;

    const pinned = capture.channels.map((_, index) => {
      const scale = instance.scales[yScaleKey(index)];
      return {
        key: yScaleKey(index),
        min: scale?.min ?? null,
        max: scale?.max ?? null,
      };
    });

    capture.channels.forEach((channel, origIdx) => {
      const seriesIdx = origIdx + 1;
      const shouldShow = activeChannels.includes(channel.name);
      if (
        instance.series[seriesIdx] &&
        instance.series[seriesIdx].show !== shouldShow
      ) {
        instance.setSeries(seriesIdx, { show: shouldShow });
      }
      const scaleKey = yScaleKey(origIdx);
      const axis = instance.axes.find((a) => a.scale === scaleKey);
      if (axis) {
        axis.show = shouldShow;
        if (axis.grid) {
          axis.grid.show = shouldShow && channel.name === selectedChannel;
        }
      }
    });

    // Issue #96: reference visibility is independent (refActiveChannels);
    // toggling a Ref badge must not rescale its lane.
    if (refCapture) {
      refCapture.channels.forEach((channel, refIdx) => {
        const seriesIdx = capture.channels.length + refIdx + 1;
        const name = toRefName(channel.name);
        const shouldShow = refActiveChannels.includes(name);
        if (
          instance.series[seriesIdx] &&
          instance.series[seriesIdx].show !== shouldShow
        ) {
          instance.setSeries(seriesIdx, { show: shouldShow });
        }
        const scaleKey = yScaleKey(capture.channels.length + refIdx);
        const scale = instance.scales[scaleKey];
        if (scale?.min != null && scale.max != null) {
          pinned.push({
            key: scaleKey,
            min: scale.min,
            max: scale.max,
          });
        }
      });
    }

    for (const pin of pinned) {
      if (pin.min != null && pin.max != null) {
        instance.setScale(pin.key, { min: pin.min, max: pin.max });
      }
    }

    instance.redraw(false, true);
  }, [activeChannels, selectedChannel, capture, refCapture, refActiveChannels]);

  // Issue #224: per-channel display transforms (Y-scale %, offset, invert)
  // update the rendered lanes in place — scrubbing never re-creates the
  // uPlot instance. Scale bounds are pinned around the lane swap so the
  // transform never fights the user's zoom.
  //
  // Issue #238: the lane source is the cached rail-clipped physical lane
  // (no O(N) re-derivation per commit), lanes whose transform triple is
  // unchanged are skipped, transformed output reuses per-series scratch
  // buffers, and the repaint is the full synchronous redraw — the exact
  // paint path a palette/opacity edit uses — so a committed value shows
  // up on the canvas immediately instead of riding uPlot's deferred
  // commit() microtask.
  const displayConfigs = useChannelDisplayStore((s) => s.keyConfigs);
  const laneScratchRef = useRef(new Map<number, Float32Array>());
  const lastTransformRef = useRef<{
    instance: uPlot | null;
    capture: ParsedCapture | null;
    params: Map<string, [number, number, boolean]>;
    slip: number;
  }>({ instance: null, capture: null, params: new Map(), slip: 0 });
  useEffect(() => {
    const instance = uplotRef.current;
    if (!instance || !capture) return;

    const referenceNow = useReferenceStore.getState();
    const scratch = laneScratchRef.current;
    const last = lastTransformRef.current;
    const fresh = last.instance !== instance || last.capture !== capture;
    if (fresh) {
      scratch.clear();
      last.instance = instance;
      last.capture = capture;
      last.params = new Map();
      last.slip = referenceNow.timeSlipSamples;
    }

    /** True when the (scale, offset, invert) triple changed for a key. */
    const changed = (key: string, triple: [number, number, boolean]) => {
      const prev = last.params.get(key);
      last.params.set(key, triple);
      return fresh || prev === undefined || !tripleEquals(prev, triple);
    };

    // Deferred lane swaps + the rewritten lanes' bound re-pins execute
    // together inside ONE uPlot immediate-mode batch — the repaint is
    // synchronous with the commit, never a deferred microtask paint.
    const swaps: (() => void)[] = [];
    const pins: (() => void)[] = [];

    capture.channels.forEach((channel, index) => {
      const key = displayKeyForChannel(channel.name);
      const triple: [number, number, boolean] = [
        effectiveYScale(displayConfigs, key),
        effectiveOffset(displayConfigs, key),
        effectiveInverted(displayConfigs, key),
      ];
      if (!changed(key ?? `ch${index}`, triple)) return;
      let buffer = scratch.get(index);
      if (!buffer || buffer.length !== capture.timestamps.length) {
        buffer = new Float32Array(capture.timestamps.length);
        scratch.set(index, buffer);
      }
      const lane = physicalDisplayLane(capture, index);
      swaps.push(() => {
        // Issue #245: the lane swap is invisible to uPlot's per-series
        // path cache — clear it so the repaint rebuilds this series'
        // geometry instead of stroking the stale pre-transform Path2D.
        invalidateSeriesPaths(instance, index + 1);
        instance.data[index + 1] = transformDisplayLane(
          lane,
          triple[0],
          triple[1],
          triple[2],
          buffer,
        );
      });
      const scale = instance.scales[yScaleKey(index)];
      const min = scale?.min ?? null;
      const max = scale?.max ?? null;
      if (min != null && max != null) {
        pins.push(() => {
          instance.setScale(yScaleKey(index), { min, max });
        });
      }
    });

    // Issue #96: reference lanes re-transform in place exactly like the
    // primary lanes (they are already resampled onto File 1's grid).
    const refNames = referenceNow.capture
      ? referenceNow.capture.channels.map((c) => toRefName(c.name))
      : [];
    const refLanes = referenceNow.lanes ?? [];
    const slipChanged = last.slip !== referenceNow.timeSlipSamples;
    last.slip = referenceNow.timeSlipSamples;
    refLanes.forEach((lane, refIdx) => {
      const refKey = displayKeyForChannel(refNames[refIdx] ?? "");
      const triple: [number, number, boolean] = [
        effectiveYScale(displayConfigs, refKey),
        effectiveOffset(displayConfigs, refKey),
        effectiveInverted(displayConfigs, refKey),
      ];
      // Issue #97: reads the live slip so a display-config change never
      // reverts an applied time slip (slip-only updates stay owned by
      // the time-slip plugin; a slip change rewrites every ref lane).
      if (!slipChanged && !changed(refKey ?? `ref${refIdx}`, triple)) {
        return;
      }
      const seriesIdx = capture.channels.length + refIdx;
      let buffer = scratch.get(seriesIdx);
      if (!buffer || buffer.length !== lane.length) {
        buffer = new Float32Array(lane.length);
        scratch.set(seriesIdx, buffer);
      }
      const slip = referenceNow.timeSlipSamples;
      swaps.push(() => {
        // Issue #245: same scoped path-cache invalidation for the
        // rewritten reference lanes.
        invalidateSeriesPaths(instance, seriesIdx + 1);
        instance.data[seriesIdx + 1] = slippedRefDisplayLane(
          lane,
          slip,
          triple[0],
          triple[1],
          triple[2],
          buffer,
        );
      });
    });

    if (swaps.length === 0) return;

    // Immediate-mode batch = synchronous repaint. Guarded: before the
    // constructor's first real paint (zero-size mount) uPlot's axes
    // carry no computed increments, and a forced immediate _commit
    // would throw in drawAxesGrid — fall back to the deferred commit.
    const axesReady = instance.axes.every(
      (axis) => (axis as unknown as { _found?: unknown })._found != null,
    );
    if (axesReady) {
      instance.batch(() => {
        swaps.forEach((swap) => swap());
        pins.forEach((pin) => pin());
      });
    } else {
      swaps.forEach((swap) => swap());
      pins.forEach((pin) => pin());
      instance.redraw(false, true);
    }
  }, [displayConfigs, capture]);

  // Selected channel changes: move horizontal gridlines and mirror bounds
  useEffect(() => {
    const instance = uplotRef.current;
    if (!instance || !capture) return;

    capture.channels.forEach((channel, origIdx) => {
      const scaleKey = yScaleKey(origIdx);
      const axis = instance.axes.find((a) => a.scale === scaleKey);
      if (axis && axis.grid) {
        axis.grid.show =
          activeChannels.includes(channel.name) &&
          channel.name === selectedChannel;
      }
    });

    const selectedIdx = selectedChannel
      ? capture.channels.findIndex(
          (c) => c.name === selectedChannel && activeChannels.includes(c.name),
        )
      : -1;
    const selectedKey = selectedIdx >= 0 ? yScaleKey(selectedIdx) : null;
    const yMin =
      selectedKey != null ? (instance.scales[selectedKey]?.min ?? null) : null;
    const yMax =
      selectedKey != null ? (instance.scales[selectedKey]?.max ?? null) : null;
    useViewportStore.getState().setBounds({ yMin, yMax });

    if (instance.scales.x?.min != null) {
      instance.redraw();
    }
  }, [selectedChannel, activeChannels, capture]);

  // Custom channel name updates
  const customNames = useChannelNamesStore((state) => state.names);
  const labelSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    const instance = uplotRef.current;
    if (!instance || !capture) return;
    const signature = JSON.stringify(customNames);
    const isFirstRun = labelSignatureRef.current === null;
    const isUnchanged = labelSignatureRef.current === signature;
    labelSignatureRef.current = signature;
    if (isFirstRun || isUnchanged) return;

    capture.channels.forEach((channel, origIdx) => {
      const seriesIdx = origIdx + 1;
      const custom = customNames[channel.name];
      if (instance.series[seriesIdx]) {
        instance.series[seriesIdx].label = channelDisplayName(
          channel.name,
          channel.label,
          custom,
        );
      }
      const adapter = adaptersRef.current.get(origIdx);
      if (adapter) {
        adapter.setQuantity(custom || channel.name, instance);
        const scaleKey = yScaleKey(origIdx);
        const axis = instance.axes.find((a) => a.scale === scaleKey);
        if (axis) {
          axis.label = adapter.label;
        }
      }
    });

    // Issue #96: reference series labels track custom names too.
    const reference = useReferenceStore.getState();
    reference.capture?.channels.forEach((refChannel, refIdx) => {
      const name = toRefName(refChannel.name);
      const refSeriesIdx = capture.channels.length + refIdx + 1;
      if (instance.series[refSeriesIdx]) {
        instance.series[refSeriesIdx].label = channelDisplayName(
          name,
          undefined,
          customNames[name],
        );
      }
    });

    if (instance.scales.x?.min != null) {
      instance.redraw();
    }
  }, [customNames, capture]);

  // Theme & palette restyling in place
  useEffect(() => {
    const instance = uplotRef.current;
    if (!instance || !capture) return;

    const themeChanged = styledThemeRef.current !== theme;
    const configsChanged =
      styledConfigsRef.current === null ||
      !configsEqual(styledConfigsRef.current, keyConfigs);

    if (!themeChanged && !configsChanged) return;

    if (themeChanged) {
      const palette = resolveThemePalette(theme);
      if (instance.axes[0]) {
        instance.axes[0].stroke = () => palette.axisText;
        if (instance.axes[0].grid)
          instance.axes[0].grid.stroke = () => palette.grid;
        if (instance.axes[0].ticks)
          instance.axes[0].ticks.stroke = () => palette.ticks;
      }
      for (let i = 1; i < instance.axes.length; i++) {
        const ax = instance.axes[i]!;
        if (ax.grid) ax.grid.stroke = () => palette.grid;
        if (ax.ticks) ax.ticks.stroke = () => palette.ticks;
      }
      styledThemeRef.current = theme;
    }
    styledConfigsRef.current = { ...keyConfigs };
    applyTraceStrokes(instance, capture, theme);
  }, [theme, keyConfigs, capture]);

  // Issue #98 Quick-Stack: Overlay/Stack lane partitioning. Toggling
  // rewrites every visible channel's (own-axis) scale window so its
  // trace occupies one equal horizontal lane (top-first, primary file
  // order then visible reference channels); collapsing restores the
  // saved pre-stack windows. Pan/zoom keeps working on top of either
  // state — the mode applies at toggle time.
  const stackMode = useChannelDisplayStore((s) => s.stackMode);
  const preStackRef = useRef<Map<string, { min: number; max: number }>>(
    new Map(),
  );
  useEffect(() => {
    const instance = uplotRef.current;
    if (!instance || !capture) return;

    const visibleKeys: { scaleKey: string }[] = [];
    capture.channels.forEach((channel, index) => {
      if (!useViewportStore.getState().activeChannels.includes(channel.name))
        return;
      visibleKeys.push({ scaleKey: yScaleKey(index) });
    });
    const reference = useReferenceStore.getState();
    (reference.lanes ?? []).forEach((_lane, refIdx) => {
      const raw = reference.capture?.channels[refIdx];
      const name = raw ? toRefName(raw.name) : null;
      if (!name || !reference.refActiveChannels.includes(name)) return;
      visibleKeys.push({
        scaleKey: yScaleKey(capture.channels.length + refIdx),
      });
    });
    if (visibleKeys.length === 0) return;
    const restoring = !stackMode && preStackRef.current.size > 0;
    if (!stackMode && !restoring) return;

    // Same pre-first-paint guard as the display-transform effect (#238):
    // an immediate-mode batch needs computed axis increments.
    const axesReady = instance.axes.every(
      (axis) => (axis as unknown as { _found?: unknown })._found != null,
    );
    const apply = (): void => {
      visibleKeys.forEach(({ scaleKey }, laneIndex) => {
        const scale = instance.scales[scaleKey];
        if (!scale || scale.min == null || scale.max == null) return;
        const current = { min: scale.min, max: scale.max };
        if (stackMode) {
          if (!preStackRef.current.has(scaleKey)) {
            preStackRef.current.set(scaleKey, current);
          }
          // Review F1: lane the SAVED pre-stack window, never the live
          // (already laned) one — visibility toggles while stacked must
          // re-partition idempotently, not multiply the span again.
          const base = preStackRef.current.get(scaleKey)!;
          const lane = stackLaneBounds(base, laneIndex, visibleKeys.length);
          instance.setScale(scaleKey, { min: lane.min, max: lane.max });
        } else {
          const saved = preStackRef.current.get(scaleKey);
          if (saved) {
            instance.setScale(scaleKey, { min: saved.min, max: saved.max });
          }
        }
      });
    };
    if (axesReady) instance.batch(apply);
    else {
      apply();
      instance.redraw(false, true);
    }
    if (!stackMode) preStackRef.current.clear();
  }, [stackMode, capture, refLanes, activeChannels, refActiveChannels]);

  // Fit Waveform (100%) command channel
  useEffect(() => {
    if (fitRequest === lastFitRequestRef.current) return;
    lastFitRequestRef.current = fitRequest;

    const instance = uplotRef.current;
    if (!instance || !capture) return;

    applyFitBounds(
      instance,
      capture,
      useViewportStore.getState().activeChannels,
    );
  }, [fitRequest, capture]);

  if (!capture || capture.channels.length === 0) {
    return (
      <div
        className={`oscilloscope-empty ${className ?? ""}`.trim()}
        data-testid="oscilloscope-empty"
      >
        <p>No waveform capture loaded</p>
      </div>
    );
  }

  return (
    <div
      className="oscilloscope-wrapper"
      style={{
        position: "relative",
        width: "100%",
        flex: 1,
        minHeight: 0,
        display: "flex",
      }}
    >
      <div
        ref={containerRef}
        className={`oscilloscope-container ${className ?? ""}`.trim()}
        data-testid="oscilloscope-container"
        data-theme={theme}
        style={{
          backgroundColor: resolveThemePalette(theme).background,
        }}
      />
      <CursorRecoveryBadges capture={capture} />
      <CursorReadoutCard capture={capture} />
    </div>
  );
}
