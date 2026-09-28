/**
 * Corpus coverage report gate (issue #25): builds the corpus composition
 * (empirical vs synthetic per acceptance/rejection category) from the two
 * committed manifests, enforces complete category coverage by the committed
 * synthetic mirror corpus, and verifies the committed coverage document
 * (docs/conformance-coverage.md) matches the generated report so it can
 * never drift from the manifests.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CATEGORY_LABELS,
  buildComposition,
  renderCoverageMarkdown,
  type CategoryId,
} from "./corpusComposition";

const fixturesDir = fileURLToPath(
  new URL("../../../../crates/fvf-wasm/tests/fixtures", import.meta.url),
);

const syntheticManifest = JSON.parse(
  readFileSync(`${fixturesDir}/manifest.json`, "utf8"),
);

// The empirical oracle is private infrastructure (open-source policy): it
// is present in the development repo and excluded from published
// snapshots, so every empirical assertion below runs only when it exists.
const empiricalManifestPath = `${fixturesDir}/empirical-local.manifest.json`;
const empiricalManifest = existsSync(empiricalManifestPath)
  ? JSON.parse(readFileSync(empiricalManifestPath, "utf8"))
  : undefined;

const committedReportPath = fileURLToPath(
  new URL("../../../../docs/conformance-coverage.md", import.meta.url),
);

const report = buildComposition(syntheticManifest, empiricalManifest);

describe("corpus composition coverage report (issue #25)", () => {
  it("lists every taxonomy category with its empirical vs synthetic composition", () => {
    const categoryIds = report.rows.map((row) => row.category);
    expect(categoryIds.sort()).toEqual(
      [...Object.keys(CATEGORY_LABELS)].sort(),
    );
    // Each row carries the full fixture names for both corpus kinds.
    for (const row of report.rows) {
      for (const entry of [...row.synthetic, ...row.empirical]) {
        expect(entry.file.length).toBeGreaterThan(0);
      }
    }
  });

  it("covers every acceptance/rejection category with at least one committed synthetic fixture", () => {
    // The mirror corpus is the CI-enforced substrate: every §3.1 category
    // must be reachable on the wasm target even without local captures.
    const uncovered = report.rows.filter((row) => row.synthetic.length === 0);
    expect(
      uncovered.map((row) => row.category),
      "categories with no committed synthetic fixture",
    ).toEqual([]);
  });

  it("leaves no synthetic fixture outside the taxonomy", () => {
    expect(report.uncategorizedSynthetic).toEqual([]);
  });

  it.skipIf(!empiricalManifest)(
    "documents the empirical corpus honestly (local-only counts from the metadata oracle)",
    () => {
      // Every empirical capture appears in at least one category.
      const counted = new Set(
        report.rows.flatMap((row) => row.empirical.map((entry) => entry.file)),
      );
      expect(counted.size).toBe(report.empiricalTotal);
      expect(report.empiricalTotal).toBeGreaterThanOrEqual(11);
    },
  );

  it.skipIf(!empiricalManifest)(
    "mirrors the empirical shape space: DE comma-decimal and non-sequential captures have empirical anchors",
    () => {
      const byCategory = new Map(
        report.rows.map((row) => [row.category, row] as const),
      );
      const count = (category: CategoryId, side: "synthetic" | "empirical") =>
        byCategory.get(category)?.[side].length ?? 0;
      expect(
        count("accepted:comma-decimal-timebase", "empirical"),
      ).toBeGreaterThan(0);
      expect(
        count("accepted:nonsequential-channels", "empirical"),
      ).toBeGreaterThan(0);
      expect(count("accepted:derived-record", "empirical")).toBe(1);
      expect(count("unsupported:capture-variant", "empirical")).toBe(1);
    },
  );

  it("renders a synthetic-only report when the private empirical oracle is absent (published-snapshot mode)", () => {
    const published = buildComposition(syntheticManifest, undefined);
    const markdown = renderCoverageMarkdown(published);
    expect(published.empiricalTotal).toBe(0);
    expect(markdown).not.toContain("Empirical (local-only)");
    expect(markdown).toContain("Synthetic (CI-enforced)");
    // The taxonomy assertions still hold for the synthetic corpus.
    expect(
      published.rows.filter((row) => row.synthetic.length === 0).length,
    ).toBe(0);
    expect(published.uncategorizedSynthetic).toEqual([]);
  });

  it.skipIf(!existsSync(committedReportPath))(
    "keeps docs/conformance-coverage.md in sync with the manifests",
    () => {
      const committed = readFileSync(committedReportPath, "utf8");
      expect(
        committed,
        "docs/conformance-coverage.md is stale — regenerate it from " +
          "buildComposition(...) via renderCoverageMarkdown and commit",
      ).toBe(renderCoverageMarkdown(report));
    },
  );
});
