/**
 * Publish-pipeline step (open-source policy): prepares the CHANGELOG for
 * public snapshots. The private repository keeps the full development
 * history; the public changelog carries the released history — the
 * preamble, the public-history note, every `## [X.Y.Z]` section, and the
 * footer compare links for released versions. Entries still accumulating
 * toward the next release (`## [Working Version]` / `## [Unreleased]`)
 * and their link definitions are dropped: the public repository only ever
 * contains released snapshots (the release step folds working entries
 * into the new version first).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2] ?? "CHANGELOG.md";
const raw = readFileSync(target, "utf8");

const note =
  "*This changelog records the public release history; releases appear " +
  "here as they are published.*";

const lines = raw.split("\n");
const firstVersion = lines.findIndex((line) => /^## \[\d/.test(line));
if (firstVersion === -1) {
  console.log("CHANGELOG has no released sections to publish");
  process.exit(0);
}

// The preamble is everything before the first released section, minus an
// accumulating working section that runs from its heading up to that
// first released section.
const workingHeading = lines.findIndex((line) =>
  /^## \[(Working Version|Unreleased)\]\s*$/.test(line),
);
const preambleEnd = workingHeading === -1 ? firstVersion : workingHeading;
const preamble = lines.slice(0, preambleEnd).join("\n").trimEnd();

// Released sections plus their footer link definitions; working/unreleased
// link definitions are filtered out of the footer block.
const released = lines
  .slice(firstVersion)
  .filter((line) => !/^\[(Working Version|Unreleased)\]:/.test(line))
  .join("\n")
  .trimEnd();

const truncated = `${preamble}\n\n${note}\n\n${released}\n`;

writeFileSync(target, truncated);
// Keep the published file prettier-clean: `pnpm lint` on the public
// snapshot checks markdown formatting too.
execFileSync(
  process.execPath,
  [
    import.meta.resolve("prettier/bin/prettier.cjs").replace("file://", ""),
    "--write",
    target,
  ],
  { stdio: "ignore" },
);
console.log(
  "public CHANGELOG prepared (preamble + note + released sections and links;",
  workingHeading === -1
    ? "no working section present)"
    : "working section dropped)",
);
