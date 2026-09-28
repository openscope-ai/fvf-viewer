/**
 * Publish-pipeline step (open-source policy): truncates the CHANGELOG for
 * public snapshots. The private repository keeps the full development
 * history; the public changelog lists only released versions — an empty
 * [Unreleased] section is omitted because the public repository only ever
 * contains released snapshots (entries still accumulating at publish time
 * are rare: the release step folds them into the new version first).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2] ?? "CHANGELOG.md";
const raw = readFileSync(target, "utf8");

const note =
  "*This changelog records the public release history; releases appear " +
  "here as they are published.*\n\n";

const firstVersion = raw.search(/^## \[\d/m);
if (firstVersion === -1) {
  console.log("CHANGELOG has no released sections to truncate");
  process.exit(0);
}

const head = raw.slice(0, firstVersion).trimEnd() + "\n\n";

// Keep only the [Unreleased] link definition from the footer block.
const unreleasedLink = raw
  .split("\n")
  .find((line) => line.startsWith("[Unreleased]:"));

// An empty [Unreleased] heading is dropped; one with entries is kept.
const headingIndex = head.search(/^## \[Unreleased]$/m);
const preamble = headingIndex === -1 ? head : head.slice(0, headingIndex);
const afterHeading =
  headingIndex === -1
    ? ""
    : head.slice(headingIndex).replace(/^## \[Unreleased]\n+/, "");
const hasEntries = afterHeading.trim().length > 0;
const body = hasEntries
  ? `${preamble.trimEnd()}\n\n## [Unreleased]\n\n${note.trimEnd()}\n\n${afterHeading.trim()}`
  : `${preamble.trimEnd()}\n\n${note.trimEnd()}`;

const truncated =
  body.trimEnd() +
  "\n\n" +
  (unreleasedLink && hasEntries ? unreleasedLink + "\n" : "");

writeFileSync(target, truncated);
// Keep the truncated file prettier-clean: `pnpm lint` on the public
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
  `public CHANGELOG truncated (${hasEntries ? "[Unreleased] + entries kept" : "empty [Unreleased] omitted"}),`,
);
