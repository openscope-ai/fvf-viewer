import { describe, expect, it } from "vitest";
import {
  buildDisplayData,
  channelFitRange,
  describeChannelMeta,
  formatCanonicalPerDiv,
  formatChannelValue,
  getDerivedChannelUnit,
  getPhysicalChannelUnit,
  normalizeUnit,
  splitUnit,
  UNIT_FALLBACK,
  yScaleKey,
} from "./channelUnits";
import type { ParsedCapture } from "../types/capture";

function captureWithUnits(
  infos: Array<{
    name: string;
    label: string;
    derived: boolean;
    unit?: string;
    perDiv?: number;
    windowMin?: number;
    windowMax?: number;
    saturatedSamples?: number;
  }>,
): ParsedCapture {
  return {
    timestamps: new Float32Array([0, 1]),
    channels: infos
      .filter((info) => !info.derived)
      .map((info) => ({
        name: info.name,
        label: info.label,
        derived: false,
        data: new Float32Array([0, 1]),
      })),
    derivedChannels: [],
    warnings: [],
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "10 ms/Div",
      secondsPerDiv: 0.01,
      timestamp14: "",
      samples: 2,
      deltaT: 1,
      channels: infos.map((info) => ({
        name: info.name,
        label: info.label,
        derived: info.derived,
        samples: 2,
        deltaT: 1,
        unit: info.unit,
        perDiv: info.perDiv,
        windowMin: info.windowMin,
        windowMax: info.windowMax,
        saturatedSamples: info.saturatedSamples,
      })),
    },
  };
}

describe("channel unit helpers (issue #106)", () => {
  it("folds empty units to the explicit raw fallback", () => {
    expect(normalizeUnit(undefined)).toBe(UNIT_FALLBACK);
    expect(normalizeUnit("")).toBe(UNIT_FALLBACK);
    expect(normalizeUnit("   ")).toBe(UNIT_FALLBACK);
    expect(normalizeUnit("mA")).toBe("mA");
    expect(UNIT_FALLBACK).toBe("raw");
  });

  it("splits one display prefix off known SI bases only", () => {
    expect(splitUnit("V")).toEqual({ base: "V", prefixable: true });
    expect(splitUnit("mA")).toEqual({ base: "A", prefixable: true });
    expect(splitUnit("kV")).toEqual({ base: "V", prefixable: true });
    expect(splitUnit("µV")).toEqual({ base: "V", prefixable: true });
    expect(splitUnit("%")).toEqual({ base: "%", prefixable: false });
    expect(splitUnit("")).toEqual({ base: "raw", prefixable: false });
    expect(splitUnit("arb")).toEqual({ base: "arb", prefixable: false });
    // "min" is a word, not milli-inches: the remainder must be a base.
    expect(splitUnit("min")).toEqual({ base: "min", prefixable: false });
  });

  it("formats values with an explicit unit family", () => {
    expect(formatChannelValue(1.0238125, "A")).toBe("1.024 A");
    expect(formatChannelValue(0.0005, "A")).toBe("500.0 µA");
    // Stored values are base-SI: an mA file unit still formats amperes.
    expect(formatChannelValue(1.0238125, "mA")).toBe("1.024 A");
    expect(formatChannelValue(200, "V")).toBe("200.0 V");
    expect(formatChannelValue(1.5, "")).toBe("1.5 raw");
    expect(formatChannelValue(1.5, undefined)).toBe("1.5 raw");
    expect(formatChannelValue(Number.NaN, "V")).toBe("—");
  });

  it("renders canonical-SI per-division lines", () => {
    expect(formatCanonicalPerDiv(200, "V")).toBe("200 V/Div");
    expect(formatCanonicalPerDiv(50, "A")).toBe("50 A/Div");
    expect(formatCanonicalPerDiv(0.1, "mA")).toBe("100 mA/Div");
    expect(formatCanonicalPerDiv(0.02, "V")).toBe("20 mV/Div");
    expect(formatCanonicalPerDiv(Number.NaN, "V")).toBe("—");
  });

  it("keys one y scale per physical channel", () => {
    expect(yScaleKey(0)).toBe("y0");
    expect(yScaleKey(3)).toBe("y3");
  });

  it("resolves physical units from the leading metadata entries", () => {
    const capture = captureWithUnits([
      { name: "A", label: "Input A", derived: false, unit: "A" },
      { name: "B", label: "Input B", derived: false, unit: "mA" },
      { name: "C", label: "Input C", derived: false, unit: "" },
    ]);
    expect(getPhysicalChannelUnit(capture, 0)).toBe("A");
    expect(getPhysicalChannelUnit(capture, 1)).toBe("mA");
    expect(getPhysicalChannelUnit(capture, 2)).toBe("raw");
    expect(getPhysicalChannelUnit(capture, 9)).toBe("raw");
  });

  it("inherits derived units only when all sources agree", () => {
    const base = captureWithUnits([
      { name: "A", label: "Input A", derived: false, unit: "V" },
      { name: "B", label: "Input B", derived: false, unit: "V" },
    ]);
    base.derivedChannels = [
      {
        label: "Mathematik A",
        recordLabel: "Mathematik A-B",
        sourceChannels: ["A", "B"],
        samples: 2,
        deltaT: 1,
        data: new Float32Array([0, 1]),
      },
      {
        label: "Mathematik A-?",
        recordLabel: "Mathematik A-?",
        sourceChannels: ["A", "Z"],
        samples: 2,
        deltaT: 1,
        data: new Float32Array([0, 1]),
      },
    ];
    expect(getDerivedChannelUnit(base, 0)).toBe("V");
    expect(getDerivedChannelUnit(base, 1)).toBe("raw");

    const mixed = captureWithUnits([
      { name: "A", label: "Input A", derived: false, unit: "A" },
      { name: "B", label: "Input B", derived: false, unit: "mA" },
    ]);
    mixed.derivedChannels = [
      {
        label: "Mathematik A",
        recordLabel: "Mathematik A-B",
        sourceChannels: ["A", "B"],
        samples: 2,
        deltaT: 1,
        data: new Float32Array([0, 1]),
      },
    ];
    // Verbatim tokens differ (A vs mA): no single unit to inherit.
    expect(getDerivedChannelUnit(mixed, 0)).toBe("raw");
  });

  it("ignores NaN rails when fitting a channel", () => {
    expect(
      channelFitRange(Float32Array.of(1, Number.NaN, -2, Number.NaN, 0.5)),
    ).toEqual({ min: -2, max: 1 });
    expect(channelFitRange(Float32Array.of(Number.NaN))).toBeNull();
    expect(channelFitRange(new Float32Array(0))).toBeNull();
  });

  it("clips saturated samples to the stored window edge by rail polarity", () => {
    const data = Float32Array.of(1, Number.NaN, Number.NaN, -1, Number.NaN);
    const raw = Int32Array.of(
      0,
      2147483647,
      -2147483646,
      0,
      7, // non-rail NaN source: stays a gap
    );
    const display = buildDisplayData(data, raw, -250, 150);
    expect(Array.from(display)).toEqual([1, 150, -250, -1, Number.NaN]);
    // Source buffers are never mutated: readout and CSV keep NaN.
    expect(Number.isNaN(data[1]!)).toBe(true);
  });

  it("leaves NaN gaps when the window is unknown", () => {
    const data = Float32Array.of(Number.NaN);
    const display = buildDisplayData(
      data,
      Int32Array.of(2147483647),
      undefined,
      undefined,
    );
    expect(Number.isNaN(display[0]!)).toBe(true);
  });

  it("describes the per-channel context line for the readout card", () => {
    const capture = captureWithUnits([
      {
        name: "A",
        label: "Input A",
        derived: false,
        unit: "A",
        perDiv: 50,
        windowMin: -250,
        windowMax: 150,
        saturatedSamples: 419,
      },
      {
        name: "B",
        label: "Input B",
        derived: false,
        unit: "mA",
        perDiv: 0.1,
        windowMin: -0.3,
        windowMax: 0.5,
      },
      { name: "C", label: "Input C", derived: false },
    ]);
    expect(describeChannelMeta(capture, 0)).toMatchObject({
      fileUnit: "A",
      baseUnit: "A",
      perDivText: "50 A/Div",
      windowText: "[-250, 150] A",
      saturated: 419,
      line: "A · 50 A/Div · [-250, 150] A · 419 saturated",
    });
    expect(describeChannelMeta(capture, 1).line).toBe(
      "mA · 100 mA/Div · [-0.3, 0.5] A",
    );
    // Legacy captures without metadata hide the context row.
    expect(describeChannelMeta(capture, 2)).toMatchObject({
      fileUnit: "raw",
      line: null,
    });
  });
});
