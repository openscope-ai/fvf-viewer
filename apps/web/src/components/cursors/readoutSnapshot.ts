/**
 * Shared readout card content model (issue #58): builds the cursor readout
 * rows once so the live DOM card (CursorReadoutCard.tsx) and the PNG
 * snapshot compositing pass (pngSnapshot.ts) render identical values.
 * Rows are plain data (text + color cells) with no DOM or canvas coupling.
 */

import { formatReadoutChannelName } from "../../state/channelNamesStore";
import {
  formatVoltageWithUnit,
  formatFrequencyWithUnit,
  formatTimeWithUnit,
} from "./displayUnits";
import type {
  CursorBinding,
  FrequencyUnit,
  TimeUnit,
  VoltageUnit,
} from "../../state/cursorDisplayStore";
import { getPhysicalChannelUnit, splitUnit } from "../../capture/channelUnits";
import type { ParsedCapture } from "../../types/capture";
import { invertSign } from "../canvas/channelDisplay";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";

/** Display-unit selections for one card render (issue #226). */
export interface ReadoutDisplayUnits {
  time: TimeUnit;
  frequency: FrequencyUnit;
  voltage: VoltageUnit;
}

export const AUTO_DISPLAY_UNITS: ReadoutDisplayUnits = {
  time: "auto",
  frequency: "auto",
  voltage: "auto",
};

/** Issue #225 cursor measurement semantics for one card render. */
export interface ReadoutCursorSemantics {
  c1Binding: CursorBinding;
  c2Binding: CursorBinding;
  deltaLocked: boolean;
}

export const UNBOUND_CURSOR_SEMANTICS: ReadoutCursorSemantics = {
  c1Binding: "all",
  c2Binding: "all",
  deltaLocked: false,
};

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
  units: ReadoutDisplayUnits = AUTO_DISPLAY_UNITS,
  semantics: ReadoutCursorSemantics = UNBOUND_CURSOR_SEMANTICS,
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

  // Issue #225: bound cursors filter to their bound channel; a hidden
  // bound channel falls back to all visible channels plus a hint row.
  const boundList = (
    binding: CursorBinding,
  ): { list: typeof visibleChannels; fallback: boolean } => {
    if (binding === "all") return { list: visibleChannels, fallback: false };
    const bound = visibleChannels.filter(
      ({ channel }) => channel.name === binding,
    );
    if (bound.length > 0) return { list: bound, fallback: false };
    return { list: visibleChannels, fallback: true };
  };
  const c1Channels = boundList(semantics.c1Binding);
  const c2Channels = boundList(semantics.c2Binding);

  const rows: ReadoutSnapshotRow[] = [];
  // Issue #224: invert ± flips the embedded card's readouts exactly like
  // the live card (scale/offset never alter them).
  const displayConfigs = useChannelDisplayStore.getState().keyConfigs;

  const renderCursor = (
    id: "C1" | "C2",
    active: boolean,
    sampleIndex: number,
    channelList: { list: typeof visibleChannels; fallback: boolean },
    binding: CursorBinding,
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
          text: formatTimeWithUnit(time, units.time),
          color: isOutOfView ? undefined : "#FFFFFF",
          alignRight: true,
        },
      ],
    });
    for (const { channel, index } of channelList.list) {
      // Issue #224: invert ± flips the embedded card's readouts exactly
      // like the live card (scale/offset never alter them).
      const v =
        (channel.data[idx] ?? 0) * invertSign(displayConfigs, channel.name);
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
          {
            text: formatVoltageWithUnit(v, unit, units.voltage),
            alignRight: true,
          },
        ],
        indent: true,
      });
    }
    if (channelList.fallback) {
      rows.push({
        cells: [
          {
            text: `${binding} hidden — showing all visible channels`,
            color: "#8a8a8a",
          },
        ],
        indent: true,
      });
    }
  };

  renderCursor(
    "C1",
    cursors.c1Active,
    cursors.c1SampleIndex,
    c1Channels,
    semantics.c1Binding,
  );
  renderCursor(
    "C2",
    cursors.c2Active,
    cursors.c2SampleIndex,
    c2Channels,
    semantics.c2Binding,
  );

  if (cursors.c1Active && cursors.c2Active) {
    const i1 = clampIndex(cursors.c1SampleIndex, totalSamples);
    const i2 = clampIndex(cursors.c2SampleIndex, totalSamples);
    const t1 = timestamps[i1] ?? 0;
    const t2 = timestamps[i2] ?? 0;
    const deltaT = Math.abs(t2 - t1);
    const freq = deltaT > 0 ? 1 / deltaT : 0;
    rows.push({
      cells: [
        {
          text: semantics.deltaLocked ? "Δt (locked):" : "Δt:",
          color: "#999999",
        },
        { text: formatTimeWithUnit(deltaT, units.time), alignRight: true },
      ],
    });
    rows.push({
      cells: [
        { text: "1/Δt:", color: "#999999" },
        {
          text: formatFrequencyWithUnit(freq, units.frequency),
          alignRight: true,
        },
      ],
    });
    for (const { channel, index } of c1Channels.list.filter(({ channel }) =>
      c2Channels.list.some((entry) => entry.channel.name === channel.name),
    )) {
      // Issue #224: one sign factor flips the differential consistently.
      const sign = invertSign(displayConfigs, channel.name);
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
          {
            text: formatVoltageWithUnit((v2 - v1) * sign, unit, units.voltage),
            alignRight: true,
          },
        ],
      });
    }
  }

  return rows;
}
