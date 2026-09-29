/**
 * Shared readout card content model (issue #58): builds the cursor readout
 * rows once so the live DOM card (CursorReadoutCard.tsx) and the PNG
 * snapshot compositing pass (pngSnapshot.ts) render identical values.
 * Rows are plain data (text + color cells) with no DOM or canvas coupling.
 */

import { formatFrequency, formatTime } from "./siFormat";
import { formatReadoutChannelName } from "../../state/channelNamesStore";
import {
  formatChannelValue,
  getPhysicalChannelUnit,
  splitUnit,
} from "../../capture/channelUnits";
import type { ParsedCapture } from "../../types/capture";

export interface ReadoutSnapshotCell {
  text: string;
  color?: string;
  /** Emulated bold weight for badge/emphasis cells. */
  bold?: boolean;
  /** Right-aligns the cell against the panel's right padding. */
  alignRight?: boolean;
}

export interface ReadoutSnapshotRow {
  cells: ReadoutSnapshotCell[];
  /** Slightly indented continuation row (channel voltages). */
  indent?: boolean;
}

/** Full card descriptor consumed by the PNG compositing pass (issue #58). */
export interface ReadoutCardSnapshot {
  /** Card top-left corner in composite CSS-pixel coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  rows: ReadoutSnapshotRow[];
}

/** Color resolvers for a card render; callers theme them per export. */
export interface ReadoutRowColors {
  c1: string;
  c2: string;
  channel: (channelName: string) => string;
}

export interface ReadoutCursorSnapshotState {
  c1Active: boolean;
  c1SampleIndex: number;
  c2Active: boolean;
  c2SampleIndex: number;
}

function clampIndex(index: number, totalSamples: number): number {
  return Math.max(0, Math.min(index, totalSamples - 1));
}

/**
 * Builds the readout rows shown inside the card body for the given cursor
 * state: one header row per active cursor (badge, sample index, time),
 * the per-visible-channel value rows (each in its channel's base-SI unit),
 * one per-channel context row (verbatim file unit, per-division, window,
 * saturated count), and — when both cursors are active — the differential
 * Δt / 1/Δt / Δ<unit> rows.
 */
export function buildReadoutRows(
  capture: ParsedCapture,
  cursors: ReadoutCursorSnapshotState,
  activeChannels: readonly string[],
  xMin: number | null,
  xMax: number | null,
  colors: ReadoutRowColors,
  customNames?: Record<string, string>,
): ReadoutSnapshotRow[] {
  const { timestamps, channels } = capture;
  const totalSamples = timestamps.length;
  // No active cursors, no card — mirrors the DOM card's null render.
  if (totalSamples === 0 || (!cursors.c1Active && !cursors.c2Active)) {
    return [];
  }

  const effectiveXMin = xMin ?? timestamps[0] ?? 0;
  const effectiveXMax = xMax ?? timestamps[totalSamples - 1] ?? 1;
  const visibleChannels = channels
    .map((channel, index) => ({ channel, index }))
    .filter(({ channel }) => activeChannels.includes(channel.name));

  const rows: ReadoutSnapshotRow[] = [];

  const renderCursor = (
    id: "C1" | "C2",
    active: boolean,
    sampleIndex: number,
  ): void => {
    if (!active) return;
    const idx = clampIndex(sampleIndex, totalSamples);
    const time = timestamps[idx] ?? 0;
    const isOutOfView = time < effectiveXMin || time > effectiveXMax;
    const color = id === "C1" ? colors.c1 : colors.c2;
    rows.push({
      cells: [
        { text: id, color, bold: true },
        { text: `#${idx}`, color: "#999999" },
        {
          text: formatTime(time),
          color: isOutOfView ? undefined : "#FFFFFF",
          alignRight: true,
        },
      ],
    });
    for (const { channel, index } of visibleChannels) {
      const v = channel.data[idx] ?? 0;
      const unit = getPhysicalChannelUnit(capture, index);
      // Issue #143: no trailing colon after a renamed channel, mirroring
      // the live DOM card.
      const customName = customNames?.[channel.name];
      const displayName = formatReadoutChannelName(
        channel.name,
        channel.label,
        customName,
      );
      rows.push({
        cells: [
          {
            text: customName?.trim() ? displayName : `${displayName}:`,
            color: colors.channel(channel.name),
          },
          { text: formatChannelValue(v, unit), alignRight: true },
        ],
        indent: true,
      });
    }
  };

  renderCursor("C1", cursors.c1Active, cursors.c1SampleIndex);
  renderCursor("C2", cursors.c2Active, cursors.c2SampleIndex);

  if (cursors.c1Active && cursors.c2Active) {
    const i1 = clampIndex(cursors.c1SampleIndex, totalSamples);
    const i2 = clampIndex(cursors.c2SampleIndex, totalSamples);
    const t1 = timestamps[i1] ?? 0;
    const t2 = timestamps[i2] ?? 0;
    const deltaT = Math.abs(t2 - t1);
    const freq = deltaT > 0 ? 1 / deltaT : 0;
    rows.push({
      cells: [
        { text: "Δt:", color: "#999999" },
        { text: formatTime(deltaT), alignRight: true },
      ],
    });
    rows.push({
      cells: [
        { text: "1/Δt:", color: "#999999" },
        { text: formatFrequency(freq), alignRight: true },
      ],
    });
    for (const { channel, index } of visibleChannels) {
      const v1 = channel.data[i1] ?? 0;
      const v2 = channel.data[i2] ?? 0;
      const displayName = formatReadoutChannelName(
        channel.name,
        channel.label,
        customNames?.[channel.name],
      );
      const unit = getPhysicalChannelUnit(capture, index);
      const { base } = splitUnit(unit);
      rows.push({
        cells: [
          {
            text: `Δ${base}(${displayName}):`,
            color: colors.channel(channel.name),
          },
          { text: formatChannelValue(v2 - v1, unit), alignRight: true },
        ],
      });
    }
  }

  return rows;
}
