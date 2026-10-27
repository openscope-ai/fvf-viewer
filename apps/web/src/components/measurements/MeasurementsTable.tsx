/**
 * Measurements table (issues #278, #279, #280):
 * Live docked panel rendering:
 * 1. Automatic amplitude statistics (Vpp, Vmax, Vmin, Mean, RMS) for all visible channels
 *    over the active gating mode (Visible Window or Full Record).
 * 2. Automatic timing statistics (Period, Frequency, +PW, -PW, Duty Cycle, Rise, Fall)
 *    for the selected channel, gated between cursors C1 and C2 when active or falling back
 *    to the active gating mode.
 * 3. Running statistics view (Count, Min, Max, Mean, StdDev) accumulated across viewport
 *    and cursor changes with an explicit Clear Stats action.
 * 4. Gating mode toggle: Visible-window vs Full-record.
 *
 * Fully reactive to:
 * - Viewport zoom/pan (xMin, xMax bounds)
 * - Reset View / Fit commands
 * - Channel visibility toggles & selected channel switches
 * - C1 / C2 measurement cursor placement & toggles
 * - Channel display transforms (gain/invert/offset)
 * - Compare mode reference channels
 */

import React, { useMemo, useEffect } from "react";
import type { ParsedCapture } from "../../types/capture";
import { useMeasurementsStore } from "../../state/measurementsStore";
import { useViewportStore } from "../../state/viewportStore";
import { useCursorStore } from "../../state/cursorStore";
import {
  displayKeyForChannel,
  effectiveInverted,
  effectiveYScale,
  effectiveOffset,
} from "../canvas/channelDisplay";
import { effectiveTraceColor } from "../canvas/themePalette";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import {
  useChannelNamesStore,
  channelDisplayName,
} from "../../state/channelNamesStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import { formatTime, formatFrequency } from "../cursors/siFormat";
import {
  computeAllVisibleChannelStats,
  formatMetricValue,
} from "./amplitudeStats";
import {
  resolveTimingGateRange,
  computeTimingStats,
  formatTimingDuration,
  formatTimingFrequency,
  formatTimingDutyCycle,
  EMPTY_TIMING_STATS,
} from "./timingStats";

export interface MeasurementsTableProps {
  capture: ParsedCapture | null;
}

function formatStatNumber(
  val: number | null | undefined,
  unit: string,
): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "--";
  if (unit === "s") return formatTime(val);
  if (unit === "Hz") return formatFrequency(val);
  if (unit === "%") return `${val.toFixed(1)} %`;
  return formatMetricValue(val, unit);
}

export default function MeasurementsTable({ capture }: MeasurementsTableProps) {
  const isOpen = useMeasurementsStore((state) => state.isOpen);
  const setOpen = useMeasurementsStore((state) => state.setOpen);
  const gatingMode = useMeasurementsStore((state) => state.gatingMode);
  const setGatingMode = useMeasurementsStore((state) => state.setGatingMode);
  const showStats = useMeasurementsStore((state) => state.showStats);
  const toggleShowStats = useMeasurementsStore(
    (state) => state.toggleShowStats,
  );
  const accumulators = useMeasurementsStore((state) => state.accumulators);
  const accumulateBatch = useMeasurementsStore(
    (state) => state.accumulateBatch,
  );
  const clearStats = useMeasurementsStore((state) => state.clearStats);

  const xMin = useViewportStore((state) => state.xMin);
  const xMax = useViewportStore((state) => state.xMax);
  const activeChannels = useViewportStore((state) => state.activeChannels);
  const selectedChannel = useViewportStore((state) => state.selectedChannel);

  const c1Active = useCursorStore((state) => state.c1Active);
  const c2Active = useCursorStore((state) => state.c2Active);
  const c1SampleIndex = useCursorStore((state) => state.c1SampleIndex);
  const c2SampleIndex = useCursorStore((state) => state.c2SampleIndex);

  const displayConfigs = useChannelDisplayStore((state) => state.keyConfigs);
  const customNames = useChannelNamesStore((state) => state.names);

  const refCapture = useReferenceStore((state) => state.capture);
  const refLanes = useReferenceStore((state) => state.lanes);
  const refActiveChannels = useReferenceStore(
    (state) => state.refActiveChannels,
  );
  const timeSlipSamples = useReferenceStore((state) => state.timeSlipSamples);

  const theme = useThemeStore((state) => state.theme);
  const customColors = usePaletteStore((state) => state.customColors);

  // Effective bounds depending on Gating Mode (Issue #280: Visible-window vs Full-record)
  const effXMin = gatingMode === "full" ? null : xMin;
  const effXMax = gatingMode === "full" ? null : xMax;

  // Amplitude stats (all visible channels)
  const stats = useMemo(() => {
    if (!isOpen || !capture) return [];
    return computeAllVisibleChannelStats(
      capture,
      effXMin,
      effXMax,
      activeChannels,
      displayConfigs,
      customNames,
      refCapture,
      refLanes,
      refActiveChannels,
      timeSlipSamples,
      theme,
      customColors,
    );
  }, [
    isOpen,
    capture,
    effXMin,
    effXMax,
    activeChannels,
    displayConfigs,
    customNames,
    refCapture,
    refLanes,
    refActiveChannels,
    timeSlipSamples,
    theme,
    customColors,
  ]);

  // Timing stats gating range (Issue #279, #280)
  const {
    startIndex: tStart,
    endIndex: tEnd,
    isCursorGated,
  } = useMemo(() => {
    if (!capture || capture.timestamps.length === 0) {
      return { startIndex: 0, endIndex: -1, isCursorGated: false };
    }
    return resolveTimingGateRange(
      capture.timestamps,
      c1Active,
      c2Active,
      c1SampleIndex,
      c2SampleIndex,
      effXMin,
      effXMax,
    );
  }, [
    capture,
    c1Active,
    c2Active,
    c1SampleIndex,
    c2SampleIndex,
    effXMin,
    effXMax,
  ]);

  // Target channel for timing measurements (Issue #279: scoped to selected channel)
  const activeChannelName =
    selectedChannel ?? capture?.channels[0]?.name ?? "A";
  const targetChannel =
    capture?.channels.find((ch) => ch.name === activeChannelName) ??
    capture?.channels[0];
  const targetKey = targetChannel
    ? displayKeyForChannel(targetChannel.name)
    : null;
  const isTargetInverted = targetKey
    ? effectiveInverted(displayConfigs, targetKey)
    : false;
  const targetColor = targetChannel
    ? effectiveTraceColor(theme, customColors, targetChannel.name)
    : "#29b6f6";
  const targetDisplayName = targetChannel
    ? channelDisplayName(
        targetChannel.name,
        targetChannel.label,
        customNames?.[targetChannel.name],
      )
    : "A";

  const timingStats = useMemo(() => {
    if (!isOpen || !capture || !targetChannel || tEnd < tStart) {
      return EMPTY_TIMING_STATS;
    }
    return computeTimingStats(
      capture.timestamps,
      targetChannel.data,
      tStart,
      tEnd,
      isTargetInverted,
    );
  }, [isOpen, capture, targetChannel, tStart, tEnd, isTargetInverted]);

  // Accumulate running statistics across viewport/cursor/gating/transform changes (Issue #280 AC1, F-DEDUP-SCOPE-1, F-REF-SIG-1)
  useEffect(() => {
    if (!isOpen || !capture) return;
    const capId = capture.metadata?.timestamp14 ?? "capture";
    const refCapId = refCapture?.metadata?.timestamp14 ?? "no-ref";
    const refSlip = timeSlipSamples ?? 0;
    const items: Array<{
      key: string;
      value: number | null;
      signature: string;
      unit?: string;
    }> = [];

    for (const row of stats) {
      let ampSig: string;
      const isRef = row.channelKey.startsWith("Ref-");
      const isDerived = capture.derivedChannels.some(
        (d) => d.label === row.channelKey,
      );

      if (isDerived) {
        ampSig = `${capId}:${row.channelKey}:${gatingMode}:${effXMin}:${effXMax}:derived`;
      } else if (isRef) {
        const dispKey = displayKeyForChannel(row.channelKey);
        const inv = effectiveInverted(displayConfigs, dispKey);
        const scale = effectiveYScale(displayConfigs, dispKey);
        const off = effectiveOffset(displayConfigs, dispKey);
        ampSig = `${capId}:${refCapId}:${row.channelKey}:${gatingMode}:${effXMin}:${effXMax}:${refSlip}:${inv}:${scale}:${off}`;
      } else {
        const dispKey = displayKeyForChannel(row.channelKey);
        const inv = effectiveInverted(displayConfigs, dispKey);
        const scale = effectiveYScale(displayConfigs, dispKey);
        const off = effectiveOffset(displayConfigs, dispKey);
        ampSig = `${capId}:${row.channelKey}:${gatingMode}:${effXMin}:${effXMax}:${inv}:${scale}:${off}`;
      }

      items.push(
        {
          key: `${row.channelKey}-vpp`,
          value: row.vpp,
          signature: ampSig,
          unit: row.unit,
        },
        {
          key: `${row.channelKey}-vmax`,
          value: row.vmax,
          signature: ampSig,
          unit: row.unit,
        },
        {
          key: `${row.channelKey}-vmin`,
          value: row.vmin,
          signature: ampSig,
          unit: row.unit,
        },
        {
          key: `${row.channelKey}-mean`,
          value: row.mean,
          signature: ampSig,
          unit: row.unit,
        },
        {
          key: `${row.channelKey}-rms`,
          value: row.rms,
          signature: ampSig,
          unit: row.unit,
        },
      );
    }

    if (targetChannel && timingStats.period !== null) {
      const ch = targetChannel.name;
      const timingSig = `${capId}:${ch}:${gatingMode}:${effXMin}:${effXMax}:${c1Active}:${c2Active}:${c1SampleIndex}:${c2SampleIndex}:${isTargetInverted}`;
      items.push(
        {
          key: `${ch}-period`,
          value: timingStats.period,
          signature: timingSig,
          unit: "s",
        },
        {
          key: `${ch}-frequency`,
          value: timingStats.frequency,
          signature: timingSig,
          unit: "Hz",
        },
        {
          key: `${ch}-positive-width`,
          value: timingStats.positivePulseWidth,
          signature: timingSig,
          unit: "s",
        },
        {
          key: `${ch}-negative-width`,
          value: timingStats.negativePulseWidth,
          signature: timingSig,
          unit: "s",
        },
        {
          key: `${ch}-duty-cycle`,
          value: timingStats.dutyCycle,
          signature: timingSig,
          unit: "%",
        },
        {
          key: `${ch}-rise-time`,
          value: timingStats.riseTime,
          signature: timingSig,
          unit: "s",
        },
        {
          key: `${ch}-fall-time`,
          value: timingStats.fallTime,
          signature: timingSig,
          unit: "s",
        },
      );
    }

    accumulateBatch(items);
  }, [
    isOpen,
    capture,
    effXMin,
    effXMax,
    gatingMode,
    displayConfigs,
    refCapture,
    refLanes,
    timeSlipSamples,
    c1Active,
    c2Active,
    c1SampleIndex,
    c2SampleIndex,
    isTargetInverted,
    accumulateBatch,
    stats,
    targetChannel,
    timingStats,
  ]);

  if (!isOpen || !capture) return null;

  // Build row descriptors for statistics view (Issue #280)
  const statsRows: Array<{
    key: string;
    label: string;
    color?: string;
    unit: string;
  }> = [];

  for (const row of stats) {
    statsRows.push(
      {
        key: `${row.channelKey}-vpp`,
        label: `${row.displayName} Vpp`,
        color: row.color,
        unit: row.unit,
      },
      {
        key: `${row.channelKey}-vmax`,
        label: `${row.displayName} Vmax`,
        color: row.color,
        unit: row.unit,
      },
      {
        key: `${row.channelKey}-vmin`,
        label: `${row.displayName} Vmin`,
        color: row.color,
        unit: row.unit,
      },
      {
        key: `${row.channelKey}-mean`,
        label: `${row.displayName} Mean`,
        color: row.color,
        unit: row.unit,
      },
      {
        key: `${row.channelKey}-rms`,
        label: `${row.displayName} RMS`,
        color: row.color,
        unit: row.unit,
      },
    );
  }

  if (targetChannel) {
    const ch = targetChannel.name;
    statsRows.push(
      {
        key: `${ch}-period`,
        label: `${targetDisplayName} Period`,
        color: targetColor,
        unit: "s",
      },
      {
        key: `${ch}-frequency`,
        label: `${targetDisplayName} Frequency`,
        color: targetColor,
        unit: "Hz",
      },
      {
        key: `${ch}-positive-width`,
        label: `${targetDisplayName} +PW`,
        color: targetColor,
        unit: "s",
      },
      {
        key: `${ch}-negative-width`,
        label: `${targetDisplayName} -PW`,
        color: targetColor,
        unit: "s",
      },
      {
        key: `${ch}-duty-cycle`,
        label: `${targetDisplayName} Duty`,
        color: targetColor,
        unit: "%",
      },
      {
        key: `${ch}-rise-time`,
        label: `${targetDisplayName} Rise`,
        color: targetColor,
        unit: "s",
      },
      {
        key: `${ch}-fall-time`,
        label: `${targetDisplayName} Fall`,
        color: targetColor,
        unit: "s",
      },
    );
  }

  const timingGateBadgeText = isCursorGated
    ? "Gated: C1–C2"
    : gatingMode === "full"
      ? "Full Record"
      : "Visible Window";

  return (
    <div
      className="amplitude-measurements-panel"
      data-testid="amplitude-measurements-panel"
      role="region"
      aria-label="Automatic measurements"
    >
      <div className="amplitude-measurements-header">
        <div className="amplitude-measurements-title-group">
          <span className="amplitude-measurements-title">Measurements</span>
          <span
            className="amplitude-measurements-subtitle"
            data-testid="measurements-gating-label"
          >
            {gatingMode === "full" ? "(Full Record)" : "(Visible Window)"}
          </span>
        </div>
        <div className="amplitude-measurements-controls">
          {/* Gating mode toggle (Issue #280 AC3) */}
          <div
            className="measurements-pill-group"
            role="group"
            aria-label="Gating mode"
          >
            <button
              type="button"
              className={`measurements-pill-btn ${gatingMode === "visible" ? "active" : ""}`}
              data-testid="gating-mode-visible"
              onClick={() => setGatingMode("visible")}
              title="Gate measurements to visible window"
            >
              Window
            </button>
            <button
              type="button"
              className={`measurements-pill-btn ${gatingMode === "full" ? "active" : ""}`}
              data-testid="gating-mode-full"
              onClick={() => setGatingMode("full")}
              title="Gate measurements to full record"
            >
              Full
            </button>
          </div>

          {/* Statistics View toggle (Issue #280 AC1) */}
          <button
            type="button"
            className={`measurements-tool-btn ${showStats ? "active" : ""}`}
            data-testid="stats-toggle"
            onClick={toggleShowStats}
            title="Toggle running statistics view (Min, Max, Mean, StdDev, Count)"
          >
            Stats
          </button>

          {/* Clear Statistics button (Issue #280 AC2) */}
          <button
            type="button"
            className="measurements-tool-btn"
            data-testid="clear-stats-button"
            onClick={clearStats}
            title="Clear all accumulated running statistics"
          >
            Clear
          </button>

          <button
            type="button"
            className="amplitude-measurements-close"
            data-testid="measurements-close-button"
            aria-label="Close amplitude measurements table"
            title="Close measurements table"
            onClick={() => setOpen(false)}
          >
            &times;
          </button>
        </div>
      </div>

      {showStats ? (
        /* Running Statistics Table (Issue #280 AC1) */
        <div className="amplitude-measurements-table-wrapper">
          <table
            className="amplitude-measurements-table"
            data-testid="measurements-stats-table"
          >
            <thead>
              <tr>
                <th scope="col" className="col-channel">
                  Measurement
                </th>
                <th scope="col">Current</th>
                <th scope="col">Min</th>
                <th scope="col">Max</th>
                <th scope="col">Mean</th>
                <th scope="col">Std Dev</th>
                <th scope="col">Count</th>
              </tr>
            </thead>
            <tbody>
              {statsRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="amplitude-measurements-empty">
                    No active measurements
                  </td>
                </tr>
              ) : (
                statsRows.map((item) => {
                  const acc = accumulators[item.key];
                  return (
                    <tr
                      key={item.key}
                      data-testid={`stats-row-${item.key.toLowerCase()}`}
                    >
                      <th scope="row" className="col-channel">
                        {item.color && (
                          <span
                            className="channel-swatch"
                            style={{ backgroundColor: item.color }}
                            aria-hidden="true"
                          />
                        )}
                        <span className="channel-name">{item.label}</span>
                      </th>
                      <td
                        data-testid={`stats-current-${item.key.toLowerCase()}`}
                      >
                        {formatStatNumber(acc?.current, item.unit)}
                      </td>
                      <td data-testid={`stats-min-${item.key.toLowerCase()}`}>
                        {formatStatNumber(acc?.min, item.unit)}
                      </td>
                      <td data-testid={`stats-max-${item.key.toLowerCase()}`}>
                        {formatStatNumber(acc?.max, item.unit)}
                      </td>
                      <td data-testid={`stats-mean-${item.key.toLowerCase()}`}>
                        {formatStatNumber(acc?.mean, item.unit)}
                      </td>
                      <td
                        data-testid={`stats-stddev-${item.key.toLowerCase()}`}
                      >
                        {formatStatNumber(acc?.stdDev, item.unit)}
                      </td>
                      <td data-testid={`stats-count-${item.key.toLowerCase()}`}>
                        {acc?.count ?? 0}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* Instantaneous Measurements Table (Default View) */
        <>
          <div className="amplitude-measurements-table-wrapper">
            <table
              className="amplitude-measurements-table"
              data-testid="amplitude-measurements-table"
            >
              <thead>
                <tr>
                  <th scope="col" className="col-channel">
                    Channel
                  </th>
                  <th scope="col">Vpp</th>
                  <th scope="col">Vmax</th>
                  <th scope="col">Vmin</th>
                  <th scope="col">Mean</th>
                  <th scope="col">RMS</th>
                </tr>
              </thead>
              <tbody>
                {stats.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="amplitude-measurements-empty">
                      No visible channels
                    </td>
                  </tr>
                ) : (
                  stats.map((row) => (
                    <tr
                      key={row.channelKey}
                      data-testid={`measurement-row-${row.channelKey.toLowerCase()}`}
                    >
                      <th scope="row" className="col-channel">
                        <span
                          className="channel-swatch"
                          style={{ backgroundColor: row.color }}
                          aria-hidden="true"
                        />
                        <span className="channel-name">{row.displayName}</span>
                      </th>
                      <td
                        data-testid={`measurement-vpp-${row.channelKey.toLowerCase()}`}
                      >
                        {formatMetricValue(row.vpp, row.unit)}
                      </td>
                      <td
                        data-testid={`measurement-vmax-${row.channelKey.toLowerCase()}`}
                      >
                        {formatMetricValue(row.vmax, row.unit)}
                      </td>
                      <td
                        data-testid={`measurement-vmin-${row.channelKey.toLowerCase()}`}
                      >
                        {formatMetricValue(row.vmin, row.unit)}
                      </td>
                      <td
                        data-testid={`measurement-mean-${row.channelKey.toLowerCase()}`}
                      >
                        {formatMetricValue(row.mean, row.unit)}
                      </td>
                      <td
                        data-testid={`measurement-rms-${row.channelKey.toLowerCase()}`}
                      >
                        {formatMetricValue(row.rms, row.unit)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Automatic Timing Measurements Section (Issue #279) */}
          <div
            className="timing-measurements-section"
            data-testid="timing-measurements-section"
          >
            <div className="timing-measurements-header">
              <div className="timing-measurements-title-group">
                <span className="timing-measurements-title">Timing</span>
                {targetChannel && (
                  <span className="timing-measurements-channel">
                    <span
                      className="channel-swatch"
                      style={{ backgroundColor: targetColor }}
                      aria-hidden="true"
                    />
                    <span>{targetDisplayName}</span>
                  </span>
                )}
              </div>
              <span
                className="timing-gate-badge"
                data-testid="timing-gate-mode"
              >
                {timingGateBadgeText}
              </span>
            </div>
            <div className="timing-grid">
              <div className="timing-card">
                <span className="timing-label">Period</span>
                <span className="timing-value" data-testid="timing-period">
                  {formatTimingDuration(timingStats.period)}
                </span>
              </div>
              <div className="timing-card">
                <span className="timing-label">Frequency</span>
                <span className="timing-value" data-testid="timing-frequency">
                  {formatTimingFrequency(timingStats.frequency)}
                </span>
              </div>
              <div className="timing-card">
                <span className="timing-label">+Pulse Width</span>
                <span
                  className="timing-value"
                  data-testid="timing-positive-width"
                >
                  {formatTimingDuration(timingStats.positivePulseWidth)}
                </span>
              </div>
              <div className="timing-card">
                <span className="timing-label">-Pulse Width</span>
                <span
                  className="timing-value"
                  data-testid="timing-negative-width"
                >
                  {formatTimingDuration(timingStats.negativePulseWidth)}
                </span>
              </div>
              <div className="timing-card">
                <span className="timing-label">Duty Cycle</span>
                <span className="timing-value" data-testid="timing-duty-cycle">
                  {formatTimingDutyCycle(timingStats.dutyCycle)}
                </span>
              </div>
              <div className="timing-card">
                <span className="timing-label">Rise (10-90%)</span>
                <span className="timing-value" data-testid="timing-rise-time">
                  {formatTimingDuration(timingStats.riseTime)}
                </span>
              </div>
              <div className="timing-card">
                <span className="timing-label">Fall (90-10%)</span>
                <span className="timing-value" data-testid="timing-fall-time">
                  {formatTimingDuration(timingStats.fallTime)}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
