/**
 * Waveform toolbar (issues #12/#204): interactive channel badges that
 * toggle trace visibility on the oscilloscope canvas without rescaling
 * the axes, plus a one-click "Reset View" action (issue #248) that
 * returns to the pristine view: every channel's display transforms
 * (Y-scale %, vertical offset, invert) snap back to their defaults and
 * the viewport re-frames to the full capture range with optimal dynamic
 * Y margins over the visible channels, with the File 2 time slip zeroed
 * while a comparison is active. Mouse wheel zooming is disabled on the canvas
 * itself (see Oscilloscope); this toolbar is the sanctioned way to drive
 * the viewport.
 *
 * Issue #204: each channel (A–D) and cursor (C1/C2) badge is a compound
 * "Tonal Capsule" group — a primary body (~80%) keeping the existing
 * toggle/select/hide cycle and double-click rename, plus a secondary gear
 * (~20%) opening the per-key configuration popover (color + trace
 * opacity). Identity comes from a tonal fill mixed from the effective
 * color, not border color. The standalone PaletteSettings panel is
 * retired; its curated colors live on inside the popover.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useCaptureStore } from "../../state/captureStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
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
  paletteKeyForChannel,
  type PaletteKey,
} from "../canvas/themePalette";
import CsvExportButton from "../export/CsvExportButton";
import PngSnapshotButton from "../export/PngSnapshotButton";
import { CURSOR_MOVEMENT_SUMMARY } from "../cursors/cursorHelp";
import {
  AnchoredPopover,
  useBadgePopoverStore,
} from "./badgeConfig/anchoredPopover";
import { BadgeConfigPopover } from "./badgeConfig/BadgeConfigPopover";
import { GearIcon } from "./badgeConfig/icons";

export interface WaveformToolbarProps {
  /**
   * Explicit channel name list override; defaults to the parsed capture's
   * channel names from the capture store.
   */
  channels?: string[];
  /** Optional extra callback invoked when Reset View is clicked. */
  onResetView?: () => void;
  className?: string;
}

export default function WaveformToolbar({
  channels: channelsOverride,
  onResetView,
  className,
}: WaveformToolbarProps) {
  const captureChannels = useCaptureStore((state) => state.capture?.channels);
  // Issue #96: File 2 reference channels render as Ref-A… badges with
  // independent visibility and the full #204/#224 popover surface. The
  // selector must return a stable reference (the capture object), with
  // the name list memoized — a fresh array per notification would loop
  // useSyncExternalStore re-renders.
  const refCapture = useReferenceStore((state) => state.capture);
  const refChannels = useMemo(
    () =>
      refCapture
        ? refCapture.channels.map(
            (c) => `Ref-${c.name.replace(/^Input\s+/i, "")}`,
          )
        : [],
    [refCapture],
  );
  const refActiveChannels = useReferenceStore(
    (state) => state.refActiveChannels,
  );
  const toggleRefChannel = useReferenceStore((state) => state.toggleRefChannel);
  const refChannelGearRefs = useRef(new Map<string, HTMLButtonElement>());
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

  // Issue #204: single-open anchored configuration popovers
  const openKey = useBadgePopoverStore((state) => state.openKey);
  const setOpenKey = useBadgePopoverStore((state) => state.setOpen);
  const channelGearRefs = useRef(new Map<string, HTMLButtonElement>());
  const cursorGearRefs = useRef(new Map<string, HTMLButtonElement>());

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

  // Issue #98: 1-click Overlay/Stack lane partitioning.
  const stackMode = useChannelDisplayStore((state) => state.stackMode);
  const setStackMode = useChannelDisplayStore((state) => state.setStackMode);

  const resetTransforms = useChannelDisplayStore(
    (state) => state.resetTransforms,
  );

  const handleResetView = useCallback(() => {
    onResetView?.();
    // Issue #248: every channel's display transforms (Y-scale %, vertical
    // offset, invert — visible and hidden, primary and reference) snap
    // back to defaults. Solo and the Stack/Overlay mode are view layout,
    // not transforms — untouched.
    resetTransforms();
    // Zero the File 2 time slip while a comparison is active; the T₂
    // glyph and reference lanes reposition through the existing #97
    // reference-lane update pipeline.
    if (useReferenceStore.getState().capture) {
      useReferenceStore.getState().setTimeSlip(0);
    }
    // Reset the mirrored bounds; the canvas applies the real fit bounds in
    // response to the fit request and re-syncs them through its scale hooks.
    resetBounds();
    requestFit();
  }, [onResetView, resetTransforms, resetBounds, requestFit]);

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
          const paletteKey = paletteKeyForChannel(name);
          const popoverKey = `channel:${name}`;
          const popoverOpen = openKey === popoverKey;

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

          // Non-palette channels (e.g. derived labels) keep a plain
          // toggle capsule: there is no per-key config to gear into.
          if (!paletteKey) {
            return (
              <button
                key={name}
                type="button"
                className="waveform-channel-badge waveform-channel-badge--plain"
                aria-pressed={active}
                aria-label={`Toggle channel ${displayLabel} visibility (double-click to rename)`}
                title={`Toggle channel ${displayLabel} visibility (double-click to rename)`}
                data-testid={`channel-badge-${name}`}
                onClick={() => cycleChannelBadge(name)}
              >
                {displayLabel}
              </button>
            );
          }

          return (
            <span
              key={name}
              className={`waveform-channel-badge${
                active ? " waveform-channel-badge--active" : ""
              }${selected ? " waveform-channel-badge--selected" : ""}${
                popoverOpen ? " waveform-channel-badge--open" : ""
              }`}
              role="group"
              aria-label={`Channel ${name}`}
              data-testid={`channel-badge-group-${name}`}
              style={{ "--badge-color": color } as React.CSSProperties}
            >
              <button
                type="button"
                className="waveform-channel-badge-body"
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
                      selectedChannel:
                        preDoubleClickRef.current.selectedChannel,
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
              <span className="badge-split-divider" aria-hidden="true" />
              <button
                type="button"
                className="waveform-channel-badge-gear"
                aria-haspopup="dialog"
                aria-expanded={popoverOpen}
                aria-label={`Configure Channel ${name}`}
                title={`Configure Channel ${name}`}
                data-testid={`channel-gear-${name}`}
                ref={(el) => {
                  if (el) channelGearRefs.current.set(name, el);
                  else channelGearRefs.current.delete(name);
                }}
                onClick={() => setOpenKey(popoverOpen ? null : popoverKey)}
              >
                <GearIcon />
              </button>
              {popoverOpen && (
                <AnchoredPopover
                  openKey={popoverKey}
                  anchorEl={channelGearRefs.current.get(name) ?? null}
                  ariaLabel={`Configure Channel ${name}`}
                  onClose={(refocusAnchor) => {
                    setOpenKey(null);
                    if (refocusAnchor) {
                      channelGearRefs.current.get(name)?.focus();
                    }
                  }}
                >
                  <BadgeConfigPopover
                    target={{
                      kind: "channel",
                      paletteKey,
                      channelName: name,
                    }}
                    onClose={() => {
                      setOpenKey(null);
                      channelGearRefs.current.get(name)?.focus();
                    }}
                  />
                </AnchoredPopover>
              )}
            </span>
          );
        })}
        {refChannels.map((name) => {
          // Issue #96: reference badges reuse the #228 split-action chip
          // chrome; visibility is independent from the primary set and
          // selection stays a primary-channel concern.
          const active = refActiveChannels.includes(name);
          const color = effectiveTraceColor(theme, customColors, name);
          const custom = customNames[name];
          const displayLabel = custom ? `${name}: ${custom}` : name;
          const popoverKey = `channel:${name}`;
          const popoverOpen = openKey === popoverKey;
          return (
            <span
              key={name}
              className={`waveform-channel-badge${
                active ? " waveform-channel-badge--active" : ""
              }${popoverOpen ? " waveform-channel-badge--open" : ""}`}
              role="group"
              aria-label={`Reference channel ${name}`}
              data-testid={`channel-badge-group-${name}`}
              style={{ "--badge-color": color } as React.CSSProperties}
            >
              <button
                type="button"
                className="waveform-channel-badge-body"
                aria-pressed={active}
                aria-label={`Toggle reference channel ${displayLabel} visibility (double-click to rename)`}
                title={`Toggle reference channel ${displayLabel} visibility (double-click to rename)`}
                data-testid={`channel-badge-${name}`}
                onClick={() => toggleRefChannel(name)}
                onDoubleClick={() => {
                  setEditingChannel(name);
                  preDoubleClickRef.current = {
                    channel: name,
                    activeChannels: [],
                    selectedChannel: null,
                    timestamp: Date.now(),
                  };
                  cancelledRef.current = false;
                  draftRef.current = custom ?? "";
                }}
              >
                {displayLabel}
              </button>
              <span className="badge-split-divider" aria-hidden="true" />
              <button
                type="button"
                className="waveform-channel-badge-gear"
                aria-haspopup="dialog"
                aria-expanded={popoverOpen}
                aria-label={`Configure reference channel ${name}`}
                title={`Configure reference channel ${name}`}
                data-testid={`channel-gear-${name}`}
                ref={(el) => {
                  if (el) refChannelGearRefs.current.set(name, el);
                  else refChannelGearRefs.current.delete(name);
                }}
                onClick={() => setOpenKey(popoverOpen ? null : popoverKey)}
              >
                <GearIcon />
              </button>
              {popoverOpen && (
                <AnchoredPopover
                  openKey={popoverKey}
                  anchorEl={refChannelGearRefs.current.get(name) ?? null}
                  ariaLabel={`Configure reference channel ${name}`}
                  onClose={(refocusAnchor) => {
                    setOpenKey(null);
                    if (refocusAnchor) {
                      refChannelGearRefs.current.get(name)?.focus();
                    }
                  }}
                >
                  <BadgeConfigPopover
                    target={{
                      kind: "channel",
                      paletteKey: name as PaletteKey,
                      channelName: name,
                    }}
                    onClose={() => {
                      setOpenKey(null);
                      refChannelGearRefs.current.get(name)?.focus();
                    }}
                  />
                </AnchoredPopover>
              )}
            </span>
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
          const popoverKey = `cursor:${id}`;
          const popoverOpen = openKey === popoverKey;

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
            <span
              key={id}
              className={`waveform-cursor-badge${
                active ? " waveform-cursor-badge--active" : ""
              }${selected ? " waveform-cursor-badge--selected" : ""}${
                popoverOpen ? " waveform-cursor-badge--open" : ""
              }`}
              role="group"
              aria-label={`Cursor ${id}`}
              data-testid={`cursor-badge-group-${id.toLowerCase()}`}
              style={{ "--badge-color": color } as React.CSSProperties}
            >
              <button
                type="button"
                className="waveform-cursor-badge-body"
                aria-pressed={active}
                aria-label={`Toggle cursor ${id} (currently ${
                  active ? "active" : "inactive"
                }${selected ? ", selected" : ""})`}
                title={`Toggle cursor ${id}${selected ? " (selected)" : ""}\nControls: ${CURSOR_MOVEMENT_SUMMARY}`}
                data-testid={`cursor-toggle-${id.toLowerCase()}`}
                onClick={handleClick}
              >
                {id}
              </button>
              <span className="badge-split-divider" aria-hidden="true" />
              <button
                type="button"
                className="waveform-cursor-badge-gear"
                aria-haspopup="dialog"
                aria-expanded={popoverOpen}
                aria-label={`Configure Cursor ${id}`}
                title={`Configure Cursor ${id}`}
                data-testid={`cursor-gear-${id.toLowerCase()}`}
                ref={(el) => {
                  if (el) cursorGearRefs.current.set(id, el);
                  else cursorGearRefs.current.delete(id);
                }}
                onClick={() => setOpenKey(popoverOpen ? null : popoverKey)}
              >
                <GearIcon />
              </button>
              {popoverOpen && (
                <AnchoredPopover
                  openKey={popoverKey}
                  anchorEl={cursorGearRefs.current.get(id) ?? null}
                  ariaLabel={`Configure Cursor ${id}`}
                  onClose={(refocusAnchor) => {
                    setOpenKey(null);
                    if (refocusAnchor) {
                      cursorGearRefs.current.get(id)?.focus();
                    }
                  }}
                >
                  <BadgeConfigPopover
                    target={{ kind: "cursor", paletteKey: id }}
                    onClose={() => {
                      setOpenKey(null);
                      cursorGearRefs.current.get(id)?.focus();
                    }}
                  />
                </AnchoredPopover>
              )}
            </span>
          );
        })}
      </div>
      <div
        className="waveform-stack-toggle"
        role="group"
        aria-label="Channel lane layout"
        data-testid="stack-mode-toggle"
      >
        <button
          type="button"
          className={`waveform-stack-option${!stackMode ? " waveform-stack-option--active" : ""}`}
          aria-pressed={!stackMode}
          aria-label="Overlay: all channels share the full graticule"
          title="Overlay: all channels share the full graticule"
          data-testid="stack-mode-overlay"
          onClick={() => setStackMode(false)}
        >
          Overlay
        </button>
        <button
          type="button"
          className={`waveform-stack-option${stackMode ? " waveform-stack-option--active" : ""}`}
          aria-pressed={stackMode}
          aria-label="Stack: partition the canvas into equal horizontal lanes per visible channel"
          title="Stack: partition the canvas into equal horizontal lanes per visible channel"
          data-testid="stack-mode-stack"
          onClick={() => setStackMode(true)}
        >
          Stack
        </button>
      </div>
      <button
        type="button"
        className="waveform-fit-button"
        aria-label="Reset View: reset display transforms, File 2 time slip, and viewport"
        title="Reset View: reset display transforms, File 2 time slip, and viewport"
        data-testid="reset-view-button"
        onClick={handleResetView}
      >
        Reset View
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
    </div>
  );
}
