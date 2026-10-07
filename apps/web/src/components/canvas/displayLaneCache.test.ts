import { describe, expect, it } from "vitest";
import { physicalDisplayLane } from "./displayLaneCache";
import type { ParsedCapture } from "../../types/capture";

/**
 * Issue #238: the rail-clipped physical display lanes cache per capture
 * — repeated commits (scrub drags at pointer cadence, typed commits,
 * steppers) must never re-run the O(N) buildDisplayData pass.
 */

function makeCapture(samples: number, channels: string[]): ParsedCapture {
  const chans = channels.map((name, i) => ({
    name,
    label: `Input ${name}`,
    derived: false,
    data: Float32Array.from(
      { length: samples },
      (_, s) => Math.sin(s * 0.01 + i) * 3,
    ),
  }));
  return {
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "1 ms/Div",
      secondsPerDiv: 1e-3,
      timestamp14: "12300020261008",
      samples,
      deltaT: 1e-5,
      channels: chans.map((c) => ({
        name: c.name,
        label: c.label,
        derived: false,
        samples,
        deltaT: 1e-5,
        unit: "V",
      })),
    },
    channels: chans,
    derivedChannels: [],
    timestamps: Float32Array.from({ length: samples }, (_, i) => i * 1e-5),
    warnings: [],
  } as ParsedCapture;
}

describe("physicalDisplayLane cache (issue #238)", () => {
  it("returns the same lane instance for repeated reads of one capture", () => {
    const capture = makeCapture(64, ["A", "B"]);
    const first = physicalDisplayLane(capture, 0);
    expect(physicalDisplayLane(capture, 0)).toBe(first);
    expect(physicalDisplayLane(capture, 1)).not.toBe(first);
  });

  it("a distinct capture object builds its own lanes (WeakMap keyed)", () => {
    const a = physicalDisplayLane(makeCapture(32, ["A"]), 0);
    const b = physicalDisplayLane(makeCapture(32, ["A"]), 0);
    expect(a).not.toBe(b);
  });

  it("rejects out-of-range channel indices", () => {
    const capture = makeCapture(16, ["A"]);
    expect(() => physicalDisplayLane(capture, 7)).toThrow(RangeError);
  });
});
