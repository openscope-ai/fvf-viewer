import { describe, expect, it } from "vitest";
import {
  createTimeAxisAdapter,
  formatScaledTick,
  selectTimeUnit,
  TIME_AXIS_UNITS,
} from "./timeAxis";

describe("zoom-adaptive time axis (issue #63)", () => {
  it("selects the unit from the visible span thresholds", () => {
    expect(selectTimeUnit(150).key).toBe("min"); // >= 120 s
    expect(selectTimeUnit(120).key).toBe("min");
    expect(selectTimeUnit(119.9).key).toBe("s");
    expect(selectTimeUnit(1).key).toBe("s");
    expect(selectTimeUnit(0.999).key).toBe("ms");
    expect(selectTimeUnit(1.1e-3).key).toBe("ms");
    expect(selectTimeUnit(1e-3).key).toBe("ms");
    expect(selectTimeUnit(1e-6).key).toBe("µs");
    expect(selectTimeUnit(0.9e-6).key).toBe("ns");
    expect(selectTimeUnit(1e-9).key).toBe("ns");
    expect(selectTimeUnit(0.5e-9).key).toBe("ps");
  });

  it("covers every unit with a distinct factor and label", () => {
    const keys = TIME_AXIS_UNITS.map((u) => u.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(TIME_AXIS_UNITS.map((u) => u.label)).toEqual([
      "Time (min)",
      "Time (s)",
      "Time (ms)",
      "Time (µs)",
      "Time (ns)",
      "Time (ps)",
    ]);
  });

  it("formats scaled ticks without float noise or trailing zeros", () => {
    const ms = selectTimeUnit(0.05);
    expect(formatScaledTick(0.02, ms)).toBe("20");
    expect(formatScaledTick(-0.04, ms)).toBe("-40");
    expect(formatScaledTick(0, ms)).toBe("0");
    const s = selectTimeUnit(5);
    expect(formatScaledTick(0.3, s)).toBe("0.3"); // 0.30000000000000004 noise
    const min = selectTimeUnit(200);
    expect(formatScaledTick(90, min)).toBe("1.5");
    const µs = selectTimeUnit(0.0005);
    expect(formatScaledTick(12.5e-6, µs)).toBe("12.5");
  });

  it("sync mutates the axis label only when the unit changes", () => {
    const adapter = createTimeAxisAdapter();
    const axes = [{ label: "Time (s)" }];
    const u = { scales: { x: { min: -0.005, max: 0.005 } }, axes };
    adapter.sync(u);
    expect(adapter.unit.key).toBe("ms");
    expect(axes[0]!.label).toBe("Time (ms)");
    // Same unit: label untouched, still scaled by ms.
    adapter.sync({ scales: { x: { min: -0.02, max: 0.02 } }, axes });
    expect(adapter.unit.key).toBe("ms");
    expect(axes[0]!.label).toBe("Time (ms)");
    // Crossing into seconds updates the label in place.
    adapter.sync({ scales: { x: { min: -1, max: 1 } }, axes });
    expect(adapter.unit.key).toBe("s");
    expect(axes[0]!.label).toBe("Time (s)");
    // Tick values are formatted in the active unit.
    expect(adapter.values(null as never, [0.5, 0, -0.5])).toEqual([
      "0.5",
      "0",
      "-0.5",
    ]);
  });

  it("applies hysteresis so boundary dithering cannot flap the unit", () => {
    const adapter = createTimeAxisAdapter();
    const axes = [{ label: "Time (s)" }];
    // First sync adopts unconditionally.
    adapter.sync({ scales: { x: { min: -0.002, max: 0.002 } }, axes });
    expect(adapter.unit.key).toBe("ms");
    // Span just inside the ms range (4 ms) -> stays ms.
    adapter.sync({ scales: { x: { min: -0.002, max: 0.002 } }, axes });
    expect(adapter.unit.key).toBe("ms");
    // Cross into s by a hair (span 1.02 s < 1.05 s): hysteresis holds ms.
    adapter.sync({ scales: { x: { min: -0.51, max: 0.51 } }, axes });
    expect(adapter.unit.key).toBe("ms");
    // Well past the band (span 1.2 s): switches to s.
    adapter.sync({ scales: { x: { min: -0.6, max: 0.6 } }, axes });
    expect(adapter.unit.key).toBe("s");
    // Back down: span 0.96 s (within the band below 1 s): stays s.
    adapter.sync({ scales: { x: { min: -0.48, max: 0.48 } }, axes });
    expect(adapter.unit.key).toBe("s");
    // Span 0.9 s (past the 0.95 band): switches to ms.
    adapter.sync({ scales: { x: { min: -0.45, max: 0.45 } }, axes });
    expect(adapter.unit.key).toBe("ms");
  });

  it("ignores uninitialized scales", () => {
    const adapter = createTimeAxisAdapter();
    const axes = [{ label: "Time (s)" }];
    adapter.sync({ scales: { x: { min: null, max: null } }, axes });
    expect(adapter.unit.key).toBe("s");
    expect(axes[0]!.label).toBe("Time (s)");
  });
});
