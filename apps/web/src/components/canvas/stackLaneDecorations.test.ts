import { describe, expect, it } from "vitest";
import { buildChannelCatalog } from "../../capture/channelCatalog";
import type { ParsedCapture } from "../../types/capture";
import type { LaneLayoutState } from "./chartRenderState";
import {
  isValueAboveRange,
  isValueBelowRange,
  laneFractionRange,
  visibleYRangeForScale,
} from "./stackLaneDecorations";
import { stackLaneBoundsWeighted } from "./viewportController";

function makeTwoChannelCapture(): ParsedCapture {
  const n = 16;
  const timestamps = new Float32Array(n);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  return {
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "10 us/Div",
      secondsPerDiv: 1e-5,
      timestamp14: "12300020260905",
      samples: n,
      deltaT: 1e-5,
      channels: [
        {
          name: "A",
          label: "Input A",
          derived: false,
          samples: n,
          deltaT: 1e-5,
          unit: "V",
        },
        {
          name: "B",
          label: "Input B",
          derived: false,
          samples: n,
          deltaT: 1e-5,
          unit: "mA",
        },
      ],
    },
    channels: [
      { name: "A", label: "Input A", derived: false, data: a },
      { name: "B", label: "Input B", derived: false, data: b },
    ],
    derivedChannels: [],
    timestamps,
    warnings: [],
  };
}

function makeLayoutState(
  stackMode: boolean,
  laneWeights: LaneLayoutState["laneWeights"] = {},
): LaneLayoutState {
  const capture = makeTwoChannelCapture();
  const catalog = buildChannelCatalog({
    primaryCapture: capture,
    referenceCapture: null,
    activeChannels: ["A", "B"],
    selectedChannel: "A",
    refActiveChannels: [],
    customNames: {},
    theme: "dark",
    customColors: {},
    keyConfigs: {},
  });
  return { stackMode, catalog, laneWeights };
}

describe("stackLaneDecorations visible range projection (Issue #364)", () => {
  it("returns full scale in overlay mode", () => {
    const state = makeLayoutState(false);
    expect(laneFractionRange(state, "y0")).toBeNull();
    expect(visibleYRangeForScale(-4, 4, state, "y0")).toEqual({
      min: -4,
      max: 4,
    });
  });

  it("inverts stackLaneBoundsWeighted for equal and weighted lanes", () => {
    const equalState = makeLayoutState(true);
    expect(laneFractionRange(equalState, "y0")).toEqual({
      start: 0,
      fraction: 0.5,
    });
    expect(laneFractionRange(equalState, "y1")).toEqual({
      start: 0.5,
      fraction: 0.5,
    });

    const stackedA = stackLaneBoundsWeighted({ min: -3.3, max: 3.3 }, 0, 0.5);
    const stackedB = stackLaneBoundsWeighted({ min: -1.8, max: 1.8 }, 0.5, 0.5);

    const visA = visibleYRangeForScale(
      stackedA.min,
      stackedA.max,
      equalState,
      "y0",
    );
    const visB = visibleYRangeForScale(
      stackedB.min,
      stackedB.max,
      equalState,
      "y1",
    );
    expect(visA.min).toBeCloseTo(-3.3, 10);
    expect(visA.max).toBeCloseTo(3.3, 10);
    expect(visB.min).toBeCloseTo(-1.8, 10);
    expect(visB.max).toBeCloseTo(1.8, 10);

    // Weighted lanes: A = 1, B = 3 -> A gets 0.25, B gets 0.75
    const weightedState = makeLayoutState(true, { A: 1, B: 3 });
    const stackedAW = stackLaneBoundsWeighted({ min: -5, max: 15 }, 0, 0.25);
    const stackedBW = stackLaneBoundsWeighted({ min: -2, max: 6 }, 0.25, 0.75);

    const visAW = visibleYRangeForScale(
      stackedAW.min,
      stackedAW.max,
      weightedState,
      "y0",
    );
    const visBW = visibleYRangeForScale(
      stackedBW.min,
      stackedBW.max,
      weightedState,
      "y1",
    );
    expect(visAW.min).toBeCloseTo(-5, 10);
    expect(visAW.max).toBeCloseTo(15, 10);
    expect(visBW.min).toBeCloseTo(-2, 10);
    expect(visBW.max).toBeCloseTo(6, 10);
  });

  it("tolerates floating-point edge drift in range checks", () => {
    expect(isValueAboveRange(3.3 + 1e-14, -3.3, 3.3)).toBe(false);
    expect(isValueBelowRange(-3.3 - 1e-14, -3.3, 3.3)).toBe(false);
    expect(isValueAboveRange(3.31, -3.3, 3.3)).toBe(true);
    expect(isValueBelowRange(-3.31, -3.3, 3.3)).toBe(true);
  });
});
