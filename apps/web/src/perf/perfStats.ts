/**
 * Pure statistics + baseline helpers for the perf suites (issue #24).
 * Environment-neutral: imported by both the node parse benchmark and the
 * browser interaction benchmark.
 */

import baseline from "./baseline.json";

/** p-quantile of an unsorted numeric sample (nearest-rank, like the AC tests). */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    throw new Error("percentile of empty sample");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(
    sorted.length,
    Math.max(1, Math.ceil(p * sorted.length)),
  );
  return sorted[rank - 1]!;
}

type BaselineFile = Record<string, number>;

const baselineData = baseline as BaselineFile;

/**
 * Soft regression check against the committed baseline: warns above +20 %,
 * never throws. The warning is emitted on both console channels (warn and
 * log) so it surfaces across vitest projects and reporters — see
 * the benchmark documentation ("Regression tracking in CI") for where each
 * project's flags appear and how to inspect them locally. The hard budgets
 * (50 ms parse, per-event 16.6 ms, commit 16.7 ms) are asserted in the
 * suites themselves.
 */
export function checkSoftRegression(
  metric: string,
  valueMs: number,
): { ratio: number; flagged: boolean } {
  const baselineMs = baselineData[metric];
  if (typeof baselineMs !== "number") {
    console.warn(`[perf] no baseline recorded for '${metric}'`);
    return { ratio: Number.NaN, flagged: false };
  }
  const ratio = valueMs / baselineMs;
  if (ratio > 1.2) {
    const line =
      `::warning::[perf] ${metric} regressed >20% over baseline: ` +
      `${valueMs.toFixed(2)}ms vs ${baselineMs.toFixed(2)}ms baseline ` +
      `(x${ratio.toFixed(2)})`;
    console.warn(line);
    console.log(line);
  }
  return { ratio, flagged: ratio > 1.2 };
}

/** Machine-readable result line; the reference run log is parsed into docs. */
export function logResult(
  suite: string,
  metric: string,
  fields: Record<string, number>,
): void {
  console.info(`PERF_RESULT ${JSON.stringify({ suite, metric, ...fields })}`);
}
