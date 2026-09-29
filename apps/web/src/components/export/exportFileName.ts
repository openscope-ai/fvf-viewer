/**
 * Shared export filename helpers (issue #87): generates unique, chronological
 * filenames for PNG snapshot and CSV exports by appending a compact local
 * timestamp in YYYYMMDD-HHmmss format.
 *
 * This prevents browser download collisions ((1), (2)) across repeated exports
 * and preserves chronological ordering in the user's Downloads folder.
 */

/**
 * Formats a Date instance into a compact local timestamp: YYYYMMDD-HHmmss.
 */
export function formatCompactTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

/**
 * Returns the timestamped filename for a PNG snapshot export.
 * - `${stem}-snapshot-${timestamp}.png` (when a file is loaded)
 * - `snapshot-${timestamp}.png` (fallback when no file is loaded)
 */
export function snapshotFileName(
  fileName: string | null,
  date: Date = new Date(),
): string {
  const timestamp = formatCompactTimestamp(date);
  if (!fileName) return `snapshot-${timestamp}.png`;
  const stem = fileName.replace(/\.fvf$/i, "");
  return `${stem}-snapshot-${timestamp}.png`;
}

/**
 * Returns the timestamped filename for a CSV export.
 * - `${stem}-${timestamp}.csv` (when a file is loaded)
 * - `capture-${timestamp}.csv` (fallback when no file is loaded)
 */
export function csvFileName(
  fileName: string | null,
  date: Date = new Date(),
): string {
  const timestamp = formatCompactTimestamp(date);
  if (!fileName) return `capture-${timestamp}.csv`;
  const stem = fileName.replace(/\.fvf$/i, "");
  return `${stem}-${timestamp}.csv`;
}
