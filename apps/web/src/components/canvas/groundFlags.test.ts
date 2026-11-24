import { describe, expect, it } from "vitest";
import {
  groundFlagVerticalFootprint,
  suppressLabelsIntersectingGroundFlag,
} from "./groundFlags";

describe("groundFlag label suppression (Issue #372)", () => {
  it("suppresses tick labels intersecting an unclamped flag and preserves distant labels", () => {
    const flag = {
      clampedY: 150,
      cue: null,
      bandTop: 0,
      bandBottom: 300,
    } as const;
    expect(groundFlagVerticalFootprint(flag)).toEqual({
      top: 145,
      bottom: 155,
    });

    const values = ["10", "5", "0", "-5", "-10"];
    const yPositions = [50, 100, 150, 200, 250];
    expect(
      suppressLabelsIntersectingGroundFlag(values, yPositions, flag, 6.5),
    ).toEqual(["10", "5", null, "-5", "-10"]);
  });

  it("restores previously suppressed labels when the flag moves away and suppresses new intersections", () => {
    const values = ["10", "5", "0", "-5", "-10"];
    const yPositions = [50, 100, 150, 200, 250];

    const movedToFive = {
      clampedY: 103,
      cue: null,
      bandTop: 0,
      bandBottom: 300,
    } as const;
    expect(
      suppressLabelsIntersectingGroundFlag(
        values,
        yPositions,
        movedToFive,
        6.5,
      ),
    ).toEqual(["10", null, "0", "-5", "-10"]);

    const movedBetween = {
      clampedY: 125,
      cue: null,
      bandTop: 0,
      bandBottom: 300,
    } as const;
    expect(
      suppressLabelsIntersectingGroundFlag(
        values,
        yPositions,
        movedBetween,
        6.5,
      ),
    ).toEqual(["10", "5", "0", "-5", "-10"]);
  });

  it("includes chevron reach in edge-clamped up/down footprints", () => {
    const upFlag = {
      clampedY: 104,
      cue: "up",
      bandTop: 100,
      bandBottom: 250,
    } as const;
    expect(groundFlagVerticalFootprint(upFlag)).toEqual({
      top: 94.5,
      bottom: 109,
    });
    expect(
      suppressLabelsIntersectingGroundFlag(
        ["5", "0", "-5"],
        [100, 175, 250],
        upFlag,
        6.5,
      ),
    ).toEqual([null, "0", "-5"]);

    const downFlag = {
      clampedY: 246,
      cue: "down",
      bandTop: 100,
      bandBottom: 250,
    } as const;
    expect(groundFlagVerticalFootprint(downFlag)).toEqual({
      top: 241,
      bottom: 255.5,
    });
    expect(
      suppressLabelsIntersectingGroundFlag(
        ["5", "0", "-5"],
        [100, 175, 250],
        downFlag,
        6.5,
      ),
    ).toEqual(["5", "0", null]);
  });

  it("preserves pre-nulled entries and ignores non-finite positions", () => {
    const flag = {
      clampedY: 150,
      cue: null,
      bandTop: 0,
      bandBottom: 300,
    } as const;
    expect(
      suppressLabelsIntersectingGroundFlag(
        [null, "0", "-5"],
        [50, 150, Number.NaN],
        flag,
        6.5,
      ),
    ).toEqual([null, null, "-5"]);
  });
});
