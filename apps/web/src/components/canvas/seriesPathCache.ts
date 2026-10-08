import uPlot from "uplot";

/**
 * Structural view of a live uPlot series exposing the internal path
 * geometry cache (`_paths`, an underscore-prefixed uPlot internal).
 */
type PathCachedSeries = { _paths: unknown | null };

/**
 * Invalidate uPlot's cached path geometry for one series (issue #245).
 *
 * uPlot (1.6.x) caches each series' rendered `Path2D` geometry in
 * `series._paths` and only rebuilds it in `drawSeries` when the cache is
 * `null`, when `setData` swaps the whole dataset, or when the series'
 * scale bounds actually change (`setScales` invalidates series on changed
 * scales; re-asserting identical bounds invalidates nothing). Rewriting a
 * lane buffer in place (`instance.data[i] = lane`) is invisible to that
 * cache: with scale bounds pinned around the lane swap — exactly the
 * #224/#238/#97 display-transform discipline — the immediate-mode
 * `batch()` repaint reuses the stale geometry and the canvas keeps
 * showing the pre-transform trace even though the lane data and the store
 * are already up to date.
 *
 * Clearing `_paths` for exactly the mutated series before the
 * `batch()` / `redraw(false, true)` forces uPlot to rebuild those paths
 * on the next paint while untouched series keep their cached geometry
 * (scoped invalidation). This mirrors what uPlot itself does in
 * `resetYSeries` (invoked by `setData`, x-scale resets, and size
 * changes); a `null` cache is always safe — it merely triggers a lazy
 * rebuild in the next `drawSeries` pass, including for hidden series
 * (rebuilt whenever they are next shown).
 */
export function invalidateSeriesPaths(
  instance: uPlot,
  seriesIndex: number,
): void {
  const series = instance.series[seriesIndex] as PathCachedSeries | undefined;
  if (series) {
    series._paths = null;
  }
}
