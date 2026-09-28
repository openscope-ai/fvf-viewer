/**
 * Corpus composition model (issue #25): normalizes the committed synthetic
 * mirror corpus (`crates/fvf-wasm/tests/fixtures/manifest.json`) and — when
 * present — the metadata-only local empirical oracle
 * (`crates/fvf-wasm/tests/fixtures/empirical-local.manifest.json`) into one
 * category taxonomy — acceptance/rejection categories per architecture.md
 * §3.1 — so the conformance gate can report and enforce corpus composition.
 *
 * The empirical manifest is PRIVATE infrastructure (open-source policy,
 * issue #109): published snapshots exclude it, and this module renders a
 * synthetic-only report in that mode. Pure functions over parsed manifest
 * JSON (no I/O): tests and tooling read the manifest files and pass them in.
 */

/** Deterministic category ids, stable across corpus growth. */
export const CATEGORY_LABELS = {
  "accepted:waveform-decode":
    "Accepted · waveform decode (sub-second baseline)",
  "accepted:comma-decimal-timebase":
    "Accepted · comma-decimal localized timebase",
  "accepted:minute-roll-mode": "Accepted · minute roll-mode timebase",
  "accepted:nonsequential-channels": "Accepted · non-sequential channel set",
  "accepted:derived-record": "Accepted · derived (math) record",
  "accepted:unaligned-payload": "Accepted · unaligned payload offset",
  "accepted:envelope-low": "Accepted · envelope low bound (≤500 points)",
  "accepted:envelope-high": "Accepted · envelope high bound (≥250,000 points)",
  "rejected:invalid_signature": "Rejected · invalid file signature",
  "rejected:invalid_timebase_format": "Rejected · invalid timebase format",
  "rejected:invalid_timebase_range": "Rejected · timebase out of range",
  "unsupported:capture-variant": "Unsupported · capture variant",
} as const;

export type CategoryId = keyof typeof CATEGORY_LABELS;

export interface CorpusEntry {
  file: string;
  kind: "synthetic" | "empirical";
  outcome: "accepted" | "rejected" | "unsupported";
  letters: string[];
  hasDerived: boolean;
  physicalSamples: number[];
  timebaseRaw?: string;
  secondsPerDiv?: number;
  payloadOffset?: number;
  errorCode?: string;
  categories: CategoryId[];
}

interface ManifestChannel {
  letter?: string | null;
  derived?: boolean;
  samples?: number;
}

interface SyntheticFixture {
  file: string;
  provenance?: {
    kind?: string;
    parameters?: { payloadStartOffset?: number };
  };
  expected: {
    outcome?: string;
    channels?: ManifestChannel[];
    timebaseRaw?: string;
    secondsPerDiv?: number;
    expectedErrorCode?: string;
  };
}

interface EmpiricalRecord {
  letter?: string | null;
  derived?: boolean;
  samples?: number;
}

interface EmpiricalCapture {
  file: string;
  expected: {
    variant?: string;
    records?: EmpiricalRecord[];
    timebaseRaw?: string;
    secondsPerDiv?: number;
    expectedErrorCode?: string;
  };
}

function isConsecutiveFromA(letters: string[]): boolean {
  return letters.every(
    (letter, index) =>
      letter === String.fromCharCode("A".charCodeAt(0) + index),
  );
}

/** Category detection shared by both corpus kinds (§3.1 taxonomy). */
export function detectCategories(
  entry: Omit<CorpusEntry, "categories">,
): CategoryId[] {
  const categories = new Set<CategoryId>();
  if (entry.outcome === "rejected") {
    const code = entry.errorCode ?? "unknown";
    const key = `rejected:${code}` as CategoryId;
    if (key in CATEGORY_LABELS) {
      categories.add(key);
    }
    return [...categories];
  }
  if (entry.outcome === "unsupported") {
    categories.add("unsupported:capture-variant");
    return [...categories];
  }

  categories.add("accepted:waveform-decode");
  if (entry.timebaseRaw?.includes(",")) {
    categories.add("accepted:comma-decimal-timebase");
  }
  if ((entry.secondsPerDiv ?? 0) >= 60) {
    categories.add("accepted:minute-roll-mode");
  }
  if (entry.letters.length > 0 && !isConsecutiveFromA(entry.letters)) {
    categories.add("accepted:nonsequential-channels");
  }
  if (entry.hasDerived) {
    categories.add("accepted:derived-record");
  }
  if (entry.payloadOffset !== undefined && entry.payloadOffset % 4 !== 0) {
    categories.add("accepted:unaligned-payload");
  }
  if (entry.physicalSamples.some((samples) => samples <= 500)) {
    categories.add("accepted:envelope-low");
  }
  if (entry.physicalSamples.some((samples) => samples >= 250_000)) {
    categories.add("accepted:envelope-high");
  }
  return [...categories].sort();
}

function fromSynthetic(fixture: SyntheticFixture): CorpusEntry {
  const channels = fixture.expected.channels ?? [];
  const physical = channels.filter((channel) => !channel.derived);
  const base: Omit<CorpusEntry, "categories"> = {
    file: fixture.file.replace(/^synthetic\//, ""),
    kind: "synthetic",
    outcome:
      fixture.expected.outcome === "accepted"
        ? "accepted"
        : fixture.expected.outcome === "unsupported"
          ? "unsupported"
          : "rejected",
    letters: physical
      .map((channel) => channel.letter)
      .filter((letter): letter is string => typeof letter === "string"),
    hasDerived: channels.some((channel) => channel.derived),
    physicalSamples: physical
      .map((channel) => channel.samples)
      .filter((samples): samples is number => typeof samples === "number"),
    timebaseRaw: fixture.expected.timebaseRaw,
    secondsPerDiv: fixture.expected.secondsPerDiv,
    payloadOffset: fixture.provenance?.parameters?.payloadStartOffset,
    errorCode: fixture.expected.expectedErrorCode,
  };
  return { ...base, categories: detectCategories(base) };
}

function fromEmpirical(capture: EmpiricalCapture): CorpusEntry {
  const records = capture.expected.records ?? [];
  const physical = records.filter((record) => !record.derived);
  const base: Omit<CorpusEntry, "categories"> = {
    file: capture.file,
    kind: "empirical",
    outcome:
      capture.expected.variant === "waveform" ? "accepted" : "unsupported",
    letters: physical
      .map((record) => record.letter)
      .filter((letter): letter is string => typeof letter === "string"),
    hasDerived: records.some((record) => record.derived),
    physicalSamples: physical
      .map((record) => record.samples)
      .filter((samples): samples is number => typeof samples === "number"),
    timebaseRaw: capture.expected.timebaseRaw,
    secondsPerDiv: capture.expected.secondsPerDiv,
    payloadOffset: undefined,
    errorCode: capture.expected.expectedErrorCode,
  };
  return { ...base, categories: detectCategories(base) };
}

export interface CompositionReport {
  syntheticTotal: number;
  empiricalTotal: number;
  /** Per-category corpus counts; every taxonomy category is present. */
  rows: Array<{
    category: CategoryId;
    label: string;
    synthetic: CorpusEntry[];
    empirical: CorpusEntry[];
  }>;
  /** Synthetic fixtures that matched no taxonomy category (must stay empty). */
  uncategorizedSynthetic: CorpusEntry[];
}

export function buildComposition(
  syntheticManifest: { fixtures?: SyntheticFixture[] },
  empiricalManifest?: { captures?: EmpiricalCapture[] },
): CompositionReport {
  const synthetic = (syntheticManifest.fixtures ?? []).map(fromSynthetic);
  const empirical = (empiricalManifest?.captures ?? []).map(fromEmpirical);

  const rows = (Object.keys(CATEGORY_LABELS) as CategoryId[]).map(
    (category) => ({
      category,
      label: CATEGORY_LABELS[category],
      synthetic: synthetic.filter((entry) =>
        entry.categories.includes(category),
      ),
      empirical: empirical.filter((entry) =>
        entry.categories.includes(category),
      ),
    }),
  );

  const uncategorizedSynthetic = synthetic.filter(
    (entry) => entry.categories.length === 0,
  );

  return {
    syntheticTotal: synthetic.length,
    empiricalTotal: empirical.length,
    rows,
    uncategorizedSynthetic,
  };
}

/** Renders the committed coverage report (conformance-coverage.md). */
export function renderCoverageMarkdown(report: CompositionReport): string {
  const lines: string[] = [];
  lines.push("# Parser conformance corpus coverage");
  lines.push("");
  lines.push(
    "Corpus composition per acceptance/rejection category (architecture.md",
    "§3.1 taxonomy), generated from the committed fixtures manifest and the",
    "metadata-only local empirical oracle — `apps/web/src/conformance/",
    "corpusComposition.ts` renders this file; the corpus coverage test",
    "(`apps/web/src/conformance/corpusCoverage.test.ts`) fails when this",
    "document is out of sync with the manifests, so it can never drift.",
  );
  lines.push("");
  lines.push(
    `- Synthetic mirror corpus (committed, byte-exact ` +
      `\`synth.rs\` output, CI-enforced on the wasm32 target): **${report.syntheticTotal} fixtures**`,
  );
  if (report.empiricalTotal > 0) {
    lines.push(
      "- Empirical captures (local-only per ADR 0006, never committed; " +
        `counts from the metadata oracle): **${report.empiricalTotal} captures**`,
    );
    lines.push("");
    lines.push(
      "| Category | Synthetic (CI-enforced) | Empirical (local-only) |",
    );
    lines.push("| :-- | --: | --: |");
    for (const row of report.rows) {
      lines.push(
        `| ${row.label} | ${row.synthetic.length} (${row.synthetic
          .map((entry) => "`" + entry.file + "`")
          .join(", ")}) | ${row.empirical.length}${
          row.empirical.length > 0
            ? " (" +
              row.empirical.map((entry) => "`" + entry.file + "`").join(", ") +
              ")"
            : ""
        } |`,
      );
    }
  } else {
    // Published-snapshot mode: the private empirical oracle is absent, so
    // the report covers the committed synthetic corpus only (issue #109).
    lines.push("");
    lines.push("| Category | Synthetic (CI-enforced) |");
    lines.push("| :-- | --: |");
    for (const row of report.rows) {
      lines.push(
        `| ${row.label} | ${row.synthetic.length} (${row.synthetic
          .map((entry) => "`" + entry.file + "`")
          .join(", ")}) |`,
      );
    }
  }
  lines.push("");
  lines.push(
    "CI enforcement: the wasm32 conformance suite executes **every**",
    "committed fixture through the actual wasm-bindgen `parse_capture`",
    "engine (exact manifest count, no skips) and asserts each expected",
    "outcome — 100 % fixture pass rate on the wasm target is a hard CI",
    "gate. Where present, local-only empirical captures run through the",
    "same expectations via the Rust local-corpus suite",
    "(`crates/fvf-wasm/tests/local_corpus.rs`, ADR 0006).",
  );
  lines.push("");
  return lines.join("\n");
}
