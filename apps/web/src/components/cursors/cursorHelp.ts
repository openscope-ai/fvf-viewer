import type { CursorId, HorizontalCursorId } from "../../state/cursorStore";

/**
 * Concise cursor movement controls summary used for button titles and aria-labels.
 */
export const CURSOR_MOVEMENT_SUMMARY =
  "Ctrl+Drag or Ctrl+Click to move, Ctrl+Wheel or Ctrl+Arrow keys to step";

export const HORIZONTAL_CURSOR_MOVEMENT_SUMMARY =
  "Drag line or handle to adjust amplitude, Ctrl+Up/Down arrows to micro-step";

/**
 * Multi-line guide explaining cursor movement controls in detail.
 */
export const CURSOR_MOVEMENT_GUIDE =
  "Cursor Movement Controls:\n• Ctrl + Drag: Move active cursor smoothly\n• Ctrl + Click: Snap active cursor to pointer\n• Ctrl + Mousewheel: Step active cursor sample-by-sample\n• Ctrl + Arrow keys: Step active cursor";

/**
 * Get handle title for canvas cursor lines.
 */
export function getCursorHandleTitle(
  id: CursorId | HorizontalCursorId,
): string {
  if (id === "Y1" || id === "Y2") {
    return `Horizontal Cursor ${id}\n• Drag: Move amplitude level\n• Ctrl + Up/Down: Micro-step amplitude level`;
  }
  return `Cursor ${id}\n• Ctrl + Drag: Move cursor smoothly\n• Ctrl + Click: Snap cursor to pointer\n• Ctrl + Mousewheel: Step sample-by-sample\n• Ctrl + Arrow keys: Step sample`;
}

/**
 * Get handle aria-label for canvas cursor lines.
 */
export function getCursorHandleAriaLabel(
  id: CursorId | HorizontalCursorId,
): string {
  if (id === "Y1" || id === "Y2") {
    return `Horizontal Cursor ${id}: ${HORIZONTAL_CURSOR_MOVEMENT_SUMMARY}`;
  }
  return `Cursor ${id}: ${CURSOR_MOVEMENT_SUMMARY}`;
}
