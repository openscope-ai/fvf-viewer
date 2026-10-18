/**
 * Find edge, peak, and saturation navigation controls (Issue #288).
 *
 * M3 compact navigation chip providing:
 * - Next / Previous jump-to navigation for rising edge, falling edge, peak, valley,
 *   and saturated (overload) samples on the active channel.
 * - Viewport auto-centering and optional cursor C1 relocation.
 * - Non-mutating feedback notification when no further feature is found.
 * - Client-side only calculation with zero data egress (ADR 0006).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import { useCaptureStore } from "../../state/captureStore";
import { useViewportStore } from "../../state/viewportStore";
import { useCursorStore } from "../../state/cursorStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import { findNearestSampleIndex } from "../cursors/cursorPlugin";
import { findFeature, type FeatureType } from "./featureSearch";

const FEATURE_LABELS: Record<FeatureType, string> = {
  rising: "rising edge",
  falling: "falling edge",
  peak: "peak",
  valley: "valley",
  saturation: "saturated sample",
};

export const FindNavControls: React.FC = () => {
  const capture = useCaptureStore((state) => state.capture);
  const selectedChannel = useViewportStore((state) => state.selectedChannel);
  const activeChannels = useViewportStore((state) => state.activeChannels);
  const xMin = useViewportStore((state) => state.xMin);
  const xMax = useViewportStore((state) => state.xMax);
  const c1Active = useCursorStore((state) => state.c1Active);
  const c1SampleIndex = useCursorStore((state) => state.c1SampleIndex);
  const setCursorSample = useCursorStore((state) => state.setCursorSample);
  const customNames = useChannelNamesStore((state) => state.names);

  const [feature, setFeature] = useState<FeatureType>("rising");
  const [status, setStatus] = useState<string | null>(null);
  const statusTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current !== null) {
        window.clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  const showStatus = useCallback((message: string) => {
    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current);
    }
    setStatus(message);
    statusTimerRef.current = window.setTimeout(() => {
      setStatus(null);
      statusTimerRef.current = null;
    }, 2500);
  }, []);

  // Determine active channel: selected channel or first active channel
  const effectiveChannel =
    capture?.channels.find(
      (c) =>
        (selectedChannel ? c.name === selectedChannel : true) &&
        activeChannels.includes(c.name),
    ) ?? capture?.channels[0];

  const effectiveChannelName = effectiveChannel?.name ?? selectedChannel ?? "A";
  const channelDisplayLabel =
    customNames[effectiveChannelName] ?? effectiveChannelName;

  const handleNavigate = useCallback(
    (direction: "next" | "prev") => {
      if (!capture || capture.timestamps.length === 0) return;

      const timestamps = capture.timestamps;
      const totalSamples = timestamps.length;
      const t0 = timestamps[0]!;
      const tEnd = timestamps[totalSamples - 1]!;

      // Find channel samples array
      const channel = effectiveChannel;
      if (!channel) {
        showStatus(`Channel ${channelDisplayLabel} not found`);
        return;
      }

      // Determine starting index
      let startIndex: number;
      if (c1Active) {
        startIndex = c1SampleIndex;
      } else {
        const curMin = xMin ?? t0;
        const curMax = xMax ?? tEnd;
        const centerTime = (curMin + curMax) / 2;
        startIndex = findNearestSampleIndex(timestamps, centerTime);
      }

      const result = findFeature(
        timestamps,
        channel.data,
        startIndex,
        direction,
        feature,
      );

      if (!result) {
        showStatus(`No further ${FEATURE_LABELS[feature]} found`);
        return;
      }

      // Feature found: center viewport on feature timestamp
      const container = document.querySelector(".oscilloscope-container");
      const uplotInstance = (
        container as (HTMLElement & { __uplot?: uPlot }) | null
      )?.__uplot;

      const curSpan = (xMax ?? tEnd) - (xMin ?? t0);
      let newMin = result.timestamp - curSpan / 2;
      let newMax = result.timestamp + curSpan / 2;

      // Clamp to capture bounds
      if (newMin < t0) {
        newMin = t0;
        newMax = Math.min(tEnd, t0 + curSpan);
      } else if (newMax > tEnd) {
        newMax = tEnd;
        newMin = Math.max(t0, tEnd - curSpan);
      }

      if (uplotInstance) {
        uplotInstance.setScale("x", { min: newMin, max: newMax });
      }
      useViewportStore.getState().setBounds({ xMin: newMin, xMax: newMax });

      // Relocate cursor C1 if active
      if (c1Active) {
        setCursorSample("C1", result.index, totalSamples);
      }

      showStatus(`Found sample ${result.index}`);
    },
    [
      capture,
      effectiveChannel,
      channelDisplayLabel,
      c1Active,
      c1SampleIndex,
      xMin,
      xMax,
      feature,
      setCursorSample,
      showStatus,
    ],
  );

  const hasCapture = capture != null && capture.channels.length > 0;

  return (
    <div
      className="waveform-find-nav"
      role="group"
      aria-label="Waveform feature search navigation"
      data-testid="waveform-find-nav"
    >
      <span className="waveform-find-label">Find:</span>
      <div className="waveform-find-chip">
        <button
          type="button"
          className="waveform-find-btn waveform-find-btn--prev"
          aria-label={`Find previous ${FEATURE_LABELS[feature]} on channel ${channelDisplayLabel}`}
          title={`Find previous ${FEATURE_LABELS[feature]}`}
          onClick={() => handleNavigate("prev")}
          disabled={!hasCapture}
          data-testid="find-prev-btn"
        >
          ◀
        </button>
        <select
          className="waveform-find-select"
          aria-label="Feature type to find"
          value={feature}
          onChange={(e) => setFeature(e.target.value as FeatureType)}
          disabled={!hasCapture}
          data-testid="find-feature-select"
        >
          <option value="rising">Rising Edge</option>
          <option value="falling">Falling Edge</option>
          <option value="peak">Peak</option>
          <option value="valley">Valley</option>
          <option value="saturation">Saturated (NaN)</option>
        </select>
        <button
          type="button"
          className="waveform-find-btn waveform-find-btn--next"
          aria-label={`Find next ${FEATURE_LABELS[feature]} on channel ${channelDisplayLabel}`}
          title={`Find next ${FEATURE_LABELS[feature]}`}
          onClick={() => handleNavigate("next")}
          disabled={!hasCapture}
          data-testid="find-next-btn"
        >
          ▶
        </button>
      </div>
      {status && (
        <span
          className="waveform-find-status"
          role="status"
          aria-live="polite"
          data-testid="find-status-message"
        >
          {status}
        </span>
      )}
    </div>
  );
};
