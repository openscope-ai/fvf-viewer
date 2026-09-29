import { describe, expect, it } from "vitest";
import {
  AXIS_GAP_PX,
  AXIS_LABEL_GAP_PX,
  AXIS_LABEL_SIZE_PX,
  AXIS_SIZE_X_PX,
  AXIS_TICK_SIZE_PX,
  CANVAS_PADDING,
  buildAxesOptions,
  buildYAxisOptions,
  measureYAxisSize,
} from "./axesConfig";

describe("shared uPlot axis geometry & measured sizing (Issue #119 / ADR 0011)", () => {
  it("exports layout geometry constants and CANVAS_PADDING", () => {
    expect(AXIS_SIZE_X_PX).toBe(30);
    expect(AXIS_GAP_PX).toBe(6);
    expect(AXIS_LABEL_GAP_PX).toBe(6);
    expect(AXIS_TICK_SIZE_PX).toBe(10);
    // Issue #144: 20px fits the 6px title gap plus the ~11px rotated
    // glyph ascent with margin, so titles stay clear of neighbor ticks.
    expect(AXIS_LABEL_SIZE_PX).toBe(20);
    expect(CANVAS_PADDING).toEqual([18, 12, 10, 10]);
  });

  it("measures axis size dynamically: short ticks produce compact column with no dead space", () => {
    const shortTicks = ["-2", "-1", "0", "1", "2"];
    const shortSize = measureYAxisSize(shortTicks);

    // Short ticks should be much more compact than the old fixed 72px width
    expect(shortSize).toBeLessThan(50);
    expect(shortSize).toBeGreaterThan(AXIS_TICK_SIZE_PX + AXIS_GAP_PX);
  });

  it("measures axis size dynamically: wide decimal ticks produce sufficient width without overlap", () => {
    const shortTicks = ["0", "1"];
    const wideTicks = ["-120.50", "0.00", "120.50"];

    const shortSize = measureYAxisSize(shortTicks);
    const wideSize = measureYAxisSize(wideTicks);

    // Wide ticks must measure strictly larger than short ticks
    expect(wideSize).toBeGreaterThan(shortSize);
    expect(wideSize).toBeGreaterThanOrEqual(
      AXIS_TICK_SIZE_PX + AXIS_GAP_PX + 40,
    );
  });

  it("handles null or empty tick values with a sensible fallback", () => {
    const emptySize = measureYAxisSize([]);
    const nullSize = measureYAxisSize(null);

    expect(emptySize).toBeGreaterThan(AXIS_TICK_SIZE_PX + AXIS_GAP_PX);
    expect(nullSize).toBe(emptySize);
  });

  it("buildYAxisOptions builds left-edge channel axis with measured sizing function", () => {
    const axis = buildYAxisOptions({
      scaleKey: "y0",
      label: "A (V)",
      color: "#FFD700",
      show: true,
      showGrid: true,
      gridColor: "#222222",
      ticksColor: "#333333",
    });

    expect(axis.scale).toBe("y0");
    expect(axis.side).toBe(3);
    expect(axis.show).toBe(true);
    expect(axis.label).toBe("A (V)");
    expect(axis.labelSize).toBe(AXIS_LABEL_SIZE_PX);
    expect(axis.grid.show).toBe(true);
    expect(axis.ticks.show).toBe(true);
    expect(axis.ticks.size).toBe(AXIS_TICK_SIZE_PX);
    expect(typeof axis.size).toBe("function");

    // Calling the size function returns the measured width
    const fn = axis.size as (self: unknown, values: string[]) => number;
    expect(fn(null, ["-100", "100"])).toBe(measureYAxisSize(["-100", "100"]));
  });

  it("buildAxesOptions builds X and Y axes with shared geometry", () => {
    const [x, y] = buildAxesOptions(
      { axisText: "#888888", grid: "#222222", ticks: "#333333" },
      { x: "Time (s)", y: "Voltage (V)" },
    );
    expect(x.scale).toBe("x");
    expect(x.size).toBe(AXIS_SIZE_X_PX);
    expect(y.scale).toBe("y");
    expect(y.side).toBe(3);
    expect(typeof y.size).toBe("function");
    expect(y.gap).toBe(AXIS_GAP_PX);
    expect(y.labelGap).toBe(AXIS_LABEL_GAP_PX);
  });

  it("AC3: measureYAxisSize uses isolated offscreen context and never mutates passed context font", () => {
    const mockMainCtx = {
      font: "22px system-ui, -apple-system, sans-serif",
      measureText: () => ({ width: 40 }),
    } as unknown as CanvasRenderingContext2D;

    const size = measureYAxisSize(["-120.50", "0.00", "120.50"], mockMainCtx);
    expect(size).toBeGreaterThan(AXIS_TICK_SIZE_PX + AXIS_GAP_PX);
    // Crucial check for AC3: passed main canvas context must not have its font mutated
    expect(mockMainCtx.font).toBe("22px system-ui, -apple-system, sans-serif");
  });
});
