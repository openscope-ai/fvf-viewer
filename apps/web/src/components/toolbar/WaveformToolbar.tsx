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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCaptureStore } from "../../state/captureStore";
import { useZoomHistoryStore } from "../../state/zoomHistoryStore";
import { useReferenceStore } from "../../state/referenceStore";
import { resetView } from "../../state/captureSession";
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
  useChannelCatalog,
  type ChannelSlot,
} from "../../capture/channelCatalog";
import {
  effectiveColorForKey,
  effectiveTraceColor,
  paletteKeyForChannel,
  type PaletteKey,
} from "../canvas/themePalette";
import CsvExportButton from "../export/CsvExportButton";
import PngSnapshotButton from "../export/PngSnapshotButton";
import { useMeasurementsStore } from "../../state/measurementsStore";
import { trackEvent } from "../../analytics/tracker";
import {
  CURSOR_MOVEMENT_SUMMARY,
  HORIZONTAL_CURSOR_MOVEMENT_SUMMARY,
} from "../cursors/cursorHelp";
import { NAVIGATION_HELP_SUMMARY } from "../canvas/navigationHelp";
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
  const catalog = useChannelCatalog();
  const toggleRefChannel = useReferenceStore((state) => state.toggleRefChannel);
  const activeChannels = useViewportStore((state) => state.activeChannels);
  const selectedChannel = useViewportStore((state) => state.selectedChannel);
  const cycleChannelBadge = useViewportStore(
    (state) => state.cycleChannelBadge,
  );

  const c1Active = useCursorStore((state) => state.c1Active);
  const c2Active = useCursorStore((state) => state.c2Active);
  const selectedCursor = useCursorStore((state) => state.selectedCursor);
  const toggleCursor = useCursorStore((state) => state.toggleCursor);
  const selectCursor = useCursorStore((state) => state.selectCursor);
  const y1Active = useCursorStore((state) => state.y1Active);
  const y2Active = useCursorStore((state) => state.y2Active);
  const selectedYCursor = useCursorStore((state) => state.selectedYCursor);
  const toggleHorizontalCursor = useCursorStore(
    (state) => state.toggleHorizontalCursor,
  );
  const selectHorizontalCursor = useCursorStore(
    (state) => state.selectHorizontalCursor,
  );
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

  // Issue #64: per-file custom channel amendments + inline badge editing.
  const customNames = useChannelNamesStore((state) => state.names);
  const setName = useChannelNamesStore((state) => state.setName);

  const badgeChannels = useMemo<
    readonly {
      id: string;
      slot: ChannelSlot;
      visible: boolean;
      selected: boolean;
      color: string;
      customName: string | undefined;
      badgeLabel: string;
      paletteKey: PaletteKey | null;
    }[]
  >(() => {
    if (!channelsOverride) {
      return catalog.channels;
    }
    const overriddenPrimary = channelsOverride.map((name) => {
      const visible = activeChannels.includes(name);
      const customName = customNames[name];
      return {
        id: name,
        slot: "primary" as const,
        visible,
        selected: visible && selectedChannel === name,
        color: effectiveTraceColor(theme, customColors, name),
        customName,
        badgeLabel: customName ? `${name}: ${customName}` : name,
        paletteKey: paletteKeyForChannel(name),
      };
    });
    return [...overriddenPrimary, ...catalog.reference];
  }, [
    channelsOverride,
    catalog,
    activeChannels,
    selectedChannel,
    theme,
    customColors,
    customNames,
  ]);
  const [editingChannel, setEditingChannel] = useState<string | null>(null);
  const draftRef = useRef<string>("");
  const cancelledRef = useRef(false);
  const preDoubleClickRef = useRef<{
    channel: string;
    activeChannels: ChannelTag[];
    selectedChannel: ChannelTag | null;
    refActiveChannels: string[];
    timestamp: number;
  } | null>(null);

  // Issue #98: 1-click Overlay/Stack lane partitioning.
  const stackMode = useChannelDisplayStore((state) => state.stackMode);
  const setStackMode = useChannelDisplayStore((state) => state.setStackMode);

  // Issue #278: automatic amplitude measurements table toggle.
  const measurementsOpen = useMeasurementsStore((state) => state.isOpen);
  const toggleMeasurements = useMeasurementsStore((state) => state.toggleOpen);

  // Issue #287: viewport zoom/pan history back/forward
  const canGoBack = useZoomHistoryStore((state) => state.canGoBack);
  const canGoForward = useZoomHistoryStore((state) => state.canGoForward);
  const goBack = useZoomHistoryStore((state) => state.goBack);
  const goForward = useZoomHistoryStore((state) => state.goForward);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        useZoomHistoryStore.getState().goBack();
      } else if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        useZoomHistoryStore.getState().goForward();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleResetView = useCallback(() => {
    onResetView?.();
    resetView({ channelsOverride });
  }, [onResetView, channelsOverride]);

  return (
    <div
      className={`waveform-toolbar ${className ?? ""}`.trim()}
      role="toolbar"
      aria-label="Waveform controls"
      data-testid="waveform-toolbar"
    >
      <div className="waveform-toolbar-channels">
        <span className="waveform-toolbar-label">Channels</span>
        {badgeChannels.map((ch) => {
          const name = ch.id;
          const isRef = ch.slot === "reference";
          const active = ch.visible;
          const selected = ch.selected;
          const color = ch.color;
          const custom = ch.customName;
          const displayLabel = ch.badgeLabel;
          const editing = editingChannel === name;
          const paletteKey = ch.paletteKey;
          const popoverKey = `channel:${name}`;
          const popoverOpen = openKey === popoverKey;

          const groupAriaLabel = isRef
            ? `Reference channel ${name}`
            : `Channel ${name}`;
          const toggleAriaLabel = isRef
            ? `Toggle reference channel ${displayLabel} visibility (double-click to rename)`
            : `Toggle channel ${displayLabel} visibility (double-click to rename)`;
          const configureAriaLabel = isRef
            ? `Configure reference channel ${name}`
            : `Configure Channel ${name}`;

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
          if (!isRef && !paletteKey) {
            return (
              <button
                key={name}
                type="button"
                className="waveform-channel-badge waveform-channel-badge--plain"
                aria-pressed={active}
                aria-label={toggleAriaLabel}
                title={toggleAriaLabel}
                data-testid={`channel-badge-${name}`}
                onClick={() => cycleChannelBadge(name)}
              >
                {displayLabel}
              </button>
            );
          }

          const effectivePaletteKey = (paletteKey ?? name) as PaletteKey;

          return (
            <span
              key={name}
              className={`waveform-channel-badge${
                active ? " waveform-channel-badge--active" : ""
              }${selected ? " waveform-channel-badge--selected" : ""}${
                popoverOpen ? " waveform-channel-badge--open" : ""
              }`}
              role="group"
              aria-label={groupAriaLabel}
              data-testid={`channel-badge-group-${name}`}
              style={{ "--badge-color": color } as React.CSSProperties}
            >
              <button
                type="button"
                className="waveform-channel-badge-body"
                aria-pressed={active}
                aria-label={toggleAriaLabel}
                title={toggleAriaLabel}
                data-testid={`channel-badge-${name}`}
                onClick={(event) => {
                  const now = Date.now();
                  if (
                    (isRef && event.detail <= 1) ||
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
                      refActiveChannels: [
                        ...useReferenceStore.getState().refActiveChannels,
                      ],
                      timestamp: now,
                    };
                  } else {
                    preDoubleClickRef.current.timestamp = now;
                  }
                  if (isRef) {
                    toggleRefChannel(name);
                  } else {
                    cycleChannelBadge(name);
                  }
                }}
                onDoubleClick={() => {
                  // Restore the pre-double-click state so the 2 rapid clicks don't mutate state
                  if (
                    preDoubleClickRef.current &&
                    preDoubleClickRef.current.channel === name
                  ) {
                    if (isRef) {
                      useReferenceStore
                        .getState()
                        .setRefActiveChannels(
                          preDoubleClickRef.current.refActiveChannels,
                        );
                    } else {
                      useViewportStore.setState({
                        activeChannels:
                          preDoubleClickRef.current.activeChannels,
                        selectedChannel:
                          preDoubleClickRef.current.selectedChannel,
                      });
                    }
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
                aria-label={configureAriaLabel}
                title={configureAriaLabel}
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
                  ariaLabel={configureAriaLabel}
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
                      paletteKey: effectivePaletteKey,
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
      </div>
      <div
        className="waveform-toolbar-cursors"
        data-testid="waveform-toolbar-cursors"
      >
        <span className="waveform-toolbar-label">Cursors</span>
        {(["C1", "C2", "Y1", "Y2"] as const).map((id) => {
          const isHorizontal = id === "Y1" || id === "Y2";
          const active = isHorizontal
            ? id === "Y1"
              ? y1Active
              : y2Active
            : id === "C1"
              ? c1Active
              : c2Active;
          const selected = isHorizontal
            ? selectedYCursor === id
            : selectedCursor === id;
          const color = effectiveColorForKey(
            theme,
            customColors,
            id as PaletteKey,
          );
          const popoverKey = `cursor:${id}`;
          const popoverOpen = openKey === popoverKey;

          const handleClick = () => {
            if (isHorizontal) {
              if (!active) {
                toggleHorizontalCursor(id);
              } else if (!selected) {
                selectHorizontalCursor(id);
              } else {
                toggleHorizontalCursor(id);
              }
            } else {
              if (!active) {
                toggleCursor(id, totalSamples);
              } else if (!selected) {
                selectCursor(id);
              } else {
                toggleCursor(id, totalSamples);
              }
            }
          };

          const movementSummary = isHorizontal
            ? HORIZONTAL_CURSOR_MOVEMENT_SUMMARY
            : CURSOR_MOVEMENT_SUMMARY;

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
                title={`Toggle cursor ${id}${selected ? " (selected)" : ""}\nControls: ${movementSummary}`}
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
        className="waveform-toolbar-actions"
        data-testid="waveform-toolbar-actions"
      >
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
            onClick={() => {
              if (stackMode) {
                setStackMode(false);
                trackEvent("layout_toggled", { mode: "overlay" });
              }
            }}
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
            onClick={() => {
              if (!stackMode) {
                setStackMode(true);
                trackEvent("layout_toggled", { mode: "stack" });
              }
            }}
          >
            Stack
          </button>
        </div>
        <div
          className="waveform-history-group"
          role="group"
          aria-label="Viewport zoom history and reset"
          data-testid="waveform-history-group"
        >
          <button
            type="button"
            className="waveform-fit-button"
            aria-label={`Reset View: reset display transforms, File 2 time slip, and viewport. ${NAVIGATION_HELP_SUMMARY}`}
            title={`Reset View: reset display transforms, File 2 time slip, and viewport\nControls: ${NAVIGATION_HELP_SUMMARY}`}
            data-testid="reset-view-button"
            onClick={handleResetView}
          >
            Reset View
          </button>
          <button
            type="button"
            className="waveform-history-button"
            aria-label="Zoom history back (Alt+Left)"
            title="Zoom history back (Alt+Left)"
            data-testid="zoom-history-back"
            disabled={!canGoBack}
            onClick={goBack}
          >
            ◀
          </button>
          <button
            type="button"
            className="waveform-history-button"
            aria-label="Zoom history forward (Alt+Right)"
            title="Zoom history forward (Alt+Right)"
            data-testid="zoom-history-forward"
            disabled={!canGoForward}
            onClick={goForward}
          >
            ▶
          </button>
        </div>
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
        <button
          type="button"
          className={`waveform-measurements-button${measurementsOpen ? " waveform-measurements-button--active" : ""}`}
          aria-pressed={measurementsOpen}
          aria-label="Toggle amplitude measurements table"
          title="Toggle amplitude measurements table"
          data-testid="measurements-toggle-button"
          onClick={toggleMeasurements}
        >
          Measurements
        </button>
        <CsvExportButton />
        <PngSnapshotButton />
      </div>
    </div>
  );
}
