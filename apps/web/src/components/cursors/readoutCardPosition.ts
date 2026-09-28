/**
 * Cursor readout card positioning math (issue #58): pure helpers shared by
 * the drag/keyboard interactions, the resize re-clamp effect, and tests.
 * Positions are CSS-pixel offsets relative to the oscilloscope wrapper
 * (the card's positioned offset parent).
 */

/** Strict padding kept between the card and every wrapper edge. */
export const CARD_EDGE_MARGIN_PX = 8;

/** Default anchored position (issue #58 AC): `top: 76px; right: 16px`. */
export const DEFAULT_CARD_TOP_PX = 76;
export const DEFAULT_CARD_RIGHT_PX = 16;

export interface CardPoint {
  top: number;
  left: number;
}

/**
 * Clamps a card position so the card stays fully inside a container of the
 * given dimensions with {@link CARD_EDGE_MARGIN_PX} on every side. Cards
 * larger than the container pin to the top-left margin instead of
 * oscillating.
 */
export function clampCardPosition(
  position: CardPoint,
  containerWidth: number,
  containerHeight: number,
  cardWidth: number,
  cardHeight: number,
  margin: number = CARD_EDGE_MARGIN_PX,
): CardPoint {
  const maxLeft = Math.max(margin, containerWidth - cardWidth - margin);
  const maxTop = Math.max(margin, containerHeight - cardHeight - margin);
  return {
    left: Math.min(Math.max(position.left, margin), maxLeft),
    top: Math.min(Math.max(position.top, margin), maxTop),
  };
}
