import { describe, expect, it } from "vitest";
import { overlayBounds, stackLaneBounds } from "./channelLayout";

/**
 * Issue #98 quick-stack lane geometry: equal lanes, top-first indexing,
 * span widened by the lane count, centers on the lane mid-fractions.
 */

describe("stackLaneBounds (issue #98)", () => {
  it("single lane (or fewer) is the identity window", () => {
    expect(stackLaneBounds({ min: -1, max: 1 }, 0, 1)).toEqual({
      min: -1,
      max: 1,
    });
  });

  it("two lanes: lane 0 centers the trace in the top half", () => {
    const top = stackLaneBounds({ min: -1, max: 1 }, 0, 2);
    // center 0, span 4, centerFraction 0.75 -> min = -3, max = 1.
    expect(top).toEqual({ min: -3, max: 1 });

    const bottom = stackLaneBounds({ min: -1, max: 1 }, 1, 2);
    expect(bottom).toEqual({ min: -1, max: 3 });
  });

  it("keeps each channel's own zoom span and centers the trace in its lane", () => {
    const zoomed = { min: 4, max: 6 }; // trace center 5, span 2
    const lane = stackLaneBounds(zoomed, 2, 4);
    expect(lane.max - lane.min).toBeCloseTo(8, 10);
    // Lane 2 of 4 (0-based, top-first): the trace center renders at
    // fraction 1 - 2.5/4 = 0.375 of the plot height.
    const fraction = (5 - lane.min) / (lane.max - lane.min);
    expect(fraction).toBeCloseTo(0.375, 10);
  });

  it("clamps out-of-range lane indices into the band", () => {
    expect(stackLaneBounds({ min: 0, max: 2 }, 9, 3)).toEqual(
      stackLaneBounds({ min: 0, max: 2 }, 2, 3),
    );
  });

  it("overlay restore returns the saved window unchanged", () => {
    expect(overlayBounds({ min: -2, max: 3 })).toEqual({ min: -2, max: 3 });
  });
});
