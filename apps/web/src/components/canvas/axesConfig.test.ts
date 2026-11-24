import { describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";
import {
  AXIS_GAP_PX,
  AXIS_LABEL_GAP_PX,
  AXIS_LABEL_SIZE_PX,
  AXIS_SIZE_X_PX,
  AXIS_TICK_SIZE_PX,
  CANVAS_PADDING,
  buildChartSpec,
  cssPxRatio,
  measureYAxisSize,
  syncChartAdapters,
} from "./axesConfig";
import type { ChartRenderState } from "./chartRenderState";
import { buildChannelCatalog } from "../../capture/channelCatalog";
import { createTimeAxisAdapter } from "./timeAxis";
import { createYAxisAdapter, type YAxisAdapter } from "./yAxis";
import { DARK_THEME, LIGHT_THEME } from "./themePalette";
import type { ParsedCapture } from "../../types/capture";

function makeCapture(names: string[], unit = "V"): ParsedCapture {
  const n = 8;
  const timestamps = new Float32Array(n);
  for (let i = 0; i < n; i += 1) timestamps[i] = (i - 4) * 1e-3;
  return {
    timestamps,
    channels: names.map((name) => ({
      name,
      label: `Input ${name}`,
      data: new Float32Array(n),
      derived: false,
    })),
    derivedChannels: [],
    warnings: [],
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "1 ms/Div",
      secondsPerDiv: 1e-3,
      timestamp14: "12000020260101",
      samples: n,
      deltaT: 1e-3,
      channels: names.map((name) => ({
        name,
        label: `Input ${name}`,
        unit,
        samples: n,
        deltaT: 1e-3,
        derived: false,
      })),
    },
  };
}

function makeRenderState(opts: {
  primary: ParsedCapture;
  reference?: ParsedCapture | null;
  activeChannels?: string[];
  selectedChannel?: string | null;
  refActiveChannels?: string[];
  stackMode?: boolean;
  chromeKind: "live" | "print";
  omitGrid?: boolean;
  transparent?: boolean;
  printColors?: string[];
}): ChartRenderState {
  const palette = opts.chromeKind === "live" ? DARK_THEME : LIGHT_THEME;
  const catalog = buildChannelCatalog({
    primaryCapture: opts.primary,
    referenceCapture: opts.reference ?? null,
    activeChannels:
      opts.activeChannels ?? opts.primary.channels.map((c) => c.name),
    selectedChannel:
      opts.selectedChannel ?? opts.primary.channels[0]?.name ?? null,
    refActiveChannels:
      opts.refActiveChannels ??
      opts.reference?.channels.map((c) => `Ref-${c.name}`) ??
      [],
    theme: opts.chromeKind === "live" ? "dark" : "light",
  });
  return {
    capture: opts.primary,
    catalog,
    stackMode: opts.stackMode ?? false,
    laneWeights: {},
    displayConfigs: {},
    chrome: {
      background: palette.background,
      grid: palette.grid,
      ticks: palette.ticks,
      axisText: palette.axisText,
      triggerAccent: palette.triggerAccent,
      triggerGlyphClear: palette.background,
      separatorColor: palette.laneSeparator,
      drawLaneHandles: opts.chromeKind === "live",
      fillBackground: !(opts.transparent ?? false),
      omitGrid: opts.omitGrid ?? false,
      groundFlagText: opts.chromeKind === "live" ? palette.axisText : "#555555",
      channelColor: (ch) => opts.printColors?.[ch.channelIndex] ?? ch.color,
      channelStroke: (ch) => opts.printColors?.[ch.channelIndex] ?? ch.stroke,
    },
  };
}

describe("shared uPlot axis geometry, guarded cssPxRatio & unified chart-spec (Issues #119, #349, #355)", () => {
  it("exports layout geometry constants and CANVAS_PADDING", () => {
    expect(AXIS_SIZE_X_PX).toBe(30);
    expect(AXIS_GAP_PX).toBe(6);
    expect(AXIS_LABEL_GAP_PX).toBe(6);
    expect(AXIS_TICK_SIZE_PX).toBe(10);
    expect(AXIS_LABEL_SIZE_PX).toBe(20);
    expect(CANVAS_PADDING).toEqual([18, 12, 10, 10]);
  });

  it("measures axis size dynamically without mutating passed canvas context font", () => {
    const shortSize = measureYAxisSize(["-2", "-1", "0", "1", "2"]);
    const wideSize = measureYAxisSize(["-120.50", "0.00", "120.50"]);
    expect(shortSize).toBeLessThan(50);
    expect(wideSize).toBeGreaterThan(shortSize);

    const mockMainCtx = {
      font: "22px system-ui, -apple-system, sans-serif",
      measureText: () => ({ width: 40 }),
    } as unknown as CanvasRenderingContext2D;
    measureYAxisSize(["-120.50", "0.00"], mockMainCtx);
    expect(mockMainCtx.font).toBe("22px system-ui, -apple-system, sans-serif");
  });

  it("cssPxRatio guards uncommitted 300x150 HTML5 canvas defaults and computes real DPR ratios", () => {
    const uncommitted = {
      width: 800,
      height: 400,
      ctx: { canvas: { width: 300, height: 150 } },
      constructor: { pxRatio: 2 },
    } as unknown as uPlot;
    expect(cssPxRatio(uncommitted)).toBe(2);

    const committed = {
      width: 800,
      height: 400,
      ctx: { canvas: { width: 1600, height: 800 } },
      constructor: { pxRatio: 1 },
    } as unknown as uPlot;
    expect(cssPxRatio(committed)).toBe(2);
  });

  it("buildChartSpec builds live-chrome Overlay spec for Primary + Reference channels", () => {
    const primary = makeCapture(["A", "B"]);
    const reference = makeCapture(["C"]);
    const state = makeRenderState({
      primary,
      reference,
      activeChannels: ["A", "B"],
      selectedChannel: "B",
      refActiveChannels: ["Ref-C"],
      stackMode: false,
      chromeKind: "live",
    });

    const adapters = new Map<number, YAxisAdapter>();
    state.catalog.channels.forEach((ch) => {
      adapters.set(
        ch.channelIndex,
        createYAxisAdapter({
          quantity: ch.axisQuantity,
          unit: ch.baseUnit,
          scaleKey: ch.scaleKey,
        }),
      );
    });
    const yBounds = new Map([
      ["y0", { min: -5, max: 5 }],
      ["y1", { min: -10, max: 10 }],
      ["y2", { min: -2, max: 2 }],
    ]);

    const opts = buildChartSpec({
      width: 900,
      height: 450,
      xBounds: { min: -4e-3, max: 3e-3 },
      yBounds,
      timeAxis: createTimeAxisAdapter(),
      yAdapters: adapters,
      getRenderState: () => state,
      initAllAxesShown: true,
      selectedScaleKey: "y1",
    });

    // Scales: x + y0, y1 (primary) + y2 (reference)
    expect(Object.keys(opts.scales ?? {})).toEqual(["x", "y0", "y1", "y2"]);
    // Axes: x + reversed primaries (y1, y0) + reversed references (y2)
    expect(opts.axes?.map((a) => a.scale)).toEqual(["x", "y1", "y0", "y2"]);
    // initAllAxesShown initializes every Y axis with show: true (issue #338)
    expect(opts.axes?.slice(1).every((a) => a.show === true)).toBe(true);
    // Only selected primary axis owns the horizontal grid; ref never owns grid
    expect(opts.axes?.[1]?.grid?.show).toBe(true); // y1 (B, selected)
    expect(opts.axes?.[2]?.grid?.show).toBe(false); // y0 (A)
    expect(opts.axes?.[3]?.grid?.show).toBe(false); // y2 (Ref-C)
    // Series: Time + A, B, Ref-C
    expect(opts.series.map((s) => s.scale)).toEqual([
      undefined,
      "y0",
      "y1",
      "y2",
    ]);
    // Dynamic stroke callback reads live chrome color
    const y0Axis = opts.axes?.find((a) => a.scale === "y0");
    const strokeFn = y0Axis?.stroke as () => string;
    expect(strokeFn()).toBe(DARK_THEME.traces.A);
  });

  it("buildChartSpec builds print-chrome Quick-Stack spec honoring omitGrid, visibility, and print colors", () => {
    const primary = makeCapture(["A", "B"]);
    const reference = makeCapture(["A"]);
    const printColors = ["#B8860B", "#1E90FF", "#C2185B"];
    const state = makeRenderState({
      primary,
      reference,
      activeChannels: ["A"],
      selectedChannel: "A",
      refActiveChannels: ["Ref-A"],
      stackMode: true,
      chromeKind: "print",
      omitGrid: true,
      transparent: true,
      printColors,
    });

    const adapters = new Map<number, YAxisAdapter>();
    state.catalog.channels.forEach((ch) => {
      adapters.set(
        ch.channelIndex,
        createYAxisAdapter({
          quantity: ch.axisQuantity,
          unit: ch.baseUnit,
          scaleKey: ch.scaleKey,
        }),
      );
    });

    const opts = buildChartSpec({
      width: 800,
      height: 400,
      xBounds: { min: -4e-3, max: 3e-3 },
      yBounds: new Map([
        ["y0", { min: -1, max: 1 }],
        ["y1", { min: -1, max: 1 }],
        ["y2", { min: -1, max: 1 }],
      ]),
      timeAxis: createTimeAxisAdapter(),
      yAdapters: adapters,
      getRenderState: () => state,
      initAllAxesShown: false,
      selectedScaleKey: "y0",
      drawGroundFlagsInHook: true,
      drawT2InHook: true,
    });

    // omitGrid hides X and Y graticule grids
    expect(opts.axes?.[0]?.grid?.show).toBe(false);
    expect(opts.axes?.slice(1).every((a) => a.grid?.show === false)).toBe(true);
    // Visibility reflects catalog directly when initAllAxesShown is false
    expect(opts.axes?.find((a) => a.scale === "y0")?.show).toBe(true);
    expect(opts.axes?.find((a) => a.scale === "y1")?.show).toBe(false);
    expect(opts.axes?.find((a) => a.scale === "y2")?.show).toBe(true);
    // Print colors override live colors on both axes and series
    const refAxisStroke = opts.axes?.find((a) => a.scale === "y2")
      ?.stroke as () => string;
    expect(refAxisStroke()).toBe("#C2185B");
    expect(opts.series[3]?.stroke).toBe("#C2185B");
  });

  it("syncChartAdapters forwards Stack lane fractions and falls back to full-height in Overlay", () => {
    const primary = makeCapture(["A", "B"]);
    const stackState = makeRenderState({
      primary,
      activeChannels: ["A", "B"],
      stackMode: true,
      chromeKind: "live",
    });
    const overlayState = makeRenderState({
      primary,
      activeChannels: ["A", "B"],
      stackMode: false,
      chromeKind: "live",
    });

    const syncSpy0 = vi.fn();
    const syncSpy1 = vi.fn();
    const adapters = new Map<number, YAxisAdapter>([
      [0, { scaleKey: "y0", sync: syncSpy0 } as unknown as YAxisAdapter],
      [1, { scaleKey: "y1", sync: syncSpy1 } as unknown as YAxisAdapter],
    ]);

    const mockU = {
      width: 800,
      height: 400,
      bbox: { left: 60, top: 20, width: 700, height: 300 },
      ctx: { canvas: { width: 800, height: 400 } },
      constructor: { pxRatio: 1 },
    } as unknown as uPlot;

    syncChartAdapters(mockU, stackState, adapters);
    expect(syncSpy0).toHaveBeenCalledWith(mockU, {
      laneFraction: 0.5,
      bandStart: 0,
    });
    expect(syncSpy1).toHaveBeenCalledWith(mockU, {
      laneFraction: 0.5,
      bandStart: 0.5,
    });

    syncSpy0.mockClear();
    syncSpy1.mockClear();
    syncChartAdapters(mockU, overlayState, adapters);
    expect(syncSpy0).toHaveBeenCalledWith(mockU);
    expect(syncSpy1).toHaveBeenCalledWith(mockU);
  });
});
