/**
 * Quick-Stack lane geometry (issue #98): in Stack mode the vertical
 * graticule is partitioned into equal horizontal lanes, one per visible
 * channel (primary channels in file order, then visible reference
 * channels), lane 0 at the TOP.
 *
 * Each channel keeps its own per-axis scale, so a lane assignment is a
 * per-channel bounds rewrite: the channel's current bounds center stays
 * the trace's display center, the span widens by the lane count (the
 * trace then occupies exactly 1/N of the plot height), and the window
 * slides so the center lands at the lane's center fraction.
 */

export interface Bounds {
  min: number;
  max: number;
}

/**
 * The stack lane bounds for one channel: its current bounds (any zoom)
 * re-windowed into lane `laneIndex` of `laneCount` equal lanes
 * (0 = top lane). Pure arithmetic — no uPlot dependency.
 */
export function stackLaneBounds(
  current: Bounds,
  laneIndex: number,
  laneCount: number,
): Bounds {
  if (laneCount <= 1) return { ...current };
  const clampedIndex = Math.max(0, Math.min(laneIndex, laneCount - 1));
  const center = (current.min + current.max) / 2;
  const span = (current.max - current.min) * laneCount;
  // Fraction of the plot height where this lane's center sits (0 = top).
  const centerFraction = 1 - (clampedIndex + 0.5) / laneCount;
  const min = center - centerFraction * span;
  return { min, max: min + span };
}

/**
 * Restores the pre-stack bounds for one channel after collapsing back
 * to Overlay (the saved window re-centers the trace at 50% height).
 */
export function overlayBounds(saved: Bounds): Bounds {
  return { ...saved };
}
