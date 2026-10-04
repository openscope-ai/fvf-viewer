/**
 * Floating Readout Card HUD overlay (Issue #14, drag/keyboard/persistence:
 * issue #58).
 *
 * Displays absolute readouts (sample index, trigger-relative time, visible channel voltages)
 * and differential metrics (Δt, frequency 1/Δt, ΔV) for active cursors C1/C2.
 * Syncs channel visibility with the toolbar and hides when no cursors are active.
 *
 * Issue #58: the titlebar is a draggable handle (Pointer Events with capture,
 * stopPropagation isolation from the uPlot box-zoom), the card clamps to the
 * oscilloscope wrapper with an 8px margin, double-click resets the default
 * top-right anchor, custom positions persist in local storage, resize events
 * re-clamp the card, and arrow keys nudge the position (10px, Shift 50px).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
// Issue #76: the HUD card resolves all identity colors through the palette
// store so user customizations propagate live. The card's backdrop is dark
// translucent in every viewport theme, so un-customized entries fall back to
// the Dark OLED defaults (resolveThemePalette("dark")) for contrast.
import {
  effectiveCursorColor,
  effectiveTraceColor,
} from "../canvas/themePalette";
import { usePaletteStore } from "../../state/paletteStore";
import { getPhysicalChannelUnit, splitUnit } from "../../capture/channelUnits";
import { useCursorStore, type CursorId } from "../../state/cursorStore";
import {
  formatFrequencyWithUnit,
  formatTimeWithUnit,
  formatVoltageWithUnit,
} from "./displayUnits";
import {
  useCursorDisplayStore,
  type CursorBinding,
} from "../../state/cursorDisplayStore";
import { useThemeStore } from "../../state/themeStore";
import { useViewportStore } from "../../state/viewportStore";
import { useReadoutCardStore } from "../../state/readoutCardStore";
import {
  formatReadoutChannelName,
  useChannelNamesStore,
} from "../../state/channelNamesStore";
import { clampCardPosition, type CardPoint } from "./readoutCardPosition";
import { CURSOR_MOVEMENT_GUIDE, CURSOR_MOVEMENT_SUMMARY } from "./cursorHelp";
import type { ParsedCapture } from "../../types/capture";

export interface CursorReadoutCardProps {
  capture: ParsedCapture;
  className?: string;
}

const KEYBOARD_NUDGE_PX = 10;
const KEYBOARD_NUDGE_SHIFT_PX = 50;

interface DragState {
  pointerId: number;
  grabDX: number;
  grabDY: number;
  parentLeft: number;
  parentTop: number;
  parentWidth: number;
  parentHeight: number;
}

/** Resolves the card's current visual position relative to its offset parent. */
function currentVisualPosition(
  card: HTMLElement,
  parent: HTMLElement,
): CardPoint {
  const cardRect = card.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  return {
    left: cardRect.left - parentRect.left,
    top: cardRect.top - parentRect.top,
  };
}

/**
 * Floating cursor guidance panel (issue #143): opened by clicking the (?)
 * titlebar button. Reuses the card's dark HUD styling and lists the same
 * movement controls previously only available as a button tooltip.
 */
const CursorHelpPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [guideTitle, ...guideLines] = CURSOR_MOVEMENT_GUIDE.split("\n");
  return (
    <div
      className="cursor-readout-help-panel"
      data-testid="cursor-readout-help-panel"
      role="dialog"
      aria-label="Cursor help"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="cursor-readout-help-header">
        <span className="cursor-readout-help-title">{guideTitle}</span>
        <button
          type="button"
          className="cursor-readout-help-close"
          data-testid="cursor-readout-help-close"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          aria-label="Close cursor help"
          title="Close"
        >
          ✕
        </button>
      </div>
      <ul className="cursor-readout-help-list">
        {guideLines.map((line) => (
          <li key={line}>{line.replace(/^•\s*/, "")}</li>
        ))}
      </ul>
    </div>
  );
};

export const CursorReadoutCard: React.FC<CursorReadoutCardProps> = ({
  capture,
  className,
}) => {
  const c1Active = useCursorStore((state) => state.c1Active);
  const c2Active = useCursorStore((state) => state.c2Active);
  const selectedCursor = useCursorStore((state) => state.selectedCursor);
  const c1SampleIndex = useCursorStore((state) => state.c1SampleIndex);
  const c2SampleIndex = useCursorStore((state) => state.c2SampleIndex);
  const selectCursor = useCursorStore((state) => state.selectCursor);

  const activeChannels = useViewportStore((state) => state.activeChannels);
  const selectedChannel = useViewportStore((state) => state.selectedChannel);
  const xMin = useViewportStore((state) => state.xMin);
  const xMax = useViewportStore((state) => state.xMax);
  const customNames = useChannelNamesStore((state) => state.names);
  // Issue #143: identity colors resolve under the active viewport theme so
  // the card matches the canvas traces exactly. Readability on the dark
  // card backdrop is carried by swatches/rings, not tinted text.
  const theme = useThemeStore((state) => state.theme);
  // Issue #143: the help button toggles a floating guidance panel instead
  // of relying on a tooltip.
  const [helpOpen, setHelpOpen] = useState(false);
  // Issue #76: reactive palette subscription — color edits restyle the card
  // in place, palette reset restores the dark-theme defaults.
  const customColors = usePaletteStore((state) => state.customColors);
  const position = useReadoutCardStore((state) => state.position);
  // Issue #226: global display-unit selection drives every measurement on
  // this card (one shared surface, set from either cursor popover).
  const timeUnit = useCursorDisplayStore((state) => state.timeUnit);
  const frequencyUnit = useCursorDisplayStore((state) => state.frequencyUnit);
  const voltageUnit = useCursorDisplayStore((state) => state.voltageUnit);
  // Issue #225: per-cursor channel source binding + pair-level Δt lock.
  const c1Binding = useCursorDisplayStore((state) => state.bindings.C1);
  const c2Binding = useCursorDisplayStore((state) => state.bindings.C2);
  const deltaLocked = useCursorDisplayStore((state) => state.deltaLocked);
  const collapsed = useReadoutCardStore((state) => state.collapsed);
  const setPosition = useReadoutCardStore((state) => state.setPosition);

  const [dragPos, setDragPos] = useState<CardPoint | null>(null);
  const [dragging, setDragging] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const titlebarRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<DragState | null>(null);
  const dragPosRef = useRef<CardPoint | null>(null);
  dragPosRef.current = dragPos;

  const clampWithLayout = useCallback((point: CardPoint): CardPoint | null => {
    const card = cardRef.current;
    const parent = card?.offsetParent as HTMLElement | null;
    if (!card || !parent) return null;
    const cardRect = card.getBoundingClientRect();
    return clampCardPosition(
      point,
      parent.clientWidth,
      parent.clientHeight,
      cardRect.width,
      cardRect.height,
    );
  }, []);

  // Issue #58: pointer drag via the titlebar handle. Pointer capture keeps
  // the gesture on the titlebar; stopPropagation isolates the drag from the
  // uPlot box-zoom/cursor handlers (they live on a sibling subtree — the
  // isolation guard stays defensive per AC).
  const onTitlebarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const card = cardRef.current;
    const titlebar = titlebarRef.current;
    const parent = card?.offsetParent as HTMLElement | null;
    if (!card || !titlebar || !parent) return;
    const cardRect = card.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    dragState.current = {
      pointerId: event.pointerId,
      grabDX: event.clientX - cardRect.left,
      grabDY: event.clientY - cardRect.top,
      parentLeft: parentRect.left,
      parentTop: parentRect.top,
      parentWidth: parent.clientWidth,
      parentHeight: parent.clientHeight,
    };
    try {
      titlebar.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic events (tests) and already-released pointers have no
      // active pointer id; dragging still works through element-local
      // move events.
    }
    setDragging(true);
  };

  const onTitlebarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state || event.pointerId !== state.pointerId) return;
    event.stopPropagation();
    const card = cardRef.current;
    if (!card) return;
    const cardRect = card.getBoundingClientRect();
    const next = clampCardPosition(
      {
        left: event.clientX - state.grabDX - state.parentLeft,
        top: event.clientY - state.grabDY - state.parentTop,
      },
      state.parentWidth,
      state.parentHeight,
      cardRect.width,
      cardRect.height,
    );
    // Keep the ref in sync with the state: a pointerup dispatched in the
    // same task (fast flicks, synthetic events) must commit the latest
    // position without waiting for a re-render.
    dragPosRef.current = next;
    setDragPos(next);
  };

  const commitDrag = useCallback(() => {
    const committed = dragPosRef.current;
    dragState.current = null;
    setDragging(false);
    setDragPos(null);
    if (committed) {
      setPosition(committed);
    }
  }, [setPosition]);

  const onTitlebarPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current || event.pointerId !== dragState.current.pointerId)
      return;
    event.stopPropagation();
    commitDrag();
  };

  const onTitlebarPointerCancel = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!dragState.current || event.pointerId !== dragState.current.pointerId)
      return;
    event.stopPropagation();
    dragState.current = null;
    setDragging(false);
    setDragPos(null);
  };

  // Issue #58: arrow-key nudging (10px; Shift = 50px). Enter/Escape commit
  // and release focus. Nudges resolve from the live visual position, so
  // they also work from the default right-anchored state.
  const onTitlebarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    if (key === "Enter" || key === "Escape") {
      event.stopPropagation();
      event.currentTarget.blur();
      return;
    }
    const step = event.shiftKey ? KEYBOARD_NUDGE_SHIFT_PX : KEYBOARD_NUDGE_PX;
    let dx = 0;
    let dy = 0;
    if (key === "ArrowLeft") dx = -step;
    else if (key === "ArrowRight") dx = step;
    else if (key === "ArrowUp") dy = -step;
    else if (key === "ArrowDown") dy = step;
    else return;
    event.preventDefault();
    event.stopPropagation();
    const card = cardRef.current;
    const parent = card?.offsetParent as HTMLElement | null;
    if (!card || !parent) return;
    // The store commits synchronously, so chained nudges within one frame
    // compose correctly; the visual position only resolves the default
    // right-anchored state (store position null).
    const base =
      dragPosRef.current ??
      useReadoutCardStore.getState().position ??
      currentVisualPosition(card, parent);
    const clamped = clampWithLayout({
      left: base.left + dx,
      top: base.top + dy,
    });
    if (clamped) setPosition(clamped);
  };

  const onTitlebarDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    dragState.current = null;
    setDragging(false);
    setDragPos(null);
    setPosition(null);
  };

  // Issue #58: re-clamp on card size changes (e.g. expanding a collapsed
  // card near the bottom boundary must re-clamp upward) and on window
  // resize so the card never hangs off-screen. Prefers the in-flight drag
  // position; otherwise re-clamps the persisted store position. Re-bound
  // whenever the card mounts/unmounts (cursor activity toggles rendering).
  const cardMounted = c1Active || c2Active;
  useEffect(() => {
    const card = cardRef.current;
    if (!card || !cardMounted) return;
    const reclamp = () => {
      const current =
        dragPosRef.current ?? useReadoutCardStore.getState().position;
      if (!current) return;
      const clamped = clampWithLayout(current);
      if (!clamped) return;
      if (clamped.left !== current.left || clamped.top !== current.top) {
        if (dragState.current) {
          dragPosRef.current = clamped;
          setDragPos(clamped);
        } else {
          setPosition(clamped);
        }
      }
    };
    const observer = new ResizeObserver(reclamp);
    observer.observe(card);
    // Container-only shrinks (side panel, layout toggle) fire no window
    // resize event: observe the positioned wrapper too.
    const parent = card.offsetParent;
    if (parent instanceof HTMLElement) {
      observer.observe(parent);
    }
    window.addEventListener("resize", reclamp);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reclamp);
    };
  }, [cardMounted, clampWithLayout, setPosition]);

  if (!c1Active && !c2Active) {
    return null;
  }

  const { timestamps, channels } = capture;
  const totalSamples = timestamps.length;
  if (totalSamples === 0) return null;

  // Safe sample lookups
  const i1 = Math.max(0, Math.min(c1SampleIndex, totalSamples - 1));
  const i2 = Math.max(0, Math.min(c2SampleIndex, totalSamples - 1));

  const t1 = timestamps[i1] ?? 0;
  const t2 = timestamps[i2] ?? 0;

  const deltaT = Math.abs(t2 - t1);
  const freq = deltaT > 0 ? 1 / deltaT : 0;

  const visibleChannels = channels
    .map((channel, index) => ({ channel, index }))
    .filter(({ channel }) => activeChannels.includes(channel.name));

  // Issue #225: a bound cursor's measurements filter to its bound
  // channel; a hidden (or absent) bound channel falls back to all visible
  // channels with an explicit hint — the card is never empty.
  const boundChannelList = (
    binding: CursorBinding,
  ): { list: typeof visibleChannels; fallback: boolean } => {
    if (binding === "all") return { list: visibleChannels, fallback: false };
    const bound = visibleChannels.filter(
      ({ channel }) => channel.name === binding,
    );
    if (bound.length > 0) return { list: bound, fallback: false };
    return { list: visibleChannels, fallback: true };
  };
  const c1Channels = boundChannelList(c1Binding);
  const c2Channels = boundChannelList(c2Binding);

  const effectiveXMin = xMin ?? timestamps[0] ?? 0;
  const effectiveXMax = xMax ?? timestamps[totalSamples - 1] ?? 1;

  const effectivePosition = dragPos ?? position;
  const positionStyle: React.CSSProperties | undefined = effectivePosition
    ? {
        top: effectivePosition.top,
        left: effectivePosition.left,
        right: "auto",
      }
    : undefined;

  const renderCursorRow = (
    id: CursorId,
    active: boolean,
    idx: number,
    timeVal: number,
    channelList: { list: typeof visibleChannels; fallback: boolean },
  ) => {
    if (!active) return null;
    const isSelected = selectedCursor === id;
    const isOutOfView = timeVal < effectiveXMin || timeVal > effectiveXMax;
    // Issue #143: the ring matches the canvas cursor line in the active
    // theme; selection mirrors the toolbar badge (white text, tinted fill,
    // stronger glow) and the selection dot is gone.
    const color = effectiveCursorColor(theme, customColors, id);

    return (
      <div
        className={`cursor-readout-row cursor-readout-row--${id.toLowerCase()}${
          isSelected ? " cursor-readout-row--selected" : ""
        }${isOutOfView ? " cursor-readout-row--out-of-view" : ""}`}
        data-testid={`cursor-readout-${id.toLowerCase()}`}
        data-out-of-view={isOutOfView}
      >
        <div className="cursor-readout-header">
          <button
            type="button"
            className={`cursor-badge cursor-badge--${id.toLowerCase()}${
              isSelected ? " cursor-badge--selected" : ""
            }`}
            style={{
              borderColor: color,
              color: isSelected ? "#ffffff" : color,
              backgroundColor: isSelected ? `${color}33` : "transparent",
              boxShadow: isSelected ? `0 0 8px ${color}` : `0 0 4px ${color}44`,
            }}
            onClick={() => selectCursor(id)}
            title={`Select cursor ${id}`}
            aria-label={`Select cursor ${id}`}
            aria-pressed={isSelected}
            data-testid={`cursor-badge-select-${id.toLowerCase()}`}
          >
            {id}
          </button>
          <span
            className="cursor-sample-index"
            data-testid={`cursor-sample-${id.toLowerCase()}`}
          >
            #{idx}
          </span>
          <span
            className="cursor-time-value"
            data-testid={`cursor-time-${id.toLowerCase()}`}
          >
            {formatTimeWithUnit(timeVal, timeUnit)}
          </span>
        </div>
        <div className="cursor-channel-voltages">
          {channelList.list.map(({ channel, index }) => {
            const v = channel.data[idx] ?? 0;
            // Issue #143: the swatch carries the exact canvas trace color
            // in the active theme; the name stays readable on the dark
            // card. A renamed channel shows no trailing colon.
            const chColor = effectiveTraceColor(
              theme,
              customColors,
              channel.name,
            );
            const hasCustomName = Boolean(customNames[channel.name]?.trim());
            const isSelected = channel.name === selectedChannel;
            return (
              <div
                key={channel.name}
                className={`cursor-channel-reading${isSelected ? " cursor-channel-reading--selected" : ""}`}
                data-testid={`cursor-${id.toLowerCase()}-ch-${channel.name}`}
              >
                <span className="cursor-channel-identity">
                  <span
                    className="cursor-channel-swatch"
                    style={{ backgroundColor: chColor }}
                    aria-hidden="true"
                    data-testid={`cursor-${id.toLowerCase()}-ch-${channel.name}-swatch`}
                  />
                  <span className="cursor-channel-name">
                    {formatReadoutChannelName(
                      channel.name,
                      channel.label,
                      customNames[channel.name],
                    )}
                    {hasCustomName ? "" : ":"}
                  </span>
                </span>
                <span className="cursor-voltage-value">
                  {formatVoltageWithUnit(
                    v,
                    getPhysicalChannelUnit(capture, index),
                    voltageUnit,
                  )}
                </span>
              </div>
            );
          })}
          {channelList.fallback && (
            <div
              className="cursor-binding-hint"
              data-testid={`cursor-binding-hint-${id.toLowerCase()}`}
            >
              {id === "C1" ? c1Binding : c2Binding} hidden — showing all visible
              channels
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={cardRef}
      className={`cursor-readout-card ${dragging ? "cursor-readout-card--dragging" : ""} ${className ?? ""}`.trim()}
      style={positionStyle}
      data-testid="cursor-readout-card"
    >
      <div
        ref={titlebarRef}
        className="cursor-readout-card-titlebar"
        role="button"
        tabIndex={0}
        aria-label="Move measurement cursor readout card. Drag, double-click to reset, or use arrow keys."
        data-testid="cursor-readout-card-titlebar"
        onPointerDown={onTitlebarPointerDown}
        onPointerMove={onTitlebarPointerMove}
        onPointerUp={onTitlebarPointerUp}
        onPointerCancel={onTitlebarPointerCancel}
        onKeyDown={onTitlebarKeyDown}
        onDoubleClick={onTitlebarDoubleClick}
      >
        <span className="cursor-readout-card-title">Measurement Cursors</span>
        <div className="cursor-readout-titlebar-actions">
          <button
            type="button"
            className="cursor-readout-help-btn"
            data-testid="cursor-readout-help-btn"
            aria-label={`Cursor help: ${CURSOR_MOVEMENT_SUMMARY}`}
            aria-expanded={helpOpen}
            title="Cursor help"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setHelpOpen((open) => !open);
            }}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <svg
              width="14"
              height="14"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
              className="cursor-help-icon"
            >
              <path
                d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M9 9C9 5.49997 14.5 5.5 14.5 9C14.5 11.5 12 10.9999 12 13.9999"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M12 18.01L12.01 17.9989"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="cursor-readout-collapse-btn"
            onClick={(event) => {
              event.stopPropagation();
              useReadoutCardStore.getState().setCollapsed(!collapsed);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            aria-label={
              collapsed ? "Expand readout card" : "Collapse readout card"
            }
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {helpOpen && <CursorHelpPanel onClose={() => setHelpOpen(false)} />}

      {!collapsed && (
        <div className="cursor-readout-card-content">
          {renderCursorRow("C1", c1Active, i1, t1, c1Channels)}
          {renderCursorRow("C2", c2Active, i2, t2, c2Channels)}

          {/* Differential section when both C1 and C2 are active */}
          {c1Active && c2Active && (
            <div
              className="cursor-readout-differential"
              data-testid="cursor-readout-differential"
            >
              <div className="cursor-diff-row">
                <span className="cursor-diff-label">
                  Δt:
                  {deltaLocked && (
                    <span
                      className="cursor-dt-lock-badge"
                      data-testid="cursor-dt-lock-badge"
                      title="Locked Δt: moving either cursor slides both"
                    >
                      locked
                    </span>
                  )}
                </span>
                <span
                  className="cursor-diff-value"
                  data-testid="cursor-delta-t"
                >
                  {formatTimeWithUnit(deltaT, timeUnit)}
                </span>
              </div>
              <div className="cursor-diff-row">
                <span className="cursor-diff-label">1/Δt:</span>
                <span
                  className="cursor-diff-value"
                  data-testid="cursor-frequency"
                >
                  {formatFrequencyWithUnit(freq, frequencyUnit)}
                </span>
              </div>
              {c1Channels.list
                .filter(({ channel }) =>
                  c2Channels.list.some(
                    (entry) => entry.channel.name === channel.name,
                  ),
                )
                .map(({ channel, index }) => {
                  const v1 = channel.data[i1] ?? 0;
                  const v2 = channel.data[i2] ?? 0;
                  const deltaV = v2 - v1;
                  const unit = getPhysicalChannelUnit(capture, index);
                  const { base } = splitUnit(unit);
                  // Issue #143: same swatch treatment as the channel rows —
                  // the chip matches the canvas trace, the label stays
                  // readable.
                  const chColor = effectiveTraceColor(
                    theme,
                    customColors,
                    channel.name,
                  );
                  const isSelected = channel.name === selectedChannel;
                  return (
                    <div
                      key={channel.name}
                      className={`cursor-diff-row${isSelected ? " cursor-diff-row--selected" : ""}`}
                      data-testid={`cursor-delta-v-${channel.name}`}
                    >
                      <span className="cursor-diff-identity">
                        <span
                          className="cursor-channel-swatch"
                          style={{ backgroundColor: chColor }}
                          aria-hidden="true"
                          data-testid={`cursor-delta-v-${channel.name}-swatch`}
                        />
                        <span className="cursor-diff-label">
                          Δ{base}({channel.name}):
                        </span>
                      </span>
                      <span className="cursor-diff-value">
                        {formatVoltageWithUnit(deltaV, unit, voltageUnit)}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
