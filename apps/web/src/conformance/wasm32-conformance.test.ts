/**
 * wasm32 conformance gate (issue #9): drives the full committed synthetic
 * corpus through the wasm-bindgen `parse_capture` bridge in the actual
 * wasm32 build (loaded from the wasm-pack pkg via the standard ES
 * module), asserting the fixture manifest's channel/sample/timestamp
 * oracles, typed rejections, standalone-Float32Array payload assembly,
 * and exact agreement between the TS error-code unions and the committed
 * Rust taxonomy mirror
 * (`crates/fvf-wasm/tests/fixtures/error-taxonomy.json`).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import init, { parse_capture } from "@fvf/fvf-wasm";
import { assembleCapture } from "../workers/capturePayload";
import { PARSE_ERROR_CODES, PARSE_WARNING_CODES } from "../types/capture";
import type { ParsedCapture } from "../types/capture";

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

interface ManifestChannel {
  letter: string | null;
  label: string;
  samples?: number;
  derived?: boolean;
  sourceChannels?: string[];
}

interface ManifestTimestamps {
  deltaT: number;
  tFirst: number;
  tLast: number;
  tCenter: number;
  samples: number;
}

interface ManifestExpected {
  outcome: string;
  timebaseRaw?: string;
  secondsPerDiv?: number;
  warnings?: unknown[];
  channels?: ManifestChannel[];
  expectedErrorCode?: string;
  timestamps?: ManifestTimestamps;
}

interface ManifestFixture {
  file: string;
  expected: ManifestExpected;
}

const manifest = JSON.parse(
  readFileSync(`${fixturesDir}/manifest.json`, "utf8"),
) as { fixtures: ManifestFixture[] };

const engine = init(wasmBytes);

async function parseFixture(file: string): Promise<ParsedCapture> {
  const bytes = new Uint8Array(readFileSync(`${fixturesDir}/${file}`));
  const { memory } = await engine;
  const { capture } = assembleCapture(memory, parse_capture(bytes));
  return capture;
}

/** f32-sample-vs-f64-oracle tolerance (one f32 rounding). */
function expectF32(actual: number, want: number, what: string): void {
  expect(
    Math.abs(actual - want) <= Math.abs(want) * 1.0e-6 + 1.0e-9,
    `${what}: ${actual} != ${want}`,
  ).toBeTruthy();
}

const at = (series: Float32Array, index: number): number =>
  series[index] ?? Number.NaN;

describe("wasm32 conformance suite (committed synthetic corpus)", () => {
  const accepted = manifest.fixtures.filter(
    (fixture) => fixture.expected.outcome === "accepted",
  );
  const rejected = manifest.fixtures.filter(
    (fixture) => fixture.expected.outcome !== "accepted",
  );

  it("spans the whole committed corpus (exact manifest count — nothing silently excluded)", () => {
    expect(accepted.length + rejected.length).toBe(manifest.fixtures.length);
    expect(manifest.fixtures.length).toBeGreaterThanOrEqual(11);
    expect(accepted.length).toBeGreaterThanOrEqual(6);
    expect(rejected.length).toBeGreaterThanOrEqual(4);
  });

  it("accounts a 100% fixture pass rate on the wasm target (issue #25 gate)", async () => {
    // Execute every committed fixture once and tally outcomes: the gate
    // passes only when every fixture parses to its manifest expectation.
    // Per-aspect oracles (channels, timestamps, vertical metadata, typed
    // rejections) are asserted by the dedicated tests below; this test
    // pins the aggregate invariant the CI gate reports.
    const { memory } = await engine;
    let passed = 0;
    const failures: string[] = [];
    for (const fixture of manifest.fixtures) {
      const bytes = new Uint8Array(
        readFileSync(`${fixturesDir}/${fixture.file}`),
      );
      const outcome = fixture.expected.outcome;
      try {
        const { capture } = assembleCapture(memory, parse_capture(bytes));
        if (outcome === "accepted") {
          const manifestChannels = fixture.expected.channels ?? [];
          const physical = manifestChannels.filter((c) => !c.derived).length;
          const derived = manifestChannels.filter((c) => c.derived).length;
          expect(capture.channels.length).toBe(physical);
          expect(capture.derivedChannels.length).toBe(derived);
          passed += 1;
        } else {
          // Accepted decode of a fixture expected to fail is a failure.
          failures.push(`${fixture.file}: expected ${outcome} decode`);
        }
      } catch (error) {
        if (outcome !== "accepted") {
          passed += 1;
        } else {
          failures.push(`${fixture.file}: ${(error as Error).message}`);
        }
      }
    }
    expect(failures, `conformance failures: ${failures.join("; ")}`).toEqual(
      [],
    );
    expect(passed).toBe(manifest.fixtures.length);
    expect((passed / manifest.fixtures.length) * 100).toBe(100);
  });

  it("decodes every accepted fixture per the manifest oracle", async () => {
    for (const { file, expected } of accepted.map((f) => ({
      file: f.file,
      expected: f.expected,
    }))) {
      const capture = await parseFixture(file);
      const expectedChannels = expected.channels ?? [];

      const byLabel = new Map(
        capture.metadata.channels.map((channel) => [channel.label, channel]),
      );
      expect(byLabel.size, `${file}: channel count`).toBe(
        expectedChannels.length,
      );

      for (const want of expectedChannels) {
        const info = byLabel.get(want.label);
        expect(info, `${file}: channel ${want.label}`).toBeDefined();
        if (!info) {
          continue;
        }
        expect(info.derived, `${file}: ${want.label} derived`).toBe(
          want.derived ?? false,
        );
        if (want.derived) {
          const derived = capture.derivedChannels.find(
            (channel) => channel.label === want.label,
          );
          expect(derived, `${file}: derived ${want.label}`).toBeDefined();
          expect(derived?.sourceChannels).toEqual(want.sourceChannels ?? []);
        } else {
          expect(info.name, `${file}: ${want.label} letter`).toBe(want.letter);
          expect(info.samples, `${file}: ${want.label} samples`).toBe(
            want.samples,
          );
          const series = capture.channels.find(
            (channel) => channel.label === want.label,
          );
          expect(series?.data).toBeInstanceOf(Float32Array);
          expect(series?.data.length).toBe(want.samples);
        }
      }

      if (expected.timebaseRaw) {
        expect(capture.metadata.timebaseRaw).toBe(expected.timebaseRaw);
      }
      if (expected.secondsPerDiv !== undefined) {
        expect(capture.metadata.secondsPerDiv).toBeCloseTo(
          expected.secondsPerDiv,
          12,
        );
      }
      expect(capture.metadata.timestamp14).toMatch(/^\d{14}$/);

      const oracle = expected.timestamps;
      if (oracle) {
        expect(capture.timestamps).toBeInstanceOf(Float32Array);
        expect(capture.timestamps.length).toBe(oracle.samples);
        expect(capture.metadata.samples).toBe(oracle.samples);
        expect(capture.metadata.deltaT).toBeCloseTo(oracle.deltaT, 12);
        expectF32(
          at(capture.timestamps, Math.floor(oracle.samples / 2)),
          oracle.tCenter,
          `${file}: Display-Center t=0`,
        );
        expectF32(at(capture.timestamps, 0), oracle.tFirst, `${file}: t_first`);
        expectF32(
          at(capture.timestamps, oracle.samples - 1),
          oracle.tLast,
          `${file}: t_last`,
        );
      }

      expect(capture.warnings.length, `${file}: warnings`).toBe(
        (expected.warnings ?? []).length,
      );
      for (const warning of capture.warnings) {
        expect(PARSE_WARNING_CODES).toContain(warning.code);
      }
    }
  });

  it("fails every rejected/unsupported fixture with the manifest code", async () => {
    await engine;
    for (const { file, expected } of rejected.map((f) => ({
      file: f.file,
      expected: f.expected,
    }))) {
      const bytes = new Uint8Array(readFileSync(`${fixturesDir}/${file}`));
      let thrown: unknown;
      try {
        parse_capture(bytes);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `${file}: must throw`).toBeDefined();
      expect(thrown, `${file}: JSON string payload`).toBeTypeOf("string");
      const payload = JSON.parse(thrown as string) as {
        code?: string;
        message?: string;
        details?: string;
      };
      expect(payload.code, `${file}: code`).toBe(expected.expectedErrorCode);
      expect(payload.message).toBeTypeOf("string");
      expect(payload.details).toBeTypeOf("string");
    }
  });

  it("derived channels carry the record-level math relationship", async () => {
    const capture = await parseFixture(
      "synthetic/derived-mathematik-2ch-3000-10ms-div.fvf.bin",
    );
    const physical = capture.channels[0];
    const derived = capture.derivedChannels[0];
    expect(physical?.data.length).toBe(3_000);
    expect(derived?.data.length).toBe(3_000);
    // Manifest rule: record 2 payload = record 1 payload + 4096 raw
    // counts. Issue #104 decodes the physical record as raw x S
    // (S = 0.0625) while the derived record keeps the legacy
    // raw / 65536 estimate — the raw lane proves the +4096 rule
    // survives the whole bridge verbatim.
    expect(physical?.rawCounts).toBeInstanceOf(Int32Array);
    expect(derived?.rawCounts).toBeInstanceOf(Int32Array);
    for (const index of [0, 1, 1_499, 1_500, 2_999]) {
      const raw = physical?.rawCounts?.[index] ?? Number.NaN;
      expect(derived?.rawCounts?.[index] ?? Number.NaN).toBe(raw + 4_096);
      // Both conversions are exact at these magnitudes (dyadic scales,
      // small counts), so the bridge is pinned bit-exactly.
      expect(at(physical?.data ?? new Float32Array(0), index)).toBe(
        raw * 0.0625,
      );
      expect(at(derived?.data ?? new Float32Array(0), index)).toBe(
        (raw + 4_096) / 65_536,
      );
    }
    // The legacy estimate carries its typed warning; nothing saturates.
    expect(capture.warnings.map((warning) => warning.code)).toEqual([
      "derived_legacy_values",
    ]);
    for (const info of capture.metadata.channels) {
      expect(info.saturatedSamples).toBe(0);
    }
  });

  it("TS code unions mirror the committed Rust taxonomy exactly", () => {
    const taxonomy = JSON.parse(
      readFileSync(`${fixturesDir}/error-taxonomy.json`, "utf8"),
    ) as { errors: string[]; warnings: string[] };
    expect([...PARSE_ERROR_CODES].sort()).toEqual([...taxonomy.errors].sort());
    expect([...PARSE_WARNING_CODES].sort()).toEqual(
      [...taxonomy.warnings].sort(),
    );
  });
});
