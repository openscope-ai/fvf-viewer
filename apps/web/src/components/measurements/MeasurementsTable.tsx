/**
 * Amplitude measurements table (issue #278):
 * Live docked panel rendering automatic amplitude statistics (Vpp, Vmax, Vmin, Mean, RMS)
 * for all visible channels over the active viewport time window.
 *
 * Fully reactive to:
 * - Viewport zoom/pan (xMin, xMax bounds)
 * - Reset View / Fit commands
 * - Channel visibility toggles
 * - Channel display transforms (gain/invert/offset)
 * - Compare mode reference channels
 */

import React, { useMemo } from "react";
import type { ParsedCapture } from "../../types/capture";
import { useMeasurementsStore } from "../../state/measurementsStore";
import { useViewportStore } from "../../state/viewportStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import {
  computeAllVisibleChannelStats,
  formatMetricValue,
} from "./amplitudeStats";

export interface MeasurementsTableProps {
  capture: ParsedCapture | null;
}

export default function MeasurementsTable({ capture }: MeasurementsTableProps) {
  const isOpen = useMeasurementsStore((state) => state.isOpen);
  const setOpen = useMeasurementsStore((state) => state.setOpen);

  const xMin = useViewportStore((state) => state.xMin);
  const xMax = useViewportStore((state) => state.xMax);
  const activeChannels = useViewportStore((state) => state.activeChannels);

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

  const stats = useMemo(() => {
    if (!isOpen || !capture) return [];
    return computeAllVisibleChannelStats(
      capture,
      xMin,
      xMax,
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
    xMin,
    xMax,
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

  if (!isOpen || !capture) return null;

  return (
    <div
      className="amplitude-measurements-panel"
      data-testid="amplitude-measurements-panel"
      role="region"
      aria-label="Automatic amplitude measurements"
    >
      <div className="amplitude-measurements-header">
        <div className="amplitude-measurements-title-group">
          <span className="amplitude-measurements-title">Measurements</span>
          <span className="amplitude-measurements-subtitle">
            (Visible Window)
          </span>
        </div>
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
    </div>
  );
}
