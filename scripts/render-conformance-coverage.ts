/**
 * Regenerates docs/conformance-coverage.md from the committed manifests.
 * With the private empirical oracle present it renders the full
 * composition report; in published snapshots (oracle excluded per the
 * open-source policy) it renders the synthetic-only variant, keeping the
 * committed document byte-identical to what corpusCoverage.test.ts expects.
 */

import { readFileSync, writeFileSync } from "node:fs";
import {
  buildComposition,
  renderCoverageMarkdown,
} from "../apps/web/src/conformance/corpusComposition";

const dir = "crates/fvf-wasm/tests/fixtures";
const synthetic = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));

let empirical: { captures?: unknown[] } | undefined;
try {
  empirical = JSON.parse(
    readFileSync(`${dir}/empirical-local.manifest.json`, "utf8"),
  );
} catch {
  empirical = undefined;
}

const report = buildComposition(synthetic, empirical);
writeFileSync("docs/conformance-coverage.md", renderCoverageMarkdown(report));
console.log(
  `docs/conformance-coverage.md rendered (${empirical ? "full" : "synthetic-only"} mode)`,
);
