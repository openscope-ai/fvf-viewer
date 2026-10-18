import { describe, expect, it, vi } from "vitest";
import {
  alignedChannels,
  buildCompositeCsvHeaderLines,
  buildCsvHeaderLines,
  compositeCsvFileName,
  csvEscape,
  csvFileName,
  CSV_ROWS_PER_CHUNK,
  exportCaptureCsv,
  exportCompositeCsv,
  formatSampleValue,
  generateCompositeCsvChunks,
  generateCsvChunks,
} from "./csvExport";
import type { ParsedCapture } from "../../types/capture";

function syntheticCapture(overrides?: {
  samples?: number;
  labels?: string[];
  derived?: boolean;
  units?: Array<string | undefined>;
}): ParsedCapture {
  const samples = overrides?.samples ?? 8;
  const labels = overrides?.labels ?? ["Input A", "Input B", "Input D"];
  const timestamps = new Float32Array(samples);
  for (let index = 0; index < samples; index += 1) {
    timestamps[index] = Math.fround((index - samples / 2) * 1.3335e-6);
  }
  const channels = labels.map((label, channelIndex) => ({
    name: label.replace(/^Input /, ""),
    label,
    derived: false,
    data: Float32Array.from({ length: samples }, (_, sample) =>
      Math.fround(
        Math.sin((sample + 1) * (channelIndex + 1.5)) * (channelIndex + 1) +
          0.123,
      ),
    ),
  }));
  return {
    timestamps,
    channels,
    derivedChannels: overrides?.derived
      ? [
          {
            label: "Mathematik A-B",
            recordLabel: "Mathematik A-B",
            sourceChannels: ["A", "B"],
            samples,
            deltaT: 1.3335e-6,
            data: Float32Array.from({ length: samples }, (_, sample) =>
              Math.fround(
                channels[0]!.data[sample]! - channels[1]!.data[sample]!,
              ),
            ),
          },
        ]
      : [],
    warnings: [],
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "500.0 us/Div",
      secondsPerDiv: 500e-6,
      timestamp14: "10152020260912",
      samples,
      deltaT: 1.3335e-6,
      channels: labels.map((label, index) => ({
        name: label.replace(/^Input /, ""),
        label,
        derived: false,
        samples,
        deltaT: 1.3335e-6,
        unit: overrides?.units?.[index],
      })),
    },
  };
}

async function collectCsv(
  capture: ParsedCapture,
  fileName: string | null = "capture.fvf",
): Promise<string> {
  const blob = await exportCaptureCsv(capture, fileName);
  return blob.text();
}

describe("CSV export core (node)", () => {
  it("round-trips values exactly within f32 formatting", async () => {
    const capture = syntheticCapture();
    const csv = await collectCsv(capture);
    const lines = csv.split("\r\n").filter((line) => line.length > 0);
    const dataRows = lines.filter((line) => !line.startsWith("#"));
    const [headerRow, ...rows] = dataRows;

    expect(headerRow).toBe("sample,time_s,Input A,Input B,Input D");
    expect(rows).toHaveLength(capture.timestamps.length);

    rows.forEach((row, sample) => {
      const fields = row.split(",");
      expect(Number(fields[0]!)).toBe(sample);
      expect(Math.fround(parseFloat(fields[1]!))).toBe(
        capture.timestamps[sample]!,
      );
      capture.channels.forEach((channel, channelIndex) => {
        const parsed = parseFloat(fields[2 + channelIndex]!);
        expect(Math.fround(parsed)).toBe(channel.data[sample]!);
        expect(formatSampleValue(channel.data[sample]!)).toBe(
          fields[2 + channelIndex]!,
        );
      });
    });
  });

  it("follows actually detected channel names, including non-sequential sets", async () => {
    const capture = syntheticCapture({
      labels: ["Input A", "Input B", "Input D"],
    });
    const csv = await collectCsv(capture, null);
    expect(csv).toContain("sample,time_s,Input A,Input B,Input D");

    const single = syntheticCapture({ labels: ["Input C"] });
    const singleCsv = await collectCsv(single, null);
    expect(singleCsv).toContain("sample,time_s,Input C");
  });

  it("emits metadata header rows before the data table", async () => {
    const capture = syntheticCapture();
    const csv = await collectCsv(capture, "capture.fvf");
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("# FVF Viewer CSV export");
    expect(csv).toContain("# file: capture.fvf");
    expect(csv).toContain("# captured: 2026-09-12 10:15:20");
    expect(csv).toContain("# timebase: 500.0 us/Div");
    expect(csv).toContain(`# samples: ${capture.timestamps.length}`);
    expect(csv).toContain("# channels: Input A, Input B, Input D");
    expect(csv).toContain("# time_origin: stored time axis");
  });

  it("includes time-axis-aligned derived channels and notes misaligned ones", () => {
    const capture = syntheticCapture({ derived: true });
    const aligned = alignedChannels(capture);
    expect(aligned.map((entry) => entry.header)).toEqual([
      "Input A",
      "Input B",
      "Input D",
      "Mathematik A-B",
    ]);

    const headerLines = buildCsvHeaderLines(capture, null);
    expect(headerLines.join("\n")).toContain(
      "# channels: Input A, Input B, Input D, Mathematik A-B",
    );

    const truncated = syntheticCapture({ derived: true });
    const derived = truncated.derivedChannels[0]!;
    derived.data = derived.data.slice(0, 3);
    derived.samples = 3;
    const misalignedNotes = buildCsvHeaderLines(truncated, null).join("\n");
    expect(misalignedNotes).toContain(
      "# note: Mathematik A-B omitted (3 samples, axis has 8)",
    );
  });

  it("escapes commas and quotes in channel headers", () => {
    expect(csvEscape('Input "A", phase')).toBe('"Input ""A"", phase"');
    expect(csvEscape("Input A")).toBe("Input A");
  });

  it("derives the CSV download name from the capture file name with compact timestamp", () => {
    const fixedDate = new Date(2026, 8, 14, 10, 35, 22);
    expect(csvFileName("capture.fvf", fixedDate)).toBe(
      "capture-20260914-103522.csv",
    );
    expect(csvFileName("CAPTURE.FVF", fixedDate)).toBe(
      "CAPTURE-20260914-103522.csv",
    );
    expect(csvFileName(null, fixedDate)).toBe("capture-20260914-103522.csv");
  });

  it("streams 250,000 points in bounded chunks that yield to the event loop", async () => {
    vi.useRealTimers();
    const capture = syntheticCapture({ samples: 250_000 });
    const chunks: string[] = [];
    let macrotaskTurns = 0;
    const ticker = setInterval(() => {
      macrotaskTurns += 1;
    }, 0);

    const start = performance.now();
    for await (const chunk of generateCsvChunks(
      capture,
      "big.fvf",
      undefined,
      CSV_ROWS_PER_CHUNK,
    )) {
      chunks.push(chunk);
    }
    const elapsed = performance.now() - start;
    clearInterval(ticker);

    const chunkCount = Math.ceil(250_000 / CSV_ROWS_PER_CHUNK);
    expect(chunks).toHaveLength(chunkCount);
    // The event loop regained control between chunks — no main-thread freeze.
    expect(macrotaskTurns).toBeGreaterThanOrEqual(chunkCount - 2);
    expect(elapsed).toBeLessThan(60_000); // hang guard only; freezing is ruled out structurally

    const body = chunks.join("");
    const dataRows = body
      .split("\r\n")
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    expect(dataRows).toHaveLength(250_001); // header row + 250,000 samples
    expect(dataRows[0]).toBe("sample,time_s,Input A,Input B,Input D");

    // Spot-check exact round-trip deep into the stream (last row).
    const lastFields = dataRows[dataRows.length - 1]!.split(",");
    expect(Number(lastFields[0])).toBe(249_999);
    expect(Math.fround(parseFloat(lastFields[2]!))).toBe(
      capture.channels[0]!.data[249_999]!,
    );
  });

  it("emits per-channel traceability with canonical units and sample counts", async () => {
    const capture = syntheticCapture({ units: ["V", "mA", undefined] });
    const lines = buildCsvHeaderLines(capture, "quad.fvf");
    expect(lines).toContain("# channel[0]: label=Input A; unit=V; samples=8");
    expect(lines).toContain(
      "# channel[1]: label=Input B; unit=A; file_unit=mA; samples=8",
    );
    expect(lines).toContain("# channel[2]: label=Input D; unit=raw; samples=8");
  });

  it("keeps data headers verbatim raw labels with no unit affixed", async () => {
    const capture = syntheticCapture({ units: ["V", "mA", "V"] });
    const csv = await collectCsv(capture, "quad.fvf");
    const dataRows = csv
      .split("\r\n")
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    expect(dataRows[0]).toBe("sample,time_s,Input A,Input B,Input D");
    expect(csv).not.toContain("Input A [");
    expect(csv).not.toContain("Input B [");
  });

  it("exports saturated samples as empty cells", async () => {
    const capture = syntheticCapture({ samples: 4 });
    capture.channels[0]!.data[1] = Number.NaN;
    capture.channels[0]!.data[3] = Number.POSITIVE_INFINITY;
    expect(formatSampleValue(Number.NaN)).toBe("");
    const csv = await collectCsv(capture, "quad.fvf");
    const dataRows = csv
      .split("\r\n")
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    expect(dataRows).toHaveLength(5); // header + 4 samples
    const t1 = formatSampleValue(capture.timestamps[1]!);
    const b1 = formatSampleValue(capture.channels[1]!.data[1]!);
    const d1 = formatSampleValue(capture.channels[2]!.data[1]!);
    expect(dataRows[2]).toBe(`1,${t1},,${b1},${d1}`);
    expect(dataRows[4]!.split(",")[2]).toBe("");
    // The time column is never empty: the stored axis carries no NaN.
    for (const row of dataRows.slice(1)) {
      expect(row.split(",")[1]!.length).toBeGreaterThan(0);
    }
  });

  describe("Delimiter support (issue #99)", () => {
    it("escapes semicolons when semicolon delimiter is chosen", () => {
      expect(csvEscape("hello;world", ";")).toBe('"hello;world"');
      expect(csvEscape("hello,world", ";")).toBe("hello,world");
      expect(csvEscape('hello"world', ";")).toBe('"hello""world"');
      expect(csvEscape("hello,world", ",")).toBe('"hello,world"');
      expect(csvEscape("hello;world", ",")).toBe("hello;world");
    });

    it("generates CSV with semicolon delimiter", async () => {
      const capture = syntheticCapture({ samples: 3 });
      const blob = await exportCaptureCsv(capture, "test.fvf", undefined, ";");
      const text = await blob.text();
      const lines = text.split("\r\n").filter((l) => l.length > 0);
      const dataRows = lines.filter((l) => !l.startsWith("#"));
      expect(dataRows[0]).toBe("sample;time_s;Input A;Input B;Input D");
      expect(dataRows[1]).toMatch(/^0;-?\d/);
      expect(dataRows[1]!.split(";")).toHaveLength(5);
    });
  });

  describe("Composite time-aligned CSV export (issue #99)", () => {
    it("formats composite filenames with -vs- and compact timestamps", () => {
      const fixedDate = new Date(2026, 9, 18, 14, 0, 0);
      expect(compositeCsvFileName("run1.fvf", "run2.fvf", fixedDate)).toBe(
        "run1-vs-run2-composite-20261018-140000.csv",
      );
      expect(compositeCsvFileName(null, null, fixedDate)).toBe(
        "capture1-vs-capture2-composite-20261018-140000.csv",
      );
    });

    it("generates composite CSV incorporating time slip Δt and provenance metadata", async () => {
      const primary = syntheticCapture({ samples: 5, labels: ["Input A"] });
      const reference = syntheticCapture({ samples: 5, labels: ["Input B"] });
      // reference lane aligned on primary grid
      const refLane = new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0]);
      const timeSlipSamples = 1; // 1 sample slip right

      const blob = await exportCompositeCsv(
        primary,
        "primary.fvf",
        reference,
        "reference.fvf",
        [refLane],
        timeSlipSamples,
        undefined,
        ",",
      );

      const text = await blob.text();
      const lines = text.split("\r\n").filter((l) => l.length > 0);

      // Verify metadata comments
      expect(lines).toContain(
        "# FVF Viewer CSV export (composite time-aligned)",
      );
      expect(lines).toContain("# file: primary.fvf");
      expect(lines).toContain("# reference_file: reference.fvf");
      expect(lines.some((l) => l.startsWith("# trigger_alignment_dt_s:"))).toBe(
        true,
      );
      expect(lines).toContain("# time_slip_samples: 1");
      expect(lines.some((l) => l.startsWith("# sample_rate_ratio:"))).toBe(
        true,
      );

      // Verify columns
      const dataRows = lines.filter((l) => !l.startsWith("#"));
      expect(dataRows[0]).toBe(
        "sample,time_s,[File 1] Input A,[File 2] Input B",
      );
      expect(dataRows).toHaveLength(6); // 1 header + 5 samples

      // Sample 0: slipped by 1 sample -> src = 0 - 1 = -1 (out of bounds -> empty)
      const row0 = dataRows[1]!.split(",");
      expect(row0[0]).toBe("0");
      expect(row0[2]).toBe(formatSampleValue(primary.channels[0]!.data[0]!));
      expect(row0[3]).toBe(""); // out of bounds before 0

      // Sample 1: slipped src = 1 - 1 = 0 -> refLane[0] = 1.0
      const row1 = dataRows[2]!.split(",");
      expect(row1[0]).toBe("1");
      expect(row1[2]).toBe(formatSampleValue(primary.channels[0]!.data[1]!));
      expect(row1[3]).toBe("1");

      // Sample 2: slipped src = 2 - 1 = 1 -> refLane[1] = 2.0
      const row2 = dataRows[3]!.split(",");
      expect(row2[3]).toBe("2");
    });

    it("supports semicolon delimiter in composite export", async () => {
      const primary = syntheticCapture({ samples: 3, labels: ["Input A"] });
      const reference = syntheticCapture({ samples: 3, labels: ["Input B"] });
      const refLane = new Float32Array([10, 20, 30]);

      const blob = await exportCompositeCsv(
        primary,
        "primary.fvf",
        reference,
        "reference.fvf",
        [refLane],
        0,
        undefined,
        ";",
      );

      const text = await blob.text();
      const lines = text.split("\r\n").filter((l) => l.length > 0);
      const dataRows = lines.filter((l) => !l.startsWith("#"));
      expect(dataRows[0]).toBe(
        "sample;time_s;[File 1] Input A;[File 2] Input B",
      );
      const row0 = dataRows[1]!.split(";");
      expect(row0[0]).toBe("0");
      expect(row0[3]).toBe("10");
    });

    it("builds composite header lines with custom delimiter and metadata", () => {
      const primary = syntheticCapture({ samples: 2, labels: ["Input A"] });
      const reference = syntheticCapture({ samples: 2, labels: ["Input B"] });
      const pCols = alignedChannels(primary);
      const rCols = alignedChannels(reference);
      const headers = buildCompositeCsvHeaderLines(
        primary,
        "p.fvf",
        reference,
        "r.fvf",
        0,
        pCols,
        rCols,
        ";",
      );
      expect(headers).toContain(
        "# FVF Viewer CSV export (composite time-aligned)",
      );
      expect(headers.some((l) => l.startsWith("# file: p.fvf"))).toBe(true);
      expect(headers.some((l) => l.startsWith("# reference_file: r.fvf"))).toBe(
        true,
      );
    });

    it("generates chunks via generateCompositeCsvChunks with chunk boundary", async () => {
      const primary = syntheticCapture({ samples: 4, labels: ["Input A"] });
      const reference = syntheticCapture({ samples: 4, labels: ["Input B"] });
      const chunks: string[] = [];
      for await (const chunk of generateCompositeCsvChunks(
        primary,
        "p.fvf",
        reference,
        "r.fvf",
        [new Float32Array([1, 2, 3, 4])],
        0,
        undefined,
        2,
        ",",
      )) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(1);
    });
  });
});
