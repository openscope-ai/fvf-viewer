import { describe, expect, it } from "vitest";
import {
  CARD_EDGE_MARGIN_PX,
  DEFAULT_CARD_RIGHT_PX,
  DEFAULT_CARD_TOP_PX,
  clampCardPosition,
} from "./readoutCardPosition";

describe("clampCardPosition (issue #58)", () => {
  it("keeps interior positions untouched", () => {
    expect(
      clampCardPosition({ top: 100, left: 200 }, 800, 600, 220, 160),
    ).toEqual({ top: 100, left: 200 });
  });

  it("clamps to the 8px margin on every edge", () => {
    expect(CARD_EDGE_MARGIN_PX).toBe(8);
    expect(
      clampCardPosition({ top: -50, left: -50 }, 800, 600, 220, 160),
    ).toEqual({ top: 8, left: 8 });
    expect(
      clampCardPosition({ top: 10_000, left: 10_000 }, 800, 600, 220, 160),
    ).toEqual({ top: 600 - 160 - 8, left: 800 - 220 - 8 });
  });

  it("keeps a card that touches the exact boundary", () => {
    const clamped = clampCardPosition(
      { top: 600 - 160 - 8, left: 800 - 220 - 8 },
      800,
      600,
      220,
      160,
    );
    expect(clamped).toEqual({ top: 432, left: 572 });
  });

  it("pins an oversized card to the top-left margin without oscillation", () => {
    expect(clampCardPosition({ top: 40, left: 40 }, 100, 80, 300, 200)).toEqual(
      { top: 8, left: 8 },
    );
  });

  it("supports a custom margin", () => {
    expect(
      clampCardPosition({ top: 0, left: 0 }, 800, 600, 220, 160, 20),
    ).toEqual({ top: 20, left: 20 });
  });

  it("documents the default anchor position (top: 76px, right: 16px)", () => {
    expect(DEFAULT_CARD_TOP_PX).toBe(76);
    expect(DEFAULT_CARD_RIGHT_PX).toBe(16);
  });
});
