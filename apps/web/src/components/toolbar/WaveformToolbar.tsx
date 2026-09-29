/**
 * Waveform toolbar (issue #12): interactive channel badges that toggle trace
 * visibility on the oscilloscope canvas without rescaling the axes, plus a
 * one-click "Fit Waveform (100%)" action that resets the viewport to the
 * full capture range with optimal dynamic Y margins over the visible
 * channels. Mouse wheel zooming is disabled on the canvas itself (see
 * Oscilloscope); this toolbar is the sanctioned way to drive the viewport.
 */

import { useCallback, useRef, useState } from "react";
import { useCaptureStore } from "../../state/captureStore";
import {
  CHANNEL_NAME_MAX_LENGTH,
  useChannelNamesStore,
} from "../../state/channelNamesStore";
import { useCursorStore } from "../../state/cursorStore";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useViewportStore, type ChannelTag } from "../../state/viewportStore";
import {
  effectiveColorForKey,
  effectiveTraceColor,
  type PaletteKey,
} from "../canvas/themePalette";
import PaletteSettings from "./PaletteSettings";
import CsvExportButton from "../export/CsvExportButton";
import PngSnapshotButton from "../export/PngSnapshotButton";
import { CURSOR_MOVEMENT_SUMMARY } from "../cursors/cursorHelp";

export interface WaveformToolbarProps {
  /**
   * Explicit channel name list override; defaults to the parsed capture's
   * channel names from the capture store.
   */
  channels?: string[];
  /** Optional extra callback invoked when Fit Waveform is clicked. */
  onFit?: () => void;
  className?: string;
}

export default function WaveformToolbar({
  channels: channelsOverride,
  onFit,
  className,
}: WaveformToolbarProps) {
  const captureChannels = useCaptureStore((state) => state.capture?.channels);
  const activeChannels = useViewportStore((state) => state.activeChannels);
  const selectedChannel = useViewportStore((state) => state.selectedChannel);
  const cycleChannelBadge = useViewportStore(
    (state) => state.cycleChannelBadge,
  );
  const resetBounds = useViewportStore((state) => state.resetBounds);
  const requestFit = useViewportStore((state) => state.requestFit);

  const c1Active = useCursorStore((state) => state.c1Active);
  const c2Active = useCursorStore((state) => state.c2Active);
  const selectedCursor = useCursorStore((state) => state.selectedCursor);
  const toggleCursor = useCursorStore((state) => state.toggleCursor);
  const selectCursor = useCursorStore((state) => state.selectCursor);
  const totalSamples = useCaptureStore(
    (state) => state.capture?.timestamps.length ?? 0,
  );

  // Issues #38/#40: theme toggle + user-configurable palette; badges mirror
  // the effective colors too
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const customColors = usePaletteStore((state) => state.customColors);

  const channelNames =
    channelsOverride ?? captureChannels?.map((channel) => channel.name) ?? [];
  // Issue #64: per-file custom channel amendments + inline badge editing.
  const customNames = useChannelNamesStore((state) => state.names);
  const setName = useChannelNamesStore((state) => state.setName);
  const [editingChannel, setEditingChannel] = useState<string | null>(null);
  const draftRef = useRef<string>("");
  const cancelledRef = useRef(false);
  const preDoubleClickRef = useRef<{
    channel: string;
    activeChannels: ChannelTag[];
    selectedChannel: ChannelTag | null;
    timestamp: number;
  } | null>(null);

  const handleFit = useCallback(() => {
    onFit?.();
    // Reset the mirrored bounds; the canvas applies the real fit bounds in
    // response to the fit request and re-syncs them through its scale hooks.
    resetBounds();
    requestFit();
  }, [onFit, resetBounds, requestFit]);

  return (
    <div
      className={`waveform-toolbar ${className ?? ""}`.trim()}
      role="toolbar"
      aria-label="Waveform controls"
      data-testid="waveform-toolbar"
    >
      <div className="waveform-toolbar-channels">
        <span className="waveform-toolbar-label">Channels</span>
        {channelNames.map((name) => {
          const active = activeChannels.includes(name);
          const selected = active && selectedChannel === name;
          const color = effectiveTraceColor(theme, customColors, name);
          const custom = customNames[name];
          const displayLabel = custom ? `${name}: ${custom}` : name;
          const editing = editingChannel === name;

          const commitEdit = () => {
            // Escape cancels: the editor unmount fires a trailing blur,
            // which must not persist the abandoned draft.
            if (cancelledRef.current) {
              cancelledRef.current = false;
              setEditingChannel(null);
              return;
            }
            setName(name, draftRef.current);
            setEditingChannel(null);
          };

          if (editing) {
            return (
              <span
                key={name}
                className="waveform-channel-badge waveform-channel-badge--editing"
                data-testid={`channel-badge-edit-${name}`}
              >
                <span className="waveform-channel-badge-prefix">{name}: </span>
                <input
                  type="text"
                  autoFocus
                  maxLength={CHANNEL_NAME_MAX_LENGTH}
                  size={Math.max(6, CHANNEL_NAME_MAX_LENGTH - 8)}
                  defaultValue={custom ?? ""}
                  aria-label={`Custom name for channel ${name}`}
                  data-testid={`channel-name-input-${name}`}
                  onChange={(event) => {
                    draftRef.current = event.target.value;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitEdit();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      cancelledRef.current = true;
                      setEditingChannel(null);
                    }
                    // Isolate keys so app-level handlers never fire.
                    event.stopPropagation();
                  }}
                  onBlur={commitEdit}
                />
              </span>
            );
          }

          return (
            <button
              key={name}
              type="button"
              className={`waveform-channel-badge${
                active ? " waveform-channel-badge--active" : ""
              }${selected ? " waveform-channel-badge--selected" : ""}`}
              // Issue #75/#119: explicit empty object (never undefined) so React
              // diffs away the active inline styles on deactivation.
              style={
                active
                  ? {
                      borderColor: color,
                      color: selected ? "#ffffff" : color,
                      backgroundColor: selected ? `${color}33` : "transparent",
                      boxShadow: selected
                        ? `0 0 8px ${color}`
                        : `0 0 6px ${color}55`,
                    }
                  : {}
              }
              aria-pressed={active}
              aria-label={`Toggle channel ${displayLabel} visibility (double-click to rename)`}
              title={`Toggle channel ${displayLabel} visibility (double-click to rename)`}
              data-testid={`channel-badge-${name}`}
              onClick={() => {
                const now = Date.now();
                if (
                  !preDoubleClickRef.current ||
                  preDoubleClickRef.current.channel !== name ||
                  now - preDoubleClickRef.current.timestamp > 400
                ) {
                  preDoubleClickRef.current = {
                    channel: name,
                    activeChannels: [
                      ...useViewportStore.getState().activeChannels,
                    ],
                    selectedChannel:
                      useViewportStore.getState().selectedChannel,
                    timestamp: now,
                  };
                }
                cycleChannelBadge(name);
              }}
              onDoubleClick={() => {
                // Restore the pre-double-click state so the 2 rapid clicks don't mutate state
                if (
                  preDoubleClickRef.current &&
                  preDoubleClickRef.current.channel === name
                ) {
                  useViewportStore.setState({
                    activeChannels: preDoubleClickRef.current.activeChannels,
                    selectedChannel: preDoubleClickRef.current.selectedChannel,
                  });
                  preDoubleClickRef.current = null;
                }
                draftRef.current = custom ?? "";
                cancelledRef.current = false;
                setEditingChannel(name);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  draftRef.current = custom ?? "";
                  cancelledRef.current = false;
                  setEditingChannel(name);
                }
              }}
            >
              {displayLabel}
            </button>
          );
        })}
      </div>
      <div
        className="waveform-toolbar-cursors"
        data-testid="waveform-toolbar-cursors"
      >
        <span className="waveform-toolbar-label">Cursors</span>
        {(["C1", "C2"] as const).map((id) => {
          const active = id === "C1" ? c1Active : c2Active;
          const selected = selectedCursor === id;
          const color = effectiveColorForKey(
            theme,
            customColors,
            id as PaletteKey,
          );

          const handleClick = () => {
            if (!active) {
              toggleCursor(id, totalSamples);
            } else if (!selected) {
              selectCursor(id);
            } else {
              toggleCursor(id, totalSamples);
            }
          };

          return (
            <button
              key={id}
              type="button"
              className={`waveform-cursor-badge${
                active ? " waveform-cursor-badge--active" : ""
              }${selected ? " waveform-cursor-badge--selected" : ""}`}
              // Issue #75: explicit empty object (see channel badge note).
              style={
                active
                  ? {
                      borderColor: color,
                      color: selected ? "#ffffff" : color,
                      backgroundColor: selected ? `${color}33` : "transparent",
                      boxShadow: selected
                        ? `0 0 8px ${color}`
                        : `0 0 4px ${color}44`,
                    }
                  : {}
              }
              aria-pressed={active}
              aria-label={`Toggle cursor ${id} (currently ${active ? "active" : "inactive"}${
                selected ? ", selected" : ""
              })`}
              title={`Toggle cursor ${id}${selected ? " (selected)" : ""}\nControls: ${CURSOR_MOVEMENT_SUMMARY}`}
              data-testid={`cursor-toggle-${id.toLowerCase()}`}
              onClick={handleClick}
            >
              {id}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="waveform-fit-button"
        aria-label="Fit Waveform (100%): reset viewport to full capture"
        title="Fit Waveform (100%): reset viewport to full capture"
        data-testid="fit-waveform-button"
        onClick={handleFit}
      >
        Fit Waveform (100%)
      </button>
      <button
        type="button"
        className="waveform-theme-button"
        aria-label={`Toggle viewport theme (currently ${theme})`}
        title={`Toggle viewport theme (currently ${theme})`}
        data-testid="theme-toggle-button"
        onClick={toggleTheme}
      >
        {theme === "dark" ? "Light Theme" : "Dark Theme"}
      </button>
      <CsvExportButton />
      <PngSnapshotButton />
      <PaletteSettings />
    </div>
  );
}
