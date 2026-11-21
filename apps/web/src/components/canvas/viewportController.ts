/**
 * Pure TypeScript ViewportController (issue #356): zero React dependency.
 *
 * Encapsulates the entire `uPlot` instance lifecycle, all private uPlot
 * internal mutations (`_pos`, `_size`, `_lpos`, `_found`, `_paths`,
 * `_yAxisSizeCache`, and the `show: true` → post-init `ax.show` dance),
 * axis-layout invalidation, first-paint readiness, Quick-Stack transitions,
 * remount view preservation, and display-lane buffers behind a small
 * high-level transition interface.
 *
 * Absorbs the former shallow helper modules `displayLaneCache.ts`,
 * `seriesPathCache.ts`, and `channelLayout.ts` (`stackLaneBoundsWeighted`).
 */

import uPlot from "uplot";
import type { AlignedData, Options } from "uplot";
import type { ParsedCapture } from "../../types/capture";
import type { ChannelTag } from "../../state/viewportStore";
import { useViewportStore } from "../../state/viewportStore";
import {
  applyViewportSnapshot,
  createViewportSnapshot,
  useZoomHistoryStore,
  type ViewportSnapshot,
} from "../../state/zoomHistoryStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import { laneFractions, useLaneLayoutStore } from "../../state/laneLayoutStore";
import { usePaletteStore } from "../../state/paletteStore";
import {
  refLaneFitBounds,
  useReferenceStore,
} from "../../state/referenceStore";
import { useThemeStore } from "../../state/themeStore";
import { getChannelCatalog } from "../../capture/channelCatalog";
import {
  buildDisplayData,
  channelFitRange,
  yScaleKey,
} from "../../capture/channelUnits";
import {
  displayKeyForChannel,
  effectiveInverted,
  effectiveOffset,
  effectiveYScale,
  transformBounds,
  transformDisplayLane,
  type ChannelDisplayConfigs,
} from "./channelDisplay";
import {
  effectiveTraceStroke,
  resolveThemePalette,
  type PaletteKeyConfigs,
  type ViewportTheme,
} from "./themePalette";
import {
  AXIS_LABEL_SIZE_PX,
  CANVAS_PADDING,
  buildChartSpec,
  cssPxRatio,
  syncAdapterToBounds,
  syncChartAdapters,
} from "./axesConfig";
import type { LaneWeights } from "./chartRenderState";
import { getLiveRenderState } from "./liveRenderState";
import { laneBandsCss } from "./stackLaneDecorations";
import { createTimeAxisAdapter } from "./timeAxis";
import { slippedRefDisplayLane } from "./timeSlip";
import { createYAxisAdapter, type YAxisAdapter } from "./yAxis";
import { BOX_ZOOM_MIN_DRAG_PX, boxZoomPlugin } from "./plugins/boxZoomPlugin";
import { groundMarkerPlugin } from "./plugins/groundMarkerPlugin";
import { laneResizePlugin } from "./plugins/laneResizePlugin";
import { panZoomPlugin } from "./plugins/panZoomPlugin";
import { timeSlipPlugin } from "./plugins/timeSlipPlugin";
import { hoverTooltipPlugin } from "./hoverTooltipPlugin";
import { cursorPlugin, findNearestSampleIndex } from "../cursors/cursorPlugin";
import { createSnapshotExporter } from "../export/snapshotExporter";
import { useSnapshotStore } from "../export/snapshotStore";

// ---------------------------------------------------------------------------
// Absorbed geometry & cache helpers (formerly channelLayout, displayLaneCache)
// ---------------------------------------------------------------------------

export interface Bounds {
  min: number;
  max: number;
}

/**
 * Re-windows a channel's pre-stack bounds into a horizontal lane band starting
 * at `bandStart` and spanning `bandFraction` of the plot height (issue #251).
 */
export function stackLaneBoundsWeighted(
  current: Bounds,
  bandStart: number,
  bandFraction: number,
): Bounds {
  if (!(bandFraction > 0)) return { ...current };
  const center = (current.min + current.max) / 2;
  const span = (current.max - current.min) / bandFraction;
  const centerYFraction = bandStart + bandFraction / 2;
  const max = center + centerYFraction * span;
  return { min: max - span, max };
}

const physicalLaneCache = new WeakMap<
  ParsedCapture,
  (Float32Array | undefined)[]
>();

/**
 * Rail-clipped physical display lane for one primary channel, computed once
 * per (capture, channel) and cached weakly by capture identity (issue #238).
 */
export function physicalDisplayLane(
  capture: ParsedCapture,
  index: number,
): Float32Array {
  let lanes = physicalLaneCache.get(capture);
  if (!lanes) {
    lanes = [];
    physicalLaneCache.set(capture, lanes);
  }
  let lane = lanes[index];
  if (!lane) {
    const channel = capture.channels[index];
    if (!channel) {
      throw new RangeError(`physicalDisplayLane: no channel at ${index}`);
    }
    const info = capture.metadata.channels[index];
    const physical = info && !info.derived ? info : undefined;
    lane = buildDisplayData(
      channel.data,
      channel.rawCounts,
      physical?.windowMin,
      physical?.windowMax,
    );
    lanes[index] = lane;
  }
  return lane;
}

// ---------------------------------------------------------------------------
// Encapsulated uPlot private-property adapters (issue #356 AC1)
// ---------------------------------------------------------------------------

interface InternalAxis {
  side?: number;
  show?: boolean;
  scale?: string;
  label?: unknown;
  labelSize?: number;
  _pos?: number;
  _size?: number;
  _lpos?: number;
  _found?: unknown;
}

interface InternalSeries {
  _paths?: unknown | null;
}

interface InternalUPlot {
  _yAxisSizeCache?: Map<string, number>;
}

/** True once uPlot's first layout pass has computed axis tick increments (`_found`) for all visible axes. */
export function areAxesReady(instance: uPlot): boolean {
  return instance.axes.every((axis) => {
    const internal = axis as unknown as InternalAxis;
    return internal.show === false || internal._found != null;
  });
}

/** Clears uPlot's cached Path2D geometry for one series (`_paths = null`, issue #245). */
export function invalidateSeriesPaths(
  instance: uPlot,
  seriesIndex: number,
): void {
  const series = instance.series[seriesIndex] as InternalSeries | undefined;
  if (series) {
    series._paths = null;
  }
}

/** Invalidates cached side-3 Y-axis widths (`_size = -1`) and optionally restores `labelSize`. */
export function invalidateYAxisLayout(
  instance: uPlot,
  restoreLabelSize: boolean,
): void {
  instance.axes.forEach((ax) => {
    const internal = ax as unknown as InternalAxis;
    if (internal.side === 3) {
      if (restoreLabelSize) {
        ax.labelSize = AXIS_LABEL_SIZE_PX;
      }
      internal._size = -1;
    }
  });
}

/** Clears the per-instance unified Stack Y-axis size cache (`_yAxisSizeCache`). */
export function clearYAxisSizeCache(instance: uPlot): void {
  (instance as unknown as InternalUPlot)._yAxisSizeCache?.clear();
}

/** Deletes a single scale key from `_yAxisSizeCache`. */
export function deleteYAxisSizeCacheEntry(
  instance: uPlot,
  scaleKey: string,
): void {
  (instance as unknown as InternalUPlot)._yAxisSizeCache?.delete(scaleKey);
}

/** Records a measured width in `_yAxisSizeCache` and returns the cache map. */
export function setYAxisSizeCacheEntry(
  instance: uPlot,
  scaleKey: string,
  measured: number,
): Map<string, number> {
  const cache = ((instance as unknown as InternalUPlot)._yAxisSizeCache ??=
    new Map());
  cache.set(scaleKey, measured);
  return cache;
}

/** Returns `_yAxisSizeCache` when present on an instance. */
export function getYAxisSizeCache(
  instance: uPlot,
): Map<string, number> | undefined {
  return (instance as unknown as InternalUPlot)._yAxisSizeCache;
}

/** Aligns all active side-3 axes to the unified Stack-mode left column (`_pos`, `_size`, `_lpos`). */
export function setUnifiedStackAxisGeometry(
  instance: uPlot,
  plotLeftCss: number,
  unifiedSize: number,
): void {
  for (let i = 1; i < instance.axes.length; i += 1) {
    const ax = instance.axes[i] as unknown as InternalAxis | undefined;
    if (ax && ax.side === 3 && ax.show !== false) {
      ax._pos = plotLeftCss;
      ax._size = unifiedSize;
      ax._lpos = plotLeftCss - unifiedSize;
      ax.labelSize = AXIS_LABEL_SIZE_PX;
    }
  }
}

/** Reads a visible side-3 axis's horizontal hit-test bounds `[colLeft, colRight]`. */
function readSide3AxisColumn(
  instance: uPlot,
  scaleKey: string,
): { colLeft: number; colRight: number } | null {
  const axis = instance.axes.find((a) => a.scale === scaleKey) as
    InternalAxis | undefined;
  if (!axis || axis.show === false) return null;
  if (axis._pos == null || axis._size == null) return null;
  const labelSize =
    axis.label != null && typeof axis.labelSize === "number"
      ? axis.labelSize
      : 0;
  const colLeft =
    (typeof axis._lpos === "number" ? axis._lpos : axis._pos - axis._size) -
    labelSize;
  return { colLeft, colRight: axis._pos };
}

// ---------------------------------------------------------------------------
// Fit & hit-testing helpers
// ---------------------------------------------------------------------------

/** Fraction of the visible-channel data span padded on each side of the Y axis by Reset View. */
export const FIT_PADDING_RATIO = 0.05;
/** Snap radius (plot px) for trace click selection. */
export const FOCUS_CLICK_SNAP_PX = 48;
const NEAREST_SAMPLE_WINDOW = 8;

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

export function applyFitBounds(
  instance: uPlot,
  capture: ParsedCapture,
  activeChannels: readonly ChannelTag[],
  preStackMap?: Map<string, Bounds>,
  adapters?: Map<number, YAxisAdapter>,
): void {
  const fit = computeCaptureFit(capture);
  const displayConfigs = useChannelDisplayStore.getState().keyConfigs;
  const stackMode = useChannelDisplayStore.getState().stackMode;
  const refStore = useReferenceStore.getState();
  const refLanes = refStore.lanes ?? [];
  const catalog = getChannelCatalog(capture, {
    referenceLaneCount: refLanes.length,
  });
  const unstackedBounds = new Map<string, Bounds>();
  catalog.channels.forEach((ch) => {
    const rawBounds =
      ch.slot === "primary"
        ? (fit.channels[ch.slotIndex] ?? { min: -1, max: 1 })
        : refLanes[ch.slotIndex]
          ? refLaneFitBounds(refLanes[ch.slotIndex]!)
          : { min: -1, max: 1 };
    unstackedBounds.set(
      ch.scaleKey,
      transformBounds(
        rawBounds,
        effectiveYScale(displayConfigs, ch.displayKey),
        effectiveOffset(displayConfigs, ch.displayKey),
        effectiveInverted(displayConfigs, ch.displayKey),
      ),
    );
  });

  instance.batch(() => {
    instance.setScale("x", { min: fit.xMin, max: fit.xMax });

    if (!stackMode) {
      preStackMap?.clear();
      invalidateYAxisLayout(instance, true);
      clearYAxisSizeCache(instance);
      catalog.channels.forEach((ch) => {
        const display = unstackedBounds.get(ch.scaleKey) ?? { min: -1, max: 1 };
        instance.setScale(ch.scaleKey, {
          min: display.min,
          max: display.max,
        });
      });
    } else {
      if (preStackMap) {
        for (const [scaleKey, display] of unstackedBounds) {
          preStackMap.set(scaleKey, display);
        }
      }

      const laneChannels = catalog.visibleLanes();
      const laneCount = laneChannels.length;
      const laneWeights = useLaneLayoutStore.getState().weights;
      const fractions = laneFractions(
        laneChannels.map((lane) => lane.displayKey),
        laneWeights,
      );
      let bandStart = 0;
      laneChannels.forEach((lane, laneIndex) => {
        const scaleKey = lane.scaleKey;
        const base = preStackMap?.get(scaleKey) ??
          unstackedBounds.get(scaleKey) ?? { min: -1, max: 1 };
        const fraction = fractions[laneIndex] ?? 1 / Math.max(laneCount, 1);
        const start = bandStart;
        bandStart += fraction;
        const laned = stackLaneBoundsWeighted(base, start, fraction);
        instance.setScale(scaleKey, { min: laned.min, max: laned.max });
      });
    }
  });

  if (adapters) {
    syncChartAdapters(instance, getLiveRenderState(capture), adapters);
  }

  const selectedChannel = useViewportStore.getState().selectedChannel;
  const selectedIndex = selectedChannel
    ? capture.channels.findIndex(
        (c) => c.name === selectedChannel && activeChannels.includes(c.name),
      )
    : -1;
  const selectedKey = selectedIndex >= 0 ? yScaleKey(selectedIndex) : null;
  const selectedScale = selectedKey ? instance.scales[selectedKey] : null;

  useViewportStore.getState().setBounds({
    xMin: fit.xMin,
    xMax: fit.xMax,
    yMin:
      selectedScale?.min ??
      (selectedIndex >= 0 ? fit.channels[selectedIndex]?.min : null) ??
      null,
    yMax:
      selectedScale?.max ??
      (selectedIndex >= 0 ? fit.channels[selectedIndex]?.max : null) ??
      null,
  });
}

function tripleEquals(
  a: [number, number, boolean],
  b: [number, number, boolean],
): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

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

interface PlotPoint {
  x: number;
  y: number;
}

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

// ---------------------------------------------------------------------------
// ViewportController (pure TypeScript uPlot lifecycle & transition owner)
// ---------------------------------------------------------------------------

export interface ViewportControllerCallbacks {
  onUPlotInit?: (uplot: uPlot) => void;
}

interface PreservedView {
  capture: ParsedCapture;
  xMin: number;
  xMax: number;
  yScales: Map<string, Bounds>;
  preStack: Map<string, Bounds>;
}

type ExtendedHostElement = HTMLElement & {
  __uplot?: uPlot;
  __preStack?: Map<string, Bounds>;
};

export class ViewportController {
  private readonly host: ExtendedHostElement;
  private callbacks: ViewportControllerCallbacks;

  private instance: uPlot | null = null;
  private capture: ParsedCapture | null = null;
  private mountedCapture: ParsedCapture | null = null;
  private mountedRefLanes: readonly Float32Array[] | null = null;

  private adapters = new Map<number, YAxisAdapter>();
  private preStack = new Map<string, Bounds>();
  private preservedView: PreservedView | null = null;

  private laneScratch = new Map<number, Float32Array>();
  private lastTransform: {
    instance: uPlot | null;
    capture: ParsedCapture | null;
    params: Map<string, [number, number, boolean]>;
    slip: number;
  } = { instance: null, capture: null, params: new Map(), slip: 0 };

  private styledTheme: string | null = null;
  private styledConfigs: Record<string, unknown> | null = null;
  private labelSignature: string | null = null;

  private domCleanup: (() => void) | null = null;

  constructor(host: HTMLElement, callbacks: ViewportControllerCallbacks = {}) {
    this.host = host as ExtendedHostElement;
    this.callbacks = callbacks;
  }

  setCallbacks(callbacks: ViewportControllerCallbacks): void {
    this.callbacks = callbacks;
  }

  getInstance(): uPlot | null {
    return this.instance;
  }

  getPreStackMap(): Map<string, Bounds> {
    return this.preStack;
  }

  /**
   * Mounts or remounts the uPlot instance when `capture` or `refLanes` changes.
   * When remounting the SAME primary `capture` (e.g. compare add/remove),
   * preserves the user's current X/Y scales and `preStack` map across the remount.
   */
  syncCapture(
    capture: ParsedCapture | null,
    refLanes: readonly Float32Array[] | null,
    size?: { width: number; height: number },
  ): void {
    if (
      this.instance &&
      this.mountedCapture === capture &&
      this.mountedRefLanes === refLanes
    ) {
      return;
    }

    // Tear down any existing instance first, preserving view if same primary capture.
    this.teardownInstance(capture);

    this.capture = capture;
    if (!capture || capture.channels.length === 0) {
      this.mountedCapture = null;
      this.mountedRefLanes = null;
      return;
    }

    const alignedData = this.buildAlignedData(capture, refLanes);
    const rect = this.host.getBoundingClientRect();
    const initialW = Math.max(
      Math.floor(size?.width || rect.width || this.host.clientWidth || 800),
      1,
    );
    const initialH = Math.max(
      Math.floor(size?.height || rect.height || this.host.clientHeight || 400),
      1,
    );

    const mountChannels = useViewportStore.getState().activeChannels;
    const mountSelected = useViewportStore.getState().selectedChannel;
    const initialFit = computeCaptureFit(capture);
    const displayConfigs = useChannelDisplayStore.getState().keyConfigs;
    const stackMode = useChannelDisplayStore.getState().stackMode;
    const laneWeights = useLaneLayoutStore.getState().weights;

    const isSameCaptureRemount = this.mountedCapture === capture;
    this.mountedCapture = capture;
    this.mountedRefLanes = refLanes;

    const preserved =
      isSameCaptureRemount && this.preservedView?.capture === capture
        ? this.preservedView
        : null;
    this.preservedView = null;

    const mountXMin = preserved ? preserved.xMin : initialFit.xMin;
    const mountXMax = preserved ? preserved.xMax : initialFit.xMax;

    const timeAxis = createTimeAxisAdapter();
    timeAxis.sync({
      scales: { x: { min: mountXMin, max: mountXMax } },
      axes: [{ label: undefined }],
    });

    const mountRefLanes = refLanes ?? [];
    const mountCatalog = getChannelCatalog(capture, {
      referenceLaneCount: mountRefLanes.length,
    });

    const unstackedBounds = new Map<string, Bounds>();
    mountCatalog.channels.forEach((ch) => {
      if (ch.slot === "primary") {
        if (preserved) {
          const savedBase = preserved.preStack.get(ch.scaleKey);
          if (savedBase) {
            unstackedBounds.set(ch.scaleKey, savedBase);
            return;
          }
          const savedScale = preserved.yScales.get(ch.scaleKey);
          if (savedScale) {
            unstackedBounds.set(ch.scaleKey, savedScale);
            return;
          }
        }
        const rawBounds = initialFit.channels[ch.slotIndex] ?? {
          min: -1,
          max: 1,
        };
        unstackedBounds.set(
          ch.scaleKey,
          transformBounds(
            rawBounds,
            effectiveYScale(displayConfigs, ch.displayKey),
            effectiveOffset(displayConfigs, ch.displayKey),
            effectiveInverted(displayConfigs, ch.displayKey),
          ),
        );
      } else {
        const lane = mountRefLanes[ch.slotIndex];
        const rawBounds = lane ? refLaneFitBounds(lane) : { min: -1, max: 1 };
        unstackedBounds.set(
          ch.scaleKey,
          transformBounds(
            rawBounds,
            effectiveYScale(displayConfigs, ch.displayKey),
            effectiveOffset(displayConfigs, ch.displayKey),
            effectiveInverted(displayConfigs, ch.displayKey),
          ),
        );
      }
    });

    this.preStack.clear();
    const lanedBounds = new Map<
      string,
      { bounds: Bounds; fraction: number; start: number }
    >();
    if (stackMode) {
      for (const [scaleKey, bounds] of unstackedBounds) {
        this.preStack.set(scaleKey, bounds);
      }

      const laneChannels = mountCatalog.visibleLanes();
      const fractions = laneFractions(
        laneChannels.map((lane) => lane.displayKey),
        laneWeights,
      );
      let bandStart = 0;
      laneChannels.forEach((lane, laneIndex) => {
        const base = this.preStack.get(lane.scaleKey) ?? {
          min: -1,
          max: 1,
        };
        const fraction =
          fractions[laneIndex] ?? 1 / Math.max(laneChannels.length, 1);
        const start = bandStart;
        bandStart += fraction;
        const laned = stackLaneBoundsWeighted(base, start, fraction);
        lanedBounds.set(lane.scaleKey, { bounds: laned, fraction, start });
      });
    }

    this.adapters = new Map();
    mountCatalog.channels.forEach((ch) => {
      const adapter = createYAxisAdapter({
        quantity: ch.axisQuantity,
        unit: ch.baseUnit,
        scaleKey: ch.scaleKey,
      });
      const lanedInfo = lanedBounds.get(ch.scaleKey);
      if (stackMode && lanedInfo) {
        syncAdapterToBounds(adapter, lanedInfo.bounds, {
          laneFraction: lanedInfo.fraction,
          bandStart: lanedInfo.start,
        });
      } else {
        const bounds = unstackedBounds.get(ch.scaleKey) ?? { min: -1, max: 1 };
        syncAdapterToBounds(adapter, bounds);
      }
      this.adapters.set(ch.channelIndex, adapter);
    });

    const mountYBounds = new Map<string, Bounds>();
    mountCatalog.channels.forEach((ch) => {
      const lanedInfo = lanedBounds.get(ch.scaleKey);
      mountYBounds.set(
        ch.scaleKey,
        stackMode && lanedInfo
          ? lanedInfo.bounds
          : (unstackedBounds.get(ch.scaleKey) ?? { min: -1, max: 1 }),
      );
    });

    const syncViewportBoundsFromInstance = (u: uPlot): void => {
      const curSelected = useViewportStore.getState().selectedChannel;
      const selectedIdx = curSelected
        ? capture.channels.findIndex((c) => c.name === curSelected)
        : -1;
      const selectedKey = selectedIdx >= 0 ? yScaleKey(selectedIdx) : null;
      const yMin =
        selectedKey != null ? (u.scales[selectedKey]?.min ?? null) : null;
      const yMax =
        selectedKey != null ? (u.scales[selectedKey]?.max ?? null) : null;
      const xMin = u.scales.x?.min ?? null;
      const xMax = u.scales.x?.max ?? null;
      useViewportStore.getState().setBounds({ xMin, xMax, yMin, yMax });
    };

    const mountSelectedScaleKey =
      mountCatalog.primary.find((ch) => ch.id === mountSelected)?.scaleKey ??
      null;

    const opts: Options = buildChartSpec({
      width: initialW,
      height: initialH,
      xBounds: { min: mountXMin, max: mountXMax },
      yBounds: mountYBounds,
      timeAxis,
      yAdapters: this.adapters,
      getRenderState: () =>
        getLiveRenderState(this.capture ?? capture, {
          referenceLaneCount: useReferenceStore.getState().lanes?.length ?? 0,
        }),
      initAllAxesShown: true,
      selectedScaleKey: mountSelectedScaleKey,
      cursor: {
        drag: { setScale: false, x: false, y: false },
        sync: { key: "scope" },
      },
      plugins: [
        boxZoomPlugin({
          getCapture: () => this.capture,
          onLaneZoom: (scaleKey, baseBounds) => {
            this.preStack.set(scaleKey, baseBounds);
          },
          onZoomCommit: (u) => {
            const snapshot = createViewportSnapshot(u, this.preStack);
            if (snapshot) {
              useZoomHistoryStore.getState().push(snapshot);
            }
          },
        }),
        panZoomPlugin({
          getCapture: () => this.capture,
          onLaneZoom: (scaleKey, baseBounds) => {
            this.preStack.set(scaleKey, baseBounds);
          },
          onPanEnd: (u) => {
            const snapshot = createViewportSnapshot(u, this.preStack);
            if (snapshot) {
              useZoomHistoryStore.getState().push(snapshot);
            }
          },
          onWheelSettle: (u) => {
            const snapshot = createViewportSnapshot(u, this.preStack);
            if (snapshot) {
              useZoomHistoryStore.getState().push(snapshot);
            }
          },
        }),
        groundMarkerPlugin({ getCapture: () => this.capture }),
        laneResizePlugin({ getCapture: () => this.capture }),
        cursorPlugin({ getCapture: () => this.capture }),
        hoverTooltipPlugin({
          getCapture: () => this.capture,
          getActiveChannels: () => useViewportStore.getState().activeChannels,
          getCustomNames: () => useChannelNamesStore.getState().names,
        }),
        timeSlipPlugin({ getCapture: () => this.capture }),
      ],
      onSetScale: syncViewportBoundsFromInstance,
      onSetSelect: syncViewportBoundsFromInstance,
    });

    const instance = new uPlot(opts, alignedData, this.host);
    this.instance = instance;
    this.styledTheme = useThemeStore.getState().theme;
    this.styledConfigs = { ...usePaletteStore.getState().keyConfigs };
    this.labelSignature = JSON.stringify(useChannelNamesStore.getState().names);

    // Issue #338: axes were constructed with show: true so uPlot initializes
    // defaults (space, incrs, splits, _el). Now apply initial visibility.
    mountCatalog.channels.forEach((ch) => {
      const ax = instance.axes.find((a) => a.scale === ch.scaleKey);
      if (ax) {
        ax.show = ch.visible;
      }
    });

    if (!preserved) {
      applyFitBounds(
        instance,
        capture,
        useViewportStore.getState().activeChannels,
        this.preStack,
        this.adapters,
      );
      const initialSnapshot = createViewportSnapshot(instance, this.preStack);
      if (initialSnapshot) {
        useZoomHistoryStore.getState().push(initialSnapshot);
      }
    } else {
      syncChartAdapters(instance, getLiveRenderState(capture), this.adapters);
      const curSelected = useViewportStore.getState().selectedChannel;
      const selectedIdx = curSelected
        ? capture.channels.findIndex(
            (c) => c.name === curSelected && mountChannels.includes(c.name),
          )
        : -1;
      const selectedKey = selectedIdx >= 0 ? yScaleKey(selectedIdx) : null;
      const selectedScale = selectedKey ? instance.scales[selectedKey] : null;
      useViewportStore.getState().setBounds({
        xMin: mountXMin,
        xMax: mountXMax,
        yMin: selectedScale?.min ?? null,
        yMax: selectedScale?.max ?? null,
      });
    }

    this.host.__uplot = instance;
    this.host.__preStack = this.preStack;
    this.callbacks.onUPlotInit?.(instance);

    this.domCleanup = this.bindDomHandlers(instance);
  }

  /** Resizes the live uPlot instance cleanly without remounting. */
  resize(width: number, height: number): void {
    if (!this.instance) return;
    if (width > 0 && height > 0) {
      this.instance.setSize({ width, height });
    }
  }

  /** Updates primary & reference series/axis visibility and selected-channel grid ownership. */
  setVisibilityAndSelection(
    activeChannels: readonly ChannelTag[],
    selectedChannel: ChannelTag | null,
    refCapture: ParsedCapture | null,
  ): void {
    const instance = this.instance;
    const capture = this.capture;
    if (!instance || !capture) return;

    const visCatalog = getChannelCatalog(capture, {
      referenceLaneCount: refCapture?.channels.length ?? 0,
    });
    const pinned: Array<{
      key: string;
      min: number | null;
      max: number | null;
    }> = [];

    visCatalog.channels.forEach((ch) => {
      const scale = instance.scales[ch.scaleKey];
      if (ch.slot === "primary" || (scale?.min != null && scale.max != null)) {
        pinned.push({
          key: ch.scaleKey,
          min: scale?.min ?? null,
          max: scale?.max ?? null,
        });
      }
      if (
        instance.series[ch.seriesIdx] &&
        instance.series[ch.seriesIdx]!.show !== ch.visible
      ) {
        instance.setSeries(ch.seriesIdx, { show: ch.visible });
      }
      const axis = instance.axes.find((a) => a.scale === ch.scaleKey);
      if (axis) {
        axis.show = ch.visible;
        if (ch.slot === "primary" && axis.grid) {
          axis.grid.show =
            activeChannels.includes(ch.id) && ch.id === selectedChannel;
        }
      }
    });

    if (!useChannelDisplayStore.getState().stackMode) {
      invalidateYAxisLayout(instance, false);
    }

    for (const pin of pinned) {
      if (pin.min != null && pin.max != null) {
        instance.setScale(pin.key, { min: pin.min, max: pin.max });
      }
    }

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

    instance.redraw(false, true);
  }

  /** Rewrites changed display lanes in place with scoped path invalidation (issues #224, #238, #245). */
  applyDisplayTransforms(displayConfigs: ChannelDisplayConfigs): void {
    const instance = this.instance;
    const capture = this.capture;
    if (!instance || !capture) return;

    const referenceNow = useReferenceStore.getState();
    const scratch = this.laneScratch;
    const last = this.lastTransform;
    const fresh = last.instance !== instance || last.capture !== capture;
    if (fresh) {
      scratch.clear();
      last.instance = instance;
      last.capture = capture;
      last.params = new Map();
      last.slip = referenceNow.timeSlipSamples;
    }

    const changed = (key: string, triple: [number, number, boolean]) => {
      const prev = last.params.get(key);
      last.params.set(key, triple);
      return fresh || prev === undefined || !tripleEquals(prev, triple);
    };

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

    const refLanes = referenceNow.lanes ?? [];
    const dispCatalog = getChannelCatalog(capture, {
      referenceLaneCount: refLanes.length,
    });
    const slipChanged = last.slip !== referenceNow.timeSlipSamples;
    last.slip = referenceNow.timeSlipSamples;
    dispCatalog.reference.forEach((ch) => {
      const lane = refLanes[ch.slotIndex];
      if (!lane) return;
      const triple: [number, number, boolean] = [
        effectiveYScale(displayConfigs, ch.displayKey),
        effectiveOffset(displayConfigs, ch.displayKey),
        effectiveInverted(displayConfigs, ch.displayKey),
      ];
      if (
        !slipChanged &&
        !changed(ch.displayKey ?? `ref${ch.slotIndex}`, triple)
      ) {
        return;
      }
      let buffer = scratch.get(ch.channelIndex);
      if (!buffer || buffer.length !== lane.length) {
        buffer = new Float32Array(lane.length);
        scratch.set(ch.channelIndex, buffer);
      }
      const slip = referenceNow.timeSlipSamples;
      swaps.push(() => {
        invalidateSeriesPaths(instance, ch.seriesIdx);
        instance.data[ch.seriesIdx] = slippedRefDisplayLane(
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

    if (areAxesReady(instance)) {
      instance.batch(() => {
        swaps.forEach((swap) => swap());
        pins.forEach((pin) => pin());
      });
    } else {
      swaps.forEach((swap) => swap());
      pins.forEach((pin) => pin());
      instance.redraw(false, true);
    }
  }

  /** Transitions between Overlay and Quick-Stack lane partitioning (issues #98, #251, #338, #350). */
  applyStackLayout(stackMode: boolean, laneWeights: LaneWeights): void {
    const instance = this.instance;
    const capture = this.capture;
    if (!instance || !capture) return;

    const laneChannels = getChannelCatalog(capture, {
      referenceLaneCount: useReferenceStore.getState().lanes?.length ?? 0,
    }).visibleLanes();
    const fractions = laneFractions(
      laneChannels.map((lane) => lane.displayKey),
      laneWeights,
    );
    const visibleKeys = laneChannels.map((lane) => ({
      scaleKey: lane.scaleKey,
    }));
    if (visibleKeys.length === 0) return;

    const restoring = !stackMode && this.preStack.size > 0;
    if (!stackMode && !restoring) return;

    let bandStart = 0;
    const bandOf = (laneIndex: number): { start: number; fraction: number } => {
      const fraction = fractions[laneIndex] ?? 1 / visibleKeys.length;
      const start = bandStart;
      bandStart += fraction;
      return { start, fraction };
    };

    const apply = (): void => {
      visibleKeys.forEach(({ scaleKey }, laneIndex) => {
        const scale = instance.scales[scaleKey];
        if (!scale || scale.min == null || scale.max == null) return;
        const current = { min: scale.min, max: scale.max };
        if (stackMode) {
          if (!this.preStack.has(scaleKey)) {
            this.preStack.set(scaleKey, current);
          }
          const base = this.preStack.get(scaleKey)!;
          const band = bandOf(laneIndex);
          const lane = stackLaneBoundsWeighted(base, band.start, band.fraction);
          instance.setScale(scaleKey, { min: lane.min, max: lane.max });
        } else {
          const saved = this.preStack.get(scaleKey);
          if (saved) {
            instance.setScale(scaleKey, { min: saved.min, max: saved.max });
          }
        }
      });
    };

    invalidateYAxisLayout(instance, !stackMode);
    if (!stackMode) {
      clearYAxisSizeCache(instance);
    }

    // Issue #350: skip until first paint completes so scales.x is never wiped to null.
    if (!areAxesReady(instance)) return;

    instance.batch(apply);
    instance.redraw(true, true);
    if (!stackMode) this.preStack.clear();
  }

  /** Applies Reset View full-capture fit bounds and pushes a zoom-history snapshot. */
  applyFit(): void {
    const instance = this.instance;
    const capture = this.capture;
    if (!instance || !capture) return;

    applyFitBounds(
      instance,
      capture,
      useViewportStore.getState().activeChannels,
      this.preStack,
      this.adapters,
    );
    const snapshot = createViewportSnapshot(instance, this.preStack);
    if (snapshot) {
      useZoomHistoryStore.getState().push(snapshot);
    }
  }

  /** Updates theme colors, palette overrides, and custom channel names in place. */
  applyThemeOrNames(
    theme: ViewportTheme,
    keyConfigs: PaletteKeyConfigs,
    customNames: Readonly<Record<string, string>>,
  ): void {
    const instance = this.instance;
    const capture = this.capture;
    if (!instance || !capture) return;

    // 1. Custom channel names
    const nextLabelSig = JSON.stringify(customNames);
    if (this.labelSignature !== null && this.labelSignature !== nextLabelSig) {
      const namesCatalog = getChannelCatalog(capture, {
        referenceLaneCount:
          useReferenceStore.getState().capture?.channels.length ?? 0,
      });
      namesCatalog.channels.forEach((ch) => {
        if (instance.series[ch.seriesIdx]) {
          instance.series[ch.seriesIdx]!.label = ch.displayName;
        }
        const adapter = this.adapters.get(ch.channelIndex);
        if (adapter) {
          adapter.setQuantity(ch.axisQuantity, instance);
          const axis = instance.axes.find((a) => a.scale === ch.scaleKey);
          if (axis) {
            axis.label = adapter.label;
          }
        }
      });
      if (instance.scales.x?.min != null) {
        instance.redraw();
      }
    }
    this.labelSignature = nextLabelSig;

    // 2. Theme & palette strokes
    const themeChanged = this.styledTheme !== theme;
    const configsChanged =
      this.styledConfigs === null ||
      !configsEqual(this.styledConfigs, keyConfigs);
    if (!themeChanged && !configsChanged) return;

    if (themeChanged) {
      const palette = resolveThemePalette(theme);
      if (instance.axes[0]) {
        instance.axes[0].stroke = () => palette.axisText;
        if (instance.axes[0].grid) {
          instance.axes[0].grid.stroke = () => palette.grid;
        }
        if (instance.axes[0].ticks) {
          instance.axes[0].ticks.stroke = () => palette.ticks;
        }
      }
      for (let i = 1; i < instance.axes.length; i += 1) {
        const ax = instance.axes[i]!;
        if (ax.grid) ax.grid.stroke = () => palette.grid;
        if (ax.ticks) ax.ticks.stroke = () => palette.ticks;
      }
      this.styledTheme = theme;
    }
    this.styledConfigs = { ...keyConfigs };

    const { customColors, keyConfigs: liveConfigs } =
      usePaletteStore.getState();
    const catalog = getChannelCatalog(capture, {
      referenceLaneCount: useReferenceStore.getState().lanes?.length ?? 0,
    });
    catalog.channels.forEach((ch) => {
      const series = instance.series[ch.seriesIdx];
      if (series) {
        series.stroke = () =>
          effectiveTraceStroke(theme, customColors, liveConfigs, ch.id);
      }
    });
    instance.redraw();
  }

  /** Restores a zoom-history viewport snapshot (issue #287). */
  restoreSnapshot(target: ViewportSnapshot): void {
    if (!this.instance) {
      useZoomHistoryStore.getState().setIsNavigating(false);
      return;
    }
    applyViewportSnapshot(this.instance, target, this.preStack);
    useZoomHistoryStore.getState().setIsNavigating(false);
  }

  /** Permanently destroys the controller and cleans up DOM listeners and uPlot instance. */
  destroy(): void {
    this.teardownInstance(null);
    this.capture = null;
    this.mountedCapture = null;
    this.mountedRefLanes = null;
    this.preservedView = null;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildAlignedData(
    capture: ParsedCapture,
    refLanes: readonly Float32Array[] | null,
  ): AlignedData {
    const displayConfigs = useChannelDisplayStore.getState().keyConfigs;
    const reference = useReferenceStore.getState();
    const refLanesNow = refLanes ?? [];
    const dataCatalog = getChannelCatalog(capture, {
      referenceLaneCount: refLanesNow.length,
    });
    return [
      capture.timestamps,
      ...dataCatalog.channels.map((ch) => {
        if (ch.slot === "primary") {
          return transformDisplayLane(
            physicalDisplayLane(capture, ch.slotIndex),
            effectiveYScale(displayConfigs, ch.displayKey),
            effectiveOffset(displayConfigs, ch.displayKey),
            effectiveInverted(displayConfigs, ch.displayKey),
          );
        }
        const lane = refLanesNow[ch.slotIndex]!;
        return slippedRefDisplayLane(
          lane,
          reference.timeSlipSamples,
          effectiveYScale(displayConfigs, ch.displayKey),
          effectiveOffset(displayConfigs, ch.displayKey),
          effectiveInverted(displayConfigs, ch.displayKey),
        );
      }),
    ] as AlignedData;
  }

  private bindDomHandlers(instance: uPlot): () => void {
    const container = this.host;
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
      const live = this.capture;
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

    const onContainerClick = (event: MouseEvent): void => {
      if (event.button !== 0) return;
      const live = this.capture;
      if (!live) return;
      const rect = container.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const instancePxRatio = cssPxRatio(instance);
      const plotLeft = instance.bbox.left / instancePxRatio;
      if (clickX >= plotLeft || clickX < CANVAS_PADDING[3]) return;

      const active = useViewportStore.getState().activeChannels;
      const visible = live.channels.filter((c) => active.includes(c.name));

      if (useChannelDisplayStore.getState().stackMode) {
        const plotTop = instance.bbox.top / instancePxRatio;
        const clickY = event.clientY - rect.top - plotTop;
        const bands = laneBandsCss(instance, getLiveRenderState(live));
        const hitBand = bands.find(
          (b) => clickY >= b.top && clickY <= b.bottom,
        );
        if (hitBand) {
          const hitCh = visible.find(
            (c) => yScaleKey(live.channels.indexOf(c)) === hitBand.scaleKey,
          );
          if (hitCh) {
            useViewportStore.getState().setSelectedChannel(hitCh.name);
          }
          return;
        }
      } else {
        for (const ch of visible) {
          const origIdx = live.channels.indexOf(ch);
          const col = readSide3AxisColumn(instance, yScaleKey(origIdx));
          if (col && clickX >= col.colLeft && clickX < col.colRight) {
            useViewportStore.getState().setSelectedChannel(ch.name);
            return;
          }
        }
      }
    };
    container.addEventListener("click", onContainerClick);

    useSnapshotStore.getState().registerExporter(
      createSnapshotExporter({
        getUplot: () => this.instance ?? instance,
        getCapture: () => this.capture,
        getContainer: () => container,
      }),
    );

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
    };
    container.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("click", onContainerClick);
      over.removeEventListener("mousedown", onPointerDown);
      over.removeEventListener("mouseup", onPointerUp);
      useSnapshotStore.getState().registerExporter(null);
    };
  }

  private teardownInstance(nextCapture: ParsedCapture | null): void {
    const instance = this.instance;
    const capture = this.capture;
    if (instance && capture) {
      if (nextCapture === capture) {
        const yScales = new Map<string, Bounds>();
        capture.channels.forEach((_, index) => {
          const scaleKey = yScaleKey(index);
          const scale = instance.scales[scaleKey];
          if (scale?.min != null && scale.max != null) {
            yScales.set(scaleKey, { min: scale.min, max: scale.max });
          }
        });
        const xScale = instance.scales.x;
        if (xScale?.min != null && xScale.max != null) {
          this.preservedView = {
            capture,
            xMin: xScale.min,
            xMax: xScale.max,
            yScales,
            preStack: new Map(this.preStack),
          };
        }
      } else {
        this.preservedView = null;
      }
    }

    if (this.domCleanup) {
      this.domCleanup();
      this.domCleanup = null;
    }
    if (instance) {
      instance.destroy();
      this.instance = null;
    }
    delete this.host.__uplot;
    delete this.host.__preStack;
  }
}
