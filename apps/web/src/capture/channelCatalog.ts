/**
 * Canonical Channel Catalog (issue #354): single source of truth for ordered
 * `PlotChannel` descriptors across Primary Capture (File 1) and Reference
 * Capture (File 2) slots.
 *
 * Pure derivation module: builds canonical descriptors from explicit inputs
 * (`buildChannelCatalog`), with imperative (`getChannelCatalog`) and React
 * (`useChannelCatalog`) facades over the existing Zustand stores. Every
 * consumer (canvas, toolbar, PNG/CSV export, measurements, plugins, popovers)
 * iterates one canonical channel sequence instead of maintaining parallel
 * Primary/Reference loops, `startsWith("Ref-")` checks, or manual
 * `capture.channels.length + refIdx` index arithmetic.
 */

import { useMemo } from "react";
import type { ParsedCapture, WaveformChannel } from "../types/capture";
import { getPhysicalChannelUnit, splitUnit, yScaleKey } from "./channelUnits";
import {
  displayKeyForChannel,
  type ChannelKey,
} from "../components/canvas/channelDisplay";
import {
  effectiveTraceColor,
  effectiveTraceStroke,
  paletteKeyForChannel,
  type CustomColors,
  type PaletteKey,
  type PaletteKeyConfigs,
  type ViewportTheme,
} from "../components/canvas/themePalette";
import { useCaptureStore } from "../state/captureStore";
import { useViewportStore } from "../state/viewportStore";
import { useReferenceStore } from "../state/referenceStore";
import {
  channelDisplayName,
  useChannelNamesStore,
} from "../state/channelNamesStore";
import { useThemeStore } from "../state/themeStore";
import { usePaletteStore } from "../state/paletteStore";

/** Owning capture slot for a channel descriptor. */
export type ChannelSlot = "primary" | "reference";

/** Branded canonical channel identifier ("A"…"D" for primary, "Ref-A"…"Ref-D" for reference). */
export type ChannelId = string & { readonly __channelIdBrand: unique symbol };

const REF_CHANNEL_PREFIX = "Ref-";
const INPUT_PREFIX_RE = /^Input\s+/i;

/** Strips a leading "Input " prefix and trims whitespace. */
export function normalizeChannelTag(channelName: string): string {
  return channelName.trim().replace(INPUT_PREFIX_RE, "").trim();
}

/** Constructs a canonical branded `ChannelId` for a slot and raw channel name. */
export function makeChannelId(
  slot: ChannelSlot,
  channelName: string,
): ChannelId {
  if (slot === "reference") {
    return `${REF_CHANNEL_PREFIX}${normalizeChannelTag(channelName)}` as ChannelId;
  }
  return channelName as ChannelId;
}

/** True when a channel identifier belongs to the File 2 reference slot. */
export function isReferenceChannelId(id: string): boolean {
  return (
    id.length > REF_CHANNEL_PREFIX.length &&
    id.slice(0, REF_CHANNEL_PREFIX.length) === REF_CHANNEL_PREFIX
  );
}

/** Parses a canonical channel identifier into its owning slot and normalized raw tag. */
export function parseChannelId(id: string): {
  slot: ChannelSlot;
  rawTag: string;
} {
  if (isReferenceChannelId(id)) {
    return {
      slot: "reference",
      rawTag: normalizeChannelTag(id.slice(REF_CHANNEL_PREFIX.length)),
    };
  }
  return {
    slot: "primary",
    rawTag: normalizeChannelTag(id),
  };
}

/** Canonical descriptor for one plottable channel in either Primary or Reference slot. */
export interface PlotChannel {
  readonly id: ChannelId;
  readonly slot: ChannelSlot;
  readonly rawTag: string;
  /** 0-based index within the owning capture's channels array. */
  readonly slotIndex: number;
  /** 0-based index across the unified catalog (matches uPlot yN scale & adapter index). */
  readonly channelIndex: number;
  /** 1-based uPlot series index (0 is the shared X/time axis). */
  readonly seriesIdx: number;
  /** uPlot vertical scale key ("y0", "y1", ...). */
  readonly scaleKey: string;
  /** Full display name ("A: custom" or capture label/id). */
  readonly displayName: string;
  /** Short badge label ("A: custom" or "A", "Ref-A: custom" or "Ref-A"). */
  readonly badgeLabel: string;
  /** Axis heading quantity (custom name if set, else canonical id). */
  readonly axisQuantity: string;
  /** Active custom name amendment, if any. */
  readonly customName: string | undefined;
  /** Raw physical unit string from capture metadata (e.g. "V", "mV"). */
  readonly unit: string;
  /** Canonical SI base unit (e.g. "V", "A"). */
  readonly baseUnit: string;
  /** Whether this channel is currently visible on the canvas. */
  readonly visible: boolean;
  /** Whether this channel is currently selected (always false for reference channels). */
  readonly selected: boolean;
  /** Effective hex trace color under current theme + custom overrides. */
  readonly color: string;
  /** Effective trace stroke CSS (hex or rgba() with per-key opacity). */
  readonly stroke: string;
  /** Display-transform key ("A".."D" | "Ref-A".."Ref-D") or null for non-palette channels. */
  readonly displayKey: ChannelKey | null;
  /** Palette key or null for non-palette channels. */
  readonly paletteKey: PaletteKey | null;
  /** Underlying parsed channel (null only for synthetic trailing lanes without capture). */
  readonly channel: WaveformChannel | null;
  /** Owning capture (null only for synthetic trailing lanes without capture). */
  readonly capture: ParsedCapture | null;
}

export type LanePlotChannel = PlotChannel & {
  readonly displayKey: ChannelKey;
};

export interface ChannelCatalogInput {
  primaryCapture: ParsedCapture | null;
  referenceCapture?: ParsedCapture | null;
  /**
   * Explicit reference channel count (e.g. when aligning to live uPlot lanes
   * or trailing export series). Defaults to `referenceCapture?.channels.length ?? 0`.
   */
  referenceLaneCount?: number;
  activeChannels: readonly string[];
  selectedChannel: string | null;
  refActiveChannels?: readonly string[];
  customNames?: Readonly<Record<string, string>>;
  theme?: ViewportTheme;
  customColors?: CustomColors;
  keyConfigs?: PaletteKeyConfigs;
}

export interface ChannelCatalog {
  /** All Primary channels in file order followed by all Reference channels in file order. */
  readonly channels: readonly PlotChannel[];
  /** Primary channels only, in file order. */
  readonly primary: readonly PlotChannel[];
  /** Reference channels only, in file order. */
  readonly reference: readonly PlotChannel[];
  /** Lookup by canonical channel id (or normalized primary tag). */
  byId(id: string): PlotChannel | null;
  /** Lookup by uPlot vertical scale key ("y0", ...). */
  byScaleKey(scaleKey: string): PlotChannel | null;
  /** Lookup by 1-based uPlot series index. */
  bySeriesIdx(seriesIdx: number): PlotChannel | null;
  /**
   * Visible channels carrying a display key, in canonical top-first lane order
   * (primary channels in file order, then visible reference channels).
   */
  visibleLanes(): readonly LanePlotChannel[];
}

/** Pure builder deriving a `ChannelCatalog` from explicit capture and UI state. */
export function buildChannelCatalog(
  input: ChannelCatalogInput,
): ChannelCatalog {
  const {
    primaryCapture,
    referenceCapture = null,
    activeChannels,
    selectedChannel,
    refActiveChannels = [],
    customNames = {},
    theme = "dark",
    customColors = {},
    keyConfigs = {},
  } = input;

  const primary: PlotChannel[] = [];
  const reference: PlotChannel[] = [];
  const byIdMap = new Map<string, PlotChannel>();
  const byScaleKeyMap = new Map<string, PlotChannel>();
  const bySeriesIdxMap = new Map<number, PlotChannel>();

  if (primaryCapture) {
    primaryCapture.channels.forEach((channel, idx) => {
      const id = makeChannelId("primary", channel.name);
      const rawTag = normalizeChannelTag(channel.name);
      const scaleKey = yScaleKey(idx);
      const customName = customNames[id];
      const unit = getPhysicalChannelUnit(primaryCapture, idx);
      const baseUnit = splitUnit(unit).base;
      const visible = activeChannels.includes(id);
      const selected = visible && selectedChannel === id;
      const descriptor: PlotChannel = {
        id,
        slot: "primary",
        rawTag,
        slotIndex: idx,
        channelIndex: idx,
        seriesIdx: idx + 1,
        scaleKey,
        displayName: channelDisplayName(id, channel.label, customName),
        badgeLabel: customName ? `${id}: ${customName}` : id,
        axisQuantity: customName || id,
        customName,
        unit,
        baseUnit,
        visible,
        selected,
        color: effectiveTraceColor(theme, customColors, id),
        stroke: effectiveTraceStroke(theme, customColors, keyConfigs, id),
        displayKey: displayKeyForChannel(id),
        paletteKey: paletteKeyForChannel(id),
        channel,
        capture: primaryCapture,
      };
      primary.push(descriptor);
      byIdMap.set(id, descriptor);
      if (rawTag !== id && !byIdMap.has(rawTag)) {
        byIdMap.set(rawTag, descriptor);
      }
      byScaleKeyMap.set(scaleKey, descriptor);
      bySeriesIdxMap.set(descriptor.seriesIdx, descriptor);
    });
  }

  const primaryCount = primary.length;
  const refCount =
    input.referenceLaneCount ?? referenceCapture?.channels.length ?? 0;

  for (let refIdx = 0; refIdx < refCount; refIdx += 1) {
    const raw = referenceCapture?.channels[refIdx] ?? null;
    const rawTag = raw
      ? normalizeChannelTag(raw.name)
      : String.fromCharCode(65 + refIdx);
    const id = makeChannelId("reference", raw ? raw.name : rawTag);
    const channelIndex = primaryCount + refIdx;
    const scaleKey = yScaleKey(channelIndex);
    const customName = customNames[id];
    const unit =
      raw && referenceCapture
        ? getPhysicalChannelUnit(referenceCapture, refIdx)
        : "V";
    const baseUnit = splitUnit(unit).base;
    const visible = refActiveChannels.includes(id);
    const descriptor: PlotChannel = {
      id,
      slot: "reference",
      rawTag,
      slotIndex: refIdx,
      channelIndex,
      seriesIdx: channelIndex + 1,
      scaleKey,
      displayName: channelDisplayName(id, undefined, customName),
      badgeLabel: customName ? `${id}: ${customName}` : id,
      axisQuantity: customName || id,
      customName,
      unit,
      baseUnit,
      visible,
      selected: false,
      color: effectiveTraceColor(theme, customColors, id),
      stroke: effectiveTraceStroke(theme, customColors, keyConfigs, id),
      displayKey: displayKeyForChannel(id),
      paletteKey: paletteKeyForChannel(id),
      channel: raw,
      capture: raw ? referenceCapture : null,
    };
    reference.push(descriptor);
    byIdMap.set(id, descriptor);
    byScaleKeyMap.set(scaleKey, descriptor);
    bySeriesIdxMap.set(descriptor.seriesIdx, descriptor);
  }

  const channels: readonly PlotChannel[] = [...primary, ...reference];

  return {
    channels,
    primary,
    reference,
    byId(id: string): PlotChannel | null {
      return byIdMap.get(id) ?? null;
    },
    byScaleKey(scaleKey: string): PlotChannel | null {
      return byScaleKeyMap.get(scaleKey) ?? null;
    },
    bySeriesIdx(seriesIdx: number): PlotChannel | null {
      return bySeriesIdxMap.get(seriesIdx) ?? null;
    },
    visibleLanes(): readonly LanePlotChannel[] {
      return channels.filter(
        (ch): ch is LanePlotChannel => ch.visible && ch.displayKey !== null,
      );
    },
  };
}

export interface ChannelCatalogOptions {
  /**
   * Explicit reference channel count (e.g. `refLanes.length` for live uPlot
   * alignment or `trailingSeriesCount` for PNG export).
   */
  referenceLaneCount?: number;
}

/** Imperative snapshot of the current `ChannelCatalog` from Zustand stores. */
export function getChannelCatalog(
  primaryCaptureOverride?: ParsedCapture | null,
  options?: ChannelCatalogOptions,
): ChannelCatalog {
  const primaryCapture =
    primaryCaptureOverride !== undefined
      ? primaryCaptureOverride
      : useCaptureStore.getState().capture;
  const viewport = useViewportStore.getState();
  const reference = useReferenceStore.getState();
  const customNames = useChannelNamesStore.getState().names;
  const theme = useThemeStore.getState().theme;
  const palette = usePaletteStore.getState();

  return buildChannelCatalog({
    primaryCapture,
    referenceCapture: reference.capture,
    referenceLaneCount: options?.referenceLaneCount,
    activeChannels: viewport.activeChannels,
    selectedChannel: viewport.selectedChannel,
    refActiveChannels: reference.refActiveChannels,
    customNames,
    theme,
    customColors: palette.customColors,
    keyConfigs: palette.keyConfigs,
  });
}

/** Reactive selector hook returning a memoized `ChannelCatalog`. */
export function useChannelCatalog(
  options?: ChannelCatalogOptions,
): ChannelCatalog {
  const primaryCapture = useCaptureStore((s) => s.capture);
  const referenceCapture = useReferenceStore((s) => s.capture);
  const activeChannels = useViewportStore((s) => s.activeChannels);
  const selectedChannel = useViewportStore((s) => s.selectedChannel);
  const refActiveChannels = useReferenceStore((s) => s.refActiveChannels);
  const customNames = useChannelNamesStore((s) => s.names);
  const theme = useThemeStore((s) => s.theme);
  const customColors = usePaletteStore((s) => s.customColors);
  const keyConfigs = usePaletteStore((s) => s.keyConfigs);
  const referenceLaneCount = options?.referenceLaneCount;

  return useMemo(
    () =>
      buildChannelCatalog({
        primaryCapture,
        referenceCapture,
        referenceLaneCount,
        activeChannels,
        selectedChannel,
        refActiveChannels,
        customNames,
        theme,
        customColors,
        keyConfigs,
      }),
    [
      primaryCapture,
      referenceCapture,
      referenceLaneCount,
      activeChannels,
      selectedChannel,
      refActiveChannels,
      customNames,
      theme,
      customColors,
      keyConfigs,
    ],
  );
}
