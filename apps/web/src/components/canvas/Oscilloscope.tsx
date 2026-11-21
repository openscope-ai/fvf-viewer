/**
 * Thin React shell over `ViewportController` (issue #356):
 * hosts the canvas container, subscribes to Zustand stores, and forwards
 * high-level transitions (`syncCapture`, `setVisibilityAndSelection`,
 * `applyDisplayTransforms`, `applyStackLayout`, `applyFit`,
 * `applyThemeOrNames`, `restoreSnapshot`, `resize`, `destroy`) to the pure
 * TypeScript `ViewportController`.
 */

import { useEffect, useRef } from "react";
import type uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { useResizeObserver } from "../../hooks/useResizeObserver";
import { useCaptureStore } from "../../state/captureStore";
import { useViewportStore } from "../../state/viewportStore";
import { useZoomHistoryStore } from "../../state/zoomHistoryStore";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import { useLaneLayoutStore } from "../../state/laneLayoutStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useCursorStore } from "../../state/cursorStore";
import type { ParsedCapture } from "../../types/capture";
import { DARK_THEME, resolveThemePalette } from "./themePalette";
import { NAVIGATION_HELP_SUMMARY } from "./navigationHelp";
import { CursorReadoutCard } from "../cursors/CursorReadoutCard";
import { CursorRecoveryBadges } from "../cursors/CursorRecoveryBadges";
import { ViewportController } from "./viewportController";

export { DARK_THEME as THEME_COLORS };
export {
  FIT_PADDING_RATIO,
  FOCUS_CLICK_SNAP_PX,
  applyFitBounds,
  computeCaptureFit,
  resolveActiveIndex,
  type CaptureFit,
  type ChannelFitBounds,
} from "./viewportController";

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
  const fitRequest = useViewportStore((state) => state.fitRequest);
  const refCapture = useReferenceStore((state) => state.capture);
  const refLanes = useReferenceStore((state) => state.lanes);
  const refActiveChannels = useReferenceStore(
    (state) => state.refActiveChannels,
  );
  const theme = useThemeStore((state) => state.theme);
  const keyConfigs = usePaletteStore((state) => state.keyConfigs);
  const customNames = useChannelNamesStore((state) => state.names);
  const displayConfigs = useChannelDisplayStore((state) => state.keyConfigs);
  const stackMode = useChannelDisplayStore((state) => state.stackMode);
  const laneWeights = useLaneLayoutStore((state) => state.weights);
  const restoreRequest = useZoomHistoryStore((state) => state.restoreRequest);

  const {
    ref: containerRef,
    width,
    height,
  } = useResizeObserver<HTMLDivElement>();

  const controllerRef = useRef<ViewportController | null>(null);
  const controllerHostRef = useRef<HTMLDivElement | null>(null);
  const lastFitRequestRef = useRef(fitRequest);
  const lastRestoreRef = useRef<number | null>(null);
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };

  // Destroy controller on unmount
  useEffect(() => {
    return () => {
      controllerRef.current?.destroy();
      controllerRef.current = null;
      controllerHostRef.current = null;
    };
  }, []);

  // Standalone Oscilloscope renders with an explicit capture prop (outside
  // CaptureSession.ingestPrimary) still initialize cursors and selection.
  useEffect(() => {
    if (explicitCapture === undefined) return;
    useZoomHistoryStore.getState().reset();
    if (explicitCapture) {
      useCursorStore
        .getState()
        .initForCapture(explicitCapture.timestamps.length);
      const curSelected = useViewportStore.getState().selectedChannel;
      const isValid =
        curSelected != null &&
        explicitCapture.channels.some((c) => c.name === curSelected);
      if (!isValid && explicitCapture.channels.length > 0) {
        useViewportStore
          .getState()
          .setSelectedChannel(explicitCapture.channels[0]!.name);
      }
    }
  }, [explicitCapture]);

  // Mount / remount uPlot when capture or reference lanes change
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !capture || capture.channels.length === 0) {
      controllerRef.current?.destroy();
      controllerRef.current = null;
      controllerHostRef.current = null;
      return;
    }

    let controller = controllerRef.current;
    if (!controller || controllerHostRef.current !== container) {
      controller?.destroy();
      controller = new ViewportController(container, { onUPlotInit });
      controllerRef.current = controller;
      controllerHostRef.current = container;
    } else {
      controller.setCallbacks({ onUPlotInit });
    }

    controller.syncCapture(capture, refLanes, sizeRef.current);
  }, [capture, refLanes, onUPlotInit, containerRef]);

  // Responsive resize
  useEffect(() => {
    controllerRef.current?.resize(width, height);
  }, [width, height]);

  // Channel visibility & selected-channel grid ownership
  useEffect(() => {
    controllerRef.current?.setVisibilityAndSelection(
      activeChannels,
      selectedChannel,
      refCapture,
    );
  }, [activeChannels, selectedChannel, capture, refCapture, refActiveChannels]);

  // Per-channel display transforms (Y-scale %, offset, invert)
  useEffect(() => {
    controllerRef.current?.applyDisplayTransforms(displayConfigs);
  }, [displayConfigs, capture]);

  // Theme, palette, and custom channel name updates
  useEffect(() => {
    controllerRef.current?.applyThemeOrNames(theme, keyConfigs, customNames);
  }, [theme, keyConfigs, customNames, capture]);

  // Quick-Stack Overlay <-> Stack layout transitions
  useEffect(() => {
    controllerRef.current?.applyStackLayout(stackMode, laneWeights);
  }, [
    stackMode,
    capture,
    refLanes,
    activeChannels,
    refActiveChannels,
    laneWeights,
  ]);

  // Reset View fit command channel
  useEffect(() => {
    if (fitRequest === lastFitRequestRef.current) return;
    lastFitRequestRef.current = fitRequest;
    controllerRef.current?.applyFit();
  }, [fitRequest, capture]);

  // Zoom-history snapshot restoration
  useEffect(() => {
    if (!restoreRequest || restoreRequest.token === lastRestoreRef.current) {
      return;
    }
    lastRestoreRef.current = restoreRequest.token;
    controllerRef.current?.restoreSnapshot(restoreRequest.target);
  }, [restoreRequest]);

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
        role="region"
        aria-label={`Oscilloscope waveform canvas. ${NAVIGATION_HELP_SUMMARY}`}
        title={NAVIGATION_HELP_SUMMARY}
        style={{
          backgroundColor: resolveThemePalette(theme).background,
        }}
      />
      <CursorRecoveryBadges capture={capture} />
      <CursorReadoutCard capture={capture} />
    </div>
  );
}
