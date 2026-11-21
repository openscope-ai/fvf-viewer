/**
 * Pure chart render-state contract (issue #355): decouples uPlot chart-spec
 * construction, Stack-mode lane decorations, ground flags, and offscreen PNG
 * export from global Zustand stores.
 *
 * Live rendering supplies a `getRenderState()` getter that reads current store
 * state on demand; offscreen PNG export passes a frozen static snapshot.
 */

import type { ChannelCatalog, PlotChannel } from "../../capture/channelCatalog";
import type { ParsedCapture } from "../../types/capture";
import type { ChannelDisplayConfigs, ChannelKey } from "./channelDisplay";

export type LaneWeights = Partial<Record<ChannelKey, number>>;

/** Visual chrome contract parameterized across live dark/light and print exports. */
export interface ChartChrome {
  readonly background: string;
  readonly grid: string;
  readonly ticks: string;
  readonly axisText: string;
  readonly triggerAccent: string;
  readonly triggerGlyphClear: string;
  readonly separatorColor: string;
  /** Draw interactive lane-resize midpoint grips on Stack separators (live only). */
  readonly drawLaneHandles: boolean;
  /** Fill plot background in drawClear (false for transparent PNG export). */
  readonly fillBackground: boolean;
  /** Omit horizontal/vertical graticule grid lines (PNG export grid-off option). */
  readonly omitGrid: boolean;
  /** Text color for ground flag tag letters ("A", "RA", ...). */
  readonly groundFlagText: string;
  /** Effective color for channel axes, lane titles, and ground flags. */
  readonly channelColor: (ch: PlotChannel) => string;
  /** Effective stroke CSS for channel traces (may include rgba opacity). */
  readonly channelStroke: (ch: PlotChannel) => string;
}

/** Minimal slice required for Stack-mode lane band partitioning and tick filtering. */
export interface LaneLayoutState {
  readonly catalog: ChannelCatalog;
  readonly stackMode: boolean;
  readonly laneWeights: LaneWeights;
}

/** Complete explicit render state consumed by chart-spec builders and draw hooks. */
export interface ChartRenderState extends LaneLayoutState {
  readonly capture: ParsedCapture;
  readonly displayConfigs: ChannelDisplayConfigs;
  readonly chrome: ChartChrome;
  /** Optional File 2 T2 trigger state (present when a reference comparison is active). */
  readonly t2?: {
    readonly timeSlipSamples: number;
    readonly accentColor: string;
  } | null;
}
