/**
 * Publish-pipeline step (open-source policy): prepares the CHANGELOG for
 * public snapshots. The private repository keeps the full development
 * history; the public changelog carries only the public-release history —
 * sections for versions at or above the first public release — plus the
 * preamble, the public-history note, and the matching footer links
 * (the first public version links to its tag: its compare base predates
 * the public repository). Entries still accumulating toward the next
 * release (`## [Working Version]` / `## [Unreleased]`) and their link
 * definitions are dropped: the public repository only ever contains
 * released snapshots (the release step folds working entries into the
 * new version first).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * The first version published to the public repository. Earlier sections
 * document the pre-release development process and stay private; their
 * compare links also reference tags that do not exist publicly.
 */
const FIRST_PUBLIC_VERSION = "0.8.1";

const target = process.argv[2] ?? "CHANGELOG.md";
const raw = readFileSync(target, "utf8");

// Underscore emphasis: prettier normalizes `*emphasis*` to `_emphasis_`
// in this file's context, so emit the stable form directly instead of
// relying on the formatting pass below to rewrite it.
const note =
  "_This changelog records the public release history; releases appear " +
  "here as they are published. Public history begins with " +
  `${FIRST_PUBLIC_VERSION}._`;

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return (pa[i] ?? 0) > (pb[i] ?? 0) ? 1 : -1;
  }
  return 0;
}

function isPublicVersion(version: string): boolean {
  return compareVersions(version, FIRST_PUBLIC_VERSION) >= 0;
}

const SECTION_HEADING = /^## \[(\d+\.\d+\.\d+)\]/;
const LINK_DEFINITION = /^\[(\d+\.\d+\.\d+)\]: (.*)$/;

const lines = raw.split("\n");
const firstVersion = lines.findIndex((line) => SECTION_HEADING.test(line));
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

// Keep released sections at or above the first public version, plus the
// footer link block; pre-public links are dropped and the first public
// version's compare link (whose base tag is not public) becomes a tag
// link. Working/unreleased link definitions are filtered out too.
// Section bodies follow their heading: a body line is kept only while the
// most recent released heading was kept, so excluded sections drop whole.
const kept: string[] = [];
let keeping = false;
for (const line of lines.slice(firstVersion)) {
  const section = SECTION_HEADING.exec(line);
  if (section) {
    keeping = isPublicVersion(section[1]!);
    if (keeping) kept.push(line);
    continue;
  }
  const link = LINK_DEFINITION.exec(line);
  if (link) {
    const [, version, url] = link;
    if (isPublicVersion(version!)) {
      const publicUrl =
        version === FIRST_PUBLIC_VERSION && url!.includes("/compare/")
          ? url!.replace(/\/compare\/.*$/, `/releases/tag/v${version}`)
          : url!;
      kept.push(`[${version}]: ${publicUrl}`);
    }
    continue;
  }
  if (/^\[(Working Version|Unreleased)\]:/.test(line)) continue;
  if (keeping) kept.push(line);
}

const truncated = `${preamble}\n\n${note}\n\n${kept.join("\n").trimEnd()}\n`;

writeFileSync(target, truncated);
// Keep the published file prettier-clean: `pnpm lint` on the public
// snapshot checks markdown formatting too. Normalize once, then verify
// loudly — a changelog that still fails the check must fail this publish
// step here, not the public repository's CI downstream.
const prettierBin = import.meta
  .resolve("prettier/bin/prettier.cjs")
  .replace("file://", "");
execFileSync(process.execPath, [prettierBin, "--write", target], {
  stdio: "ignore",
});
execFileSync(process.execPath, [prettierBin, "--check", target], {
  stdio: "inherit",
});
console.log(
  `public CHANGELOG prepared (sections >= ${FIRST_PUBLIC_VERSION};`,
  workingHeading === -1
    ? "no working section present)"
    : "working section dropped)",
);
