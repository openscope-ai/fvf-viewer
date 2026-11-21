import { describe, expect, it } from "vitest";
import {
  buildChannelCatalog,
  isReferenceChannelId,
  makeChannelId,
  normalizeChannelTag,
  parseChannelId,
} from "./channelCatalog";
import type { ParsedCapture } from "../types/capture";

function makeCapture(
  specs: Array<{ name: string; label?: string; unit?: string }>,
): ParsedCapture {
  const n = 10;
  const timestamps = new Float32Array(n);
  for (let i = 0; i < n; i += 1) timestamps[i] = i * 1e-4;
  return {
    timestamps,
    channels: specs.map((s) => ({
      name: s.name,
      label: s.label ?? `Input ${s.name}`,
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
      deltaT: 1e-4,
      channels: specs.map((s) => ({
        name: s.name,
        label: s.label ?? `Input ${s.name}`,
        unit: s.unit ?? "V",
        samples: n,
        deltaT: 1e-4,
        derived: false,
      })),
    },
  };
}

describe("channelCatalog (issue #354)", () => {
  it("normalizes, constructs, and parses canonical ChannelIds", () => {
    expect(normalizeChannelTag("Input A")).toBe("A");
    expect(normalizeChannelTag("  input B  ")).toBe("B");
    expect(normalizeChannelTag("C")).toBe("C");

    const prim = makeChannelId("primary", "A");
    const ref = makeChannelId("reference", "Input C");
    expect(prim).toBe("A");
    expect(ref).toBe("Ref-C");

    expect(isReferenceChannelId(prim)).toBe(false);
    expect(isReferenceChannelId(ref)).toBe(true);
    expect(isReferenceChannelId("Ref-")).toBe(false);

    expect(parseChannelId(prim)).toEqual({ slot: "primary", rawTag: "A" });
    expect(parseChannelId(ref)).toEqual({ slot: "reference", rawTag: "C" });
    expect(parseChannelId("Input D")).toEqual({ slot: "primary", rawTag: "D" });
  });

  it("derives ordered Primary-only PlotChannel descriptors with visibility, selection, units, and colors", () => {
    const primary = makeCapture([
      { name: "A", label: "Input A", unit: "mV" },
      { name: "B", label: "Input B", unit: "A" },
      { name: "D", label: "Input D", unit: "V" },
    ]);

    const catalog = buildChannelCatalog({
      primaryCapture: primary,
      activeChannels: ["A", "D"],
      selectedChannel: "D",
      customNames: { A: "V_bus" },
      theme: "dark",
      customColors: { D: "#112233" },
      keyConfigs: { D: { color: "#112233", opacity: 50 } },
    });

    expect(catalog.channels).toHaveLength(3);
    expect(catalog.primary).toHaveLength(3);
    expect(catalog.reference).toHaveLength(0);

    const [chA, chB, chD] = catalog.channels;
    expect(chA).toMatchObject({
      id: "A",
      slot: "primary",
      rawTag: "A",
      slotIndex: 0,
      channelIndex: 0,
      seriesIdx: 1,
      scaleKey: "y0",
      displayName: "A: V_bus",
      badgeLabel: "A: V_bus",
      axisQuantity: "V_bus",
      customName: "V_bus",
      unit: "mV",
      baseUnit: "V",
      visible: true,
      selected: false,
      color: "#FFD700",
      stroke: "#FFD700",
      displayKey: "A",
      paletteKey: "A",
    });
    expect(chA?.capture).toBe(primary);

    expect(chB).toMatchObject({
      id: "B",
      seriesIdx: 2,
      scaleKey: "y1",
      displayName: "Input B",
      badgeLabel: "B",
      axisQuantity: "B",
      unit: "A",
      baseUnit: "A",
      visible: false,
      selected: false,
    });

    expect(chD).toMatchObject({
      id: "D",
      seriesIdx: 3,
      scaleKey: "y2",
      visible: true,
      selected: true,
      color: "#112233",
      stroke: "rgba(17, 34, 51, 0.50)",
    });

    // Visible lanes exclude hidden channel B and preserve file order
    expect(catalog.visibleLanes().map((c) => c.id)).toEqual(["A", "D"]);
  });

  it("unifies Primary + Reference channels with continuous series indices and scale keys", () => {
    const primary = makeCapture([
      { name: "A", unit: "V" },
      { name: "B", unit: "mA" },
    ]);
    const reference = makeCapture([
      { name: "Input C", unit: "kV" },
      { name: "D", unit: "A" },
    ]);

    const catalog = buildChannelCatalog({
      primaryCapture: primary,
      referenceCapture: reference,
      activeChannels: ["A", "B"],
      selectedChannel: "A",
      refActiveChannels: ["Ref-C"],
      customNames: { "Ref-C": "V_ref" },
      theme: "light",
    });

    expect(catalog.channels.map((c) => c.id)).toEqual([
      "A",
      "B",
      "Ref-C",
      "Ref-D",
    ]);
    expect(catalog.channels.map((c) => c.scaleKey)).toEqual([
      "y0",
      "y1",
      "y2",
      "y3",
    ]);
    expect(catalog.channels.map((c) => c.seriesIdx)).toEqual([1, 2, 3, 4]);

    const refC = catalog.byId("Ref-C");
    expect(refC).not.toBeNull();
    expect(refC).toMatchObject({
      id: "Ref-C",
      slot: "reference",
      rawTag: "C",
      slotIndex: 0,
      channelIndex: 2,
      seriesIdx: 3,
      scaleKey: "y2",
      displayName: "Ref-C: V_ref",
      badgeLabel: "Ref-C: V_ref",
      axisQuantity: "V_ref",
      unit: "kV",
      baseUnit: "V",
      visible: true,
      selected: false,
      color: "#6D4C41",
      displayKey: "Ref-C",
      paletteKey: "Ref-C",
    });
    expect(refC?.capture).toBe(reference);
    expect(refC?.channel).toBe(reference.channels[0]);

    const refD = catalog.byScaleKey("y3");
    expect(refD?.id).toBe("Ref-D");
    expect(refD?.visible).toBe(false);
    expect(catalog.bySeriesIdx(4)).toBe(refD);
    expect(catalog.byId("Ref-A")).toBeNull();
    expect(catalog.byScaleKey("y99")).toBeNull();
    expect(catalog.bySeriesIdx(0)).toBeNull();

    expect(catalog.visibleLanes().map((c) => c.id)).toEqual([
      "A",
      "B",
      "Ref-C",
    ]);
  });

  it("handles null primaryCapture and explicit referenceLaneCount", () => {
    const empty = buildChannelCatalog({
      primaryCapture: null,
      activeChannels: [],
      selectedChannel: null,
    });
    expect(empty.channels).toEqual([]);
    expect(empty.visibleLanes()).toEqual([]);

    const primary = makeCapture([{ name: "A" }]);
    const syntheticTrailing = buildChannelCatalog({
      primaryCapture: primary,
      referenceCapture: null,
      referenceLaneCount: 2,
      activeChannels: ["A"],
      selectedChannel: "A",
      refActiveChannels: ["Ref-A", "Ref-B"],
    });
    expect(syntheticTrailing.channels.map((c) => c.id)).toEqual([
      "A",
      "Ref-A",
      "Ref-B",
    ]);
    expect(syntheticTrailing.reference[0]?.baseUnit).toBe("V");
    expect(syntheticTrailing.reference[0]?.channel).toBeNull();
  });
});
