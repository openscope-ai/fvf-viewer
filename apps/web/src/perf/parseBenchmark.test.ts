/**
 * Parse wall-time benchmark (issue #24, ADR 0001 budget: < 50 ms): drives
 * the wasm-bindgen `parse_capture` engine over the committed synthetic
 * corpus across the whole 500 – 250,000 point envelope and asserts the
 * per-fixture parse budget. The app runs parsing inside a Web Worker; this
 * benchmark isolates the parse engine itself (the worker round-trip has
 * its own main-thread budget asserted by the issue #9 worker tests).
 *
 * Results and reference hardware are documented in the benchmark
 * documentation;
 * CI tracks a soft > 20 % regression flag against the committed baseline.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import init, { parse_capture } from "@fvf/fvf-wasm";
import { assembleCapture } from "../workers/capturePayload";
import { checkSoftRegression, logResult, percentile } from "./perfStats";

const wasmBytes = new Uint8Array(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../../crates/fvf-wasm/pkg/fvf_wasm_bg.wasm",
        import.meta.url,
      ),
    ),
  ),
);

const fixturesDir = fileURLToPath(
  new URL("../../../../crates/fvf-wasm/tests/fixtures", import.meta.url),
);

/** Envelope fixtures (committed synthetic corpus) with their point counts. */
const ENVELOPE_FIXTURES = [
  { file: "synthetic/extreme-envelope-4ch-500-10ms-div.fvf.bin", points: 500 },
  {
    file: "synthetic/accepted-de-eingang-1ch-3000-comma-decimal.fvf.bin",
    points: 3_000,
  },
  { file: "synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin", points: 10_000 },
  {
    file: "synthetic/extreme-envelope-1ch-250000-10ms-div.fvf.bin",
    points: 250_000,
  },
] as const;

const PARSE_BUDGET_MS = 50;
const WARMUP_RUNS = 3;
const MEASURED_RUNS = 10;

describe("parse benchmark across the 500–250,000 envelope (ADR 0001 budget)", () => {
  it("every envelope fixture parses within the 50 ms budget (p95 of 10 runs)", async () => {
    const engine = await init(wasmBytes);

    for (const { file, points } of ENVELOPE_FIXTURES) {
      const bytes = new Uint8Array(readFileSync(`${fixturesDir}/${file}`));

      // Warm the engine (first-call module instantiation excluded).
      for (let i = 0; i < WARMUP_RUNS; i += 1) {
        const { memory } = engine;
        assembleCapture(memory, parse_capture(bytes));
      }

      const durations: number[] = [];
      for (let i = 0; i < MEASURED_RUNS; i += 1) {
        const t0 = performance.now();
        const { memory } = engine;
        assembleCapture(memory, parse_capture(bytes));
        durations.push(performance.now() - t0);
      }

      const p95 = percentile(durations, 0.95);
      const median = percentile(durations, 0.5);

      logResult("parse", `envelope-${points}`, {
        points,
        medianMs: Math.round(median * 100) / 100,
        p95Ms: Math.round(p95 * 100) / 100,
      });
      checkSoftRegression(`parse.envelope-${points}.p95Ms`, p95);

      expect(
        p95,
        `${file}: p95 parse ${p95.toFixed(2)}ms exceeds the 50ms ADR budget`,
      ).toBeLessThan(PARSE_BUDGET_MS);
    }
  });

  it("parse cost scales sub-linearly across the envelope (250k vs 500 points)", async () => {
    const engine = await init(wasmBytes);

    const measure = (file: string): number => {
      const bytes = new Uint8Array(readFileSync(`${fixturesDir}/${file}`));
      for (let i = 0; i < WARMUP_RUNS; i += 1) {
        const { memory } = engine;
        assembleCapture(memory, parse_capture(bytes));
      }
      const durations: number[] = [];
      for (let i = 0; i < MEASURED_RUNS; i += 1) {
        const t0 = performance.now();
        const { memory } = engine;
        assembleCapture(memory, parse_capture(bytes));
        durations.push(performance.now() - t0);
      }
      return percentile(durations, 0.5);
    };

    const small = measure(
      "synthetic/extreme-envelope-4ch-500-10ms-div.fvf.bin",
    );
    const large = measure(
      "synthetic/extreme-envelope-1ch-250000-10ms-div.fvf.bin",
    );

    logResult("parse", "scaling", {
      smallMedianMs: Math.round(small * 100) / 100,
      largeMedianMs: Math.round(large * 100) / 100,
      ratio: Math.round((large / small) * 100) / 100,
    });

    // 500x the points must not cost 500x the time (linear scan sanity).
    expect(large).toBeLessThan(small * 500);
  });
});
