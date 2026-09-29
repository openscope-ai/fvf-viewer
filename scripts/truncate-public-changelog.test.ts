/**
 * Regression tests for the publish-pipeline changelog truncation
 * (open-source policy). The public repository's own CI runs
 * `prettier --check .` over the published snapshot, so the truncated
 * changelog must come out prettier-clean and correctly scoped to the
 * public-release history.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// Kept inside the repository tree: prettier enforces markdown formatting for
// files reachable from the working directory, so the verification below runs
// in the same strict mode as `pnpm lint` on the public snapshot.
const outputPath = path.join(
  "scripts",
  "fixtures",
  `.truncated-changelog.${process.pid}.tmp.md`,
);
const absoluteOutputPath = path.join(repoRoot, outputPath);

let output: string;

beforeAll(() => {
  // The script truncates its target in place: stage the private-changelog
  // fixture at the output path, then invoke it exactly how the publish
  // workflow does (tsx CLI + relative target path from the repository root).
  copyFileSync(
    path.join(repoRoot, "scripts", "fixtures", "private-changelog.fixture.md"),
    absoluteOutputPath,
  );
  const run = spawnSync(
    "pnpm",
    ["exec", "tsx", "scripts/truncate-public-changelog.ts", outputPath],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (run.status !== 0) {
    throw new Error(`truncation failed (${run.status}): ${run.stderr}`);
  }
  output = readFileSync(absoluteOutputPath, "utf8");
});

afterAll(() => {
  rmSync(absoluteOutputPath, { force: true });
});

describe("public changelog truncation (AC1)", () => {
  it("emits a single public-history note in prettier-stable underscore emphasis", () => {
    const out = output;
    const noteLines = out
      .split("\n")
      .filter((line) => line.includes("public release history"));
    expect(noteLines).toHaveLength(1);
    expect(noteLines[0]).toBe(
      "_This changelog records the public release history; releases appear " +
        "here as they are published. Public history begins with 0.8.1._",
    );
    expect(out).not.toContain("*This changelog records");
  });

  it("keeps only public-release sections and their links, drops the rest", () => {
    const out = output;
    expect(out).toContain("## [0.8.2] - 2026-09-28");
    expect(out).toContain("## [0.8.1] - 2026-09-27");
    expect(out.indexOf("## [0.8.2]")).toBeLessThan(out.indexOf("## [0.8.1]"));
    expect(out).toContain("# Changelog");
    expect(out).toContain(
      "[Keep a Changelog](https://keepachangelog.com/en/1.1.0/)",
    );
    // Pre-public history stays private; unreleased work never publishes.
    expect(out).not.toContain("[0.8.0]");
    expect(out).not.toContain("[0.7.2]");
    expect(out).not.toContain("Working Version");
    expect(out).not.toContain("Unreleased work");
    // Footer links: kept public compares, first public version -> tag link,
    // pre-public and working links dropped.
    expect(out).toContain(
      "[0.8.2]: https://github.com/openscope-ai/fvf-viewer/compare/v0.8.1...v0.8.2",
    );
    expect(out).toContain(
      "[0.8.1]: https://github.com/openscope-ai/fvf-viewer/releases/tag/v0.8.1",
    );
  });

  it("emits the stable note even for a target outside the repository tree", () => {
    // The published bad changelog was produced by a manual reconciliation
    // run against an absolute path outside the repository, where Prettier's
    // formatting pass leaves asterisk emphasis untouched. The stable note
    // form must therefore come from the script itself, not the normalizer.
    const external = path.join(
      tmpdir(),
      `fvf-truncate-external.${process.pid}.tmp.md`,
    );
    copyFileSync(
      path.join(
        repoRoot,
        "scripts",
        "fixtures",
        "private-changelog.fixture.md",
      ),
      external,
    );
    try {
      const run = spawnSync(
        "pnpm",
        ["exec", "tsx", "scripts/truncate-public-changelog.ts", external],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expect(run.status).toBe(0);
      const out = readFileSync(external, "utf8");
      expect(out).toContain("Public history begins with 0.8.1._");
      expect(out).not.toContain("*This changelog records");
    } finally {
      rmSync(external, { force: true });
    }
  });

  it("produces a changelog that passes prettier --check in-repo", () => {
    // Independent of the script's own embedded verification: the exact check
    // the public snapshot's lint step runs must pass on the truncated file.
    const check = spawnSync(
      "pnpm",
      ["exec", "prettier", "--check", outputPath],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );
    expect(
      check.status === 0 ? null : `prettier --check failed: ${check.stderr}`,
    ).toBeNull();
  });
});
