/**
 * Out-of-view directional cursor recovery badges (Issue #15).
 *
 * Pinned to plot-area margins when an active cursor's timestamp lies outside the
 * current horizontal viewport [xMin, xMax]:
 * - Left overflow (t < xMin): pins to top-left margin (◀ C1 / ◀ C2)
 * - Right overflow (t > xMax): pins to top-right margin (C1 ▶ / C2 ▶)
 * - Stacks vertically (C1 above C2) when both exit on the same edge
 * - Minimal high-contrast chips with directional chevron and cursor tag
 * - Informative tooltip with timestamp and "Click to bring into view"
 * - Tab-focusable <button> with Enter/Space keyboard activation
 * - Clicking or keyboard activation snaps cursor to 33% (C1) or 67% (C2) of viewport
 *   at the nearest discrete sample index and selects the cursor, dismissing the badge
 * - Dismisses immediately when cursor is toggled off, panned/zoomed into view, or "Fit Waveform (100%)" is triggered
 * - Stops pointer event propagation to avoid triggering canvas box-zoom
 */

import React from "react";
import { THEME_COLORS } from "../canvas/Oscilloscope";
import { formatTime } from "./siFormat";
import { findNearestSampleIndex } from "./cursorPlugin";
import { useCursorStore, type CursorId } from "../../state/cursorStore";
import { useViewportStore } from "../../state/viewportStore";
import type { ParsedCapture } from "../../types/capture";

export interface CursorRecoveryBadgesProps {
  capture: ParsedCapture;
  className?: string;
}

export const CursorRecoveryBadges: React.FC<CursorRecoveryBadgesProps> = ({
  capture,
  className,
}) => {
  const c1Active = useCursorStore((state) => state.c1Active);
  const c2Active = useCursorStore((state) => state.c2Active);
  const c1SampleIndex = useCursorStore((state) => state.c1SampleIndex);
  const c2SampleIndex = useCursorStore((state) => state.c2SampleIndex);
  const setCursorSample = useCursorStore((state) => state.setCursorSample);
  const selectCursor = useCursorStore((state) => state.selectCursor);

  const xMin = useViewportStore((state) => state.xMin);
  const xMax = useViewportStore((state) => state.xMax);

  const { timestamps } = capture;
  const totalSamples = timestamps.length;
  if (totalSamples === 0) return null;

  const effectiveXMin = xMin ?? timestamps[0]!;
  const effectiveXMax = xMax ?? timestamps[totalSamples - 1]!;

  const i1 = Math.max(0, Math.min(c1SampleIndex, totalSamples - 1));
  const i2 = Math.max(0, Math.min(c2SampleIndex, totalSamples - 1));

  const t1 = timestamps[i1]!;
  const t2 = timestamps[i2]!;

  const c1Left = c1Active && t1 < effectiveXMin;
  const c1Right = c1Active && t1 > effectiveXMax;
  const c2Left = c2Active && t2 < effectiveXMin;
  const c2Right = c2Active && t2 > effectiveXMax;

  if (!c1Left && !c1Right && !c2Left && !c2Right) {
    return null;
  }

  const handleRecover = (id: CursorId) => {
    const fraction = id === "C1" ? 0.33 : 0.67;
    const targetTime =
      effectiveXMin + fraction * (effectiveXMax - effectiveXMin);
    const snappedIdx = findNearestSampleIndex(timestamps, targetTime);
    setCursorSample(id, snappedIdx, totalSamples);
    selectCursor(id);
  };

  const renderBadge = (
    id: CursorId,
    side: "left" | "right",
    timeVal: number,
  ) => {
    const color = id === "C1" ? THEME_COLORS.cursor1 : THEME_COLORS.cursor2;
    const formattedTime = formatTime(timeVal);

    return (
      <button
        key={id}
        type="button"
        tabIndex={0}
        className={`cursor-recovery-badge cursor-recovery-badge--${id.toLowerCase()} cursor-recovery-badge--${side}`}
        data-testid={`cursor-recovery-badge-${id.toLowerCase()}`}
        style={{
          borderColor: color,
          color,
          boxShadow: `0 0 6px ${color}66`,
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          handleRecover(id);
        }}
        title={`${id} (${formattedTime}) - Click to bring into view`}
        aria-label={`Recover cursor ${id} into view (current time ${formattedTime})`}
      >
        {side === "left" && (
          <span className="cursor-recovery-chevron" aria-hidden="true">
            ◀
          </span>
        )}
        <span className="cursor-recovery-tag">{id}</span>
        {side === "right" && (
          <span className="cursor-recovery-chevron" aria-hidden="true">
            ▶
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      className={`cursor-recovery-badges ${className ?? ""}`.trim()}
      data-testid="cursor-recovery-badges"
    >
      {(c1Left || c2Left) && (
        <div
          className="cursor-recovery-group cursor-recovery-group--left"
          data-testid="cursor-recovery-left"
        >
          {c1Left && renderBadge("C1", "left", t1)}
          {c2Left && renderBadge("C2", "left", t2)}
        </div>
      )}
      {(c1Right || c2Right) && (
        <div
          className="cursor-recovery-group cursor-recovery-group--right"
          data-testid="cursor-recovery-right"
        >
          {c1Right && renderBadge("C1", "right", t1)}
          {c2Right && renderBadge("C2", "right", t2)}
        </div>
      )}
    </div>
  );
};
