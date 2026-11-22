/**
 * Live-viewport render-state adapter (issue #355): reads the current Zustand
 * stores and assembles a `ChartRenderState` snapshot for the live canvas,
 * interactive plugins, and browser test assertions.
 */

import type { ParsedCapture } from "../../types/capture";
import { getChannelCatalog } from "../../capture/channelCatalog";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import { useLaneLayoutStore } from "../../state/laneLayoutStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import { effectiveTraceColor, resolveThemePalette } from "./themePalette";
import type { ChartRenderState } from "./chartRenderState";

export interface LiveRenderStateOptions {
  /** Explicit reference lane count (defaults to `useReferenceStore.getState().lanes?.length ?? 0`). */
  referenceLaneCount?: number;
  /** Optional active primary channel list override for pre-layout scale projection. */
  activeChannels?: readonly string[];
}

/** Captures the current live render state from Zustand stores for a given capture. */
export function getLiveRenderState(
  capture: ParsedCapture,
  options?: LiveRenderStateOptions,
): ChartRenderState {
  const refState = useReferenceStore.getState();
  const refLaneCount =
    options?.referenceLaneCount ?? refState.lanes?.length ?? 0;
  const catalog = getChannelCatalog(capture, {
    referenceLaneCount: refLaneCount,
    activeChannels: options?.activeChannels,
  });
  const displayState = useChannelDisplayStore.getState();
  const laneWeights = useLaneLayoutStore.getState().weights;
  const theme = useThemeStore.getState().theme;
  const palette = resolveThemePalette(theme);
  const customColors = usePaletteStore.getState().customColors;

  return {
    capture,
    catalog,
    stackMode: displayState.stackMode,
    laneWeights,
    displayConfigs: displayState.keyConfigs,
    chrome: {
      background: palette.background,
      grid: palette.grid,
      ticks: palette.ticks,
      axisText: palette.axisText,
      triggerAccent: palette.triggerAccent,
      triggerGlyphClear: palette.background,
      separatorColor: palette.grid,
      drawLaneHandles: true,
      fillBackground: true,
      omitGrid: false,
      groundFlagText: palette.axisText,
      channelColor: (ch) => ch.color,
      channelStroke: (ch) => ch.stroke,
    },
    t2:
      refState.capture && refState.lanes
        ? {
            timeSlipSamples: refState.timeSlipSamples,
            accentColor: effectiveTraceColor(theme, customColors, "Ref-A"),
          }
        : null,
  };
}
