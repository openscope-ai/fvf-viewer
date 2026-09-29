import { describe, expect, it } from "vitest";
import { buildReadoutRows } from "./readoutSnapshot";
import type { ParsedCapture } from "../../types/capture";

function createCapture(sampleCount = 100): ParsedCapture {
  const timestamps = new Float32Array(sampleCount);
  const chA = new Float32Array(sampleCount);
  const chB = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    timestamps[i] = i * 1e-3;
    chA[i] = 1 + i * 0.01;
    chB[i] = -2 + i * 0.02;
  }
  return {
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "1 ms/Div",
      secondsPerDiv: 1e-3,
      timestamp14: "12300020260912",
      samples: sampleCount,
      deltaT: 1e-3,
      channels: [
        {
          name: "A",
          label: "Input A",
          derived: false,
          samples: sampleCount,
          deltaT: 1e-3,
          unit: "V",
          perDiv: 200,
          windowMin: -800,
          windowMax: 800,
        },
        {
          name: "B",
          label: "Input B",
          derived: false,
          samples: sampleCount,
          deltaT: 1e-3,
          unit: "mA",
          perDiv: 0.1,
          windowMin: -0.3,
          windowMax: 0.5,
        },
      ],
    },
    channels: [
      { name: "A", label: "Input A", derived: false, data: chA },
      { name: "B", label: "Input B", derived: false, data: chB },
    ],
    derivedChannels: [],
    timestamps,
    warnings: [],
  };
}

const COLORS = {
  c1: "#E040FB",
  c2: "#B0B0B0",
  channel: (name: string) => (name === "A" ? "#FFD700" : "#00BFFF"),
};

describe("buildReadoutRows (issue #58 snapshot compositing)", () => {
  it("returns no rows when both cursors are inactive", () => {
    const rows = buildReadoutRows(
      createCapture(),
      { c1Active: false, c1SampleIndex: 0, c2Active: false, c2SampleIndex: 0 },
      ["A", "B"],
      0,
      0.1,
      COLORS,
    );
    expect(rows).toEqual([]);
  });

  it("renders an active cursor header plus per-channel unit-aware rows", () => {
    const rows = buildReadoutRows(
      createCapture(),
      { c1Active: true, c1SampleIndex: 10, c2Active: false, c2SampleIndex: 0 },
      ["A", "B"],
      0,
      0.1,
      COLORS,
    );
    // Header + 2 value rows (channel context rows removed per AC2/AC4).
    expect(rows).toHaveLength(3);
    expect(rows[0]!.cells[0]).toMatchObject({
      text: "C1",
      color: "#E040FB",
      bold: true,
    });
    expect(rows[0]!.cells[1]!.text).toBe("#10");
    // "Input " prefix stripped per AC1
    expect(rows[1]!.cells[0]!.text).toBe("A:");
    expect(rows[1]!.cells[1]!.text).toBe("1.100 V");
    expect(rows[1]!.indent).toBe(true);
    expect(rows[2]!.cells[0]!.text).toBe("B:");
    // Stored values are base-SI: the mA file unit still reads amperes.
    expect(rows[2]!.cells[1]!.text).toBe("-1.800 A");
  });

  it("suppresses hidden channels", () => {
    const rows = buildReadoutRows(
      createCapture(),
      { c1Active: true, c1SampleIndex: 5, c2Active: false, c2SampleIndex: 0 },
      ["A"],
      0,
      0.1,
      COLORS,
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]!.cells[0]!.text).toBe("A:");
    expect(rows[1]!.cells[1]!.text).toBe("1.050 V");
  });

  it("labels differential rows with each channel's base unit and stripped channel names", () => {
    const rows = buildReadoutRows(
      createCapture(),
      { c1Active: true, c1SampleIndex: 10, c2Active: true, c2SampleIndex: 40 },
      ["A", "B"],
      0,
      0.1,
      COLORS,
    );
    const labels = rows.map((row) => row.cells[0]!.text);
    expect(labels).toEqual([
      "C1",
      "A:",
      "B:",
      "C2",
      "A:",
      "B:",
      "Δt:",
      "1/Δt:",
      "ΔV(A):",
      "ΔA(B):",
    ]);
    // chA: 1.4 - 1.1 = 0.3 → 300 mV; chB: -1.2 - -1.8 = 0.6 A → 600 mA.
    expect(rows[8]!.cells[1]!.text).toBe("300.0 mV");
    expect(rows[9]!.cells[1]!.text).toBe("600.0 mA");
  });

  it("honors custom channel names in readout rows (AC1)", () => {
    const rows = buildReadoutRows(
      createCapture(),
      { c1Active: true, c1SampleIndex: 10, c2Active: true, c2SampleIndex: 40 },
      ["A", "B"],
      0,
      0.1,
      COLORS,
      { A: "V_grid" },
    );
    const labels = rows.map((row) => row.cells[0]!.text);
    expect(labels).toEqual([
      "C1",
      "A: V_grid",
      "B:",
      "C2",
      "A: V_grid",
      "B:",
      "Δt:",
      "1/Δt:",
      "ΔV(A: V_grid):",
      "ΔA(B):",
    ]);
  });

  it("marks out-of-view cursor times without the bright value tone", () => {
    const rows = buildReadoutRows(
      createCapture(),
      { c1Active: true, c1SampleIndex: 5, c2Active: false, c2SampleIndex: 0 },
      ["A"],
      0.05,
      0.1,
      COLORS,
    );
    // t = 0.005 s is left of xMin = 0.05 s: header time cell loses #FFFFFF.
    expect(rows[0]!.cells[2]).toMatchObject({ alignRight: true });
    expect(rows[0]!.cells[2]!.color).toBeUndefined();
  });

  it("appends differential rows only when both cursors are active", () => {
    const rows = buildReadoutRows(
      createCapture(),
      { c1Active: true, c1SampleIndex: 10, c2Active: true, c2SampleIndex: 40 },
      [],
      0,
      0.1,
      COLORS,
    );
    const labels = rows.map((row) => row.cells[0]!.text);
    expect(labels).toEqual(["C1", "C2", "Δt:", "1/Δt:"]);
    expect(rows[2]!.cells[1]!.text).toBe("30.00 ms");
    expect(rows[3]!.cells[1]!.text).toBe("33.33 Hz");
  });

  it("clamps sample indices into the valid range", () => {
    const rows = buildReadoutRows(
      createCapture(),
      {
        c1Active: true,
        c1SampleIndex: 9_999,
        c2Active: false,
        c2SampleIndex: 0,
      },
      [],
      0,
      0.1,
      COLORS,
    );
    expect(rows[0]!.cells[1]!.text).toBe("#99");
  });
});
