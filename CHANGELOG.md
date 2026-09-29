# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

_This changelog records the public release history; releases appear here as they are published. Public history begins with 0.8.1._

## [0.8.5] - 2026-09-29

### Changed

- Public changelog snapshots now begin at 0.8.1, the first public release: sections for earlier versions document the pre-release development process (and their compare links reference tags that do not exist publicly), so the truncation step keeps only versions at or above an explicit first-public-release baseline, rewrites the first public version's link to its tag, and states the baseline in the public-history note. The public repository's `main` was advanced once with a fast-forward commit applying the trimmed changelog.

### Fixed

- Public CI lint failure on the trimmed changelog: the truncation step emitted its public-history note with asterisk emphasis, which Prettier rewrites to underscore form (the manually published reconciliation commit carried the unrewritten form, so the public repository's `pnpm lint` failed on `CHANGELOG.md`); the note is now emitted directly in the stable underscore form, and the step verifies the truncated file with `prettier --check` so a formatting regression fails the publish loudly instead of surfacing as a red public CI run. A regression test truncates a fixture changelog inside the repository and asserts both the section/link scoping and Prettier-clean output (Ref #198).
- CI and publish workflows no longer run actions on the deprecated Node.js 20 runtime: `actions/checkout` v4→v7, `actions/setup-node` v4→v7, `actions/cache` v4→v6, `pnpm/action-setup` v4→v6, and `actions/upload-artifact` v4→v7 (failure-path E2E artifacts), all verified to target Node 24; the unmaintained `jetli/wasm-pack-action@v0.4.0` (still Node 20) is replaced by `taiki-e/install-action@v2` installing the same pinned `wasm-pack` 0.13.1 from checksummed GitHub releases (Ref #198).
- CI and publish jobs pin `runs-on: ubuntu-24.04` instead of `ubuntu-latest` ahead of the 2026-10-19 runner-image migration to Ubuntu 26, keeping the pipeline on a known image (Ref #198).

## [0.8.4] - 2026-09-29

### Changed

- Desktop Required roadblock heading replaced with the README-style brand header: the logo sits centered on top with the `fvf • viewer` name directly below it in a large font (the "Desktop Required" title is removed); the descriptive message, the 1024px hint, and the Share action are unchanged, and the dialog's accessible name now comes from the app-name heading.

### Fixed

- Public changelog snapshots now carry the released history: the truncation step previously kept only the changelog preamble and public-history note while silently dropping every released section and compare link (contradicting its own documentation), so the public repository's CHANGELOG listed no versions at all; it now keeps all `## [X.Y.Z]` sections and their footer links and drops only accumulating `Working Version`/`Unreleased` content.

## [0.8.3] - 2026-09-29

### Changed

- Desktop Required roadblock minimum width corrected from 1900px back to 1024px: the 1900px bar was calibrated against physical screen width, but browsers report CSS pixels (reduced by OS display scaling, LibreWolf letterboxing, scrollbars, and sidebars), so ordinary 1920px desktops hit the roadblock; the hint now reads "Open this page on a screen wider than 1024px, or try rotating your device." (no phone reaches 1024 CSS px in any orientation, while standard tablets clear it in landscape).

### Fixed

- Release publisher (`publish-public.yml`) now parents each public snapshot commit on the previous public `main` (fast-forwardable history) instead of pushing an orphan replacement, which the public repository's non-fast-forward ruleset correctly rejected — every release after the first would have failed like v0.8.2's run did; the public `main` for v0.8.2 was reconciled with a tree-identical fast-forward commit and the ruleset is untouched.

## [0.8.2] - 2026-09-29

### Added

- Copy control next to the Export PNG button (subtle icon button with a tooltip) that writes the current high-resolution waveform snapshot PNG to the clipboard as an image instead of downloading it; it honors the "Invert for print" toggle, respects the canvas-readback permission gate, shows a transient copied check, and stays hidden on browsers without image clipboard support.
- Production launch operations (pre-batch main work, issue #22): Cloud Run region cutover to `us-central1` (managed TLS domain mapping; documented owner decision), an e2e production smoke-test mode (`FVF_E2E_BASE_URL` runs the suite against the live deployment), the `deploy/launch-checklist.md` operator guide (executed and recorded for the fvf-viewer.com launch), and the owner's successful manual launch pass.
- Public-snapshot publisher hardening (pre-batch main work): the changelog truncation script accepts a target path and Prettier-formats the truncated public changelog, empty `[Unreleased]` sections are omitted from public snapshots, `docs/` is excluded from public snapshots, and README assets moved to `.github/`.

### Changed

- Legal footer disclaimer reworded per the brand name: `fvf • viewer is not affiliated with, endorsed by, or sponsored by Fluke Corporation. Fluke and ScopeMeter are registered trademarks of Fluke Corporation.` (drops the "independent open-source project" clause; overview §4.3 quote updated to match).
- GitHub repository link icon (drop header and metadata banner) restyled to the classic GitHub badge: white-filled circle with the black octocat silhouette (previously a currentColor stroke-only outline).
- Desktop Required roadblock rework for narrow screens (< 1900px, raised from 1024px): the fvf • viewer brand lockup (logo + wordmark) is centered above the "Desktop Required" title, the copy now explains the wide-screen design ("This app is designed for multi-channel waveform analysis on wide screens." / "Open this page on a screen at least 1900px wide or switch your device to portrait mode."), the share action is a "Share" button preceded by a platform-appropriate iconoir share icon (share-ios on iOS, share-android otherwise), and the bottom disclaimer is no longer part of the narrow layout (the compact footer variant is removed).

## [0.8.1] - 2026-09-27

### Changed

- The in-app GitHub links (drop header and metadata banner) point at the canonical public repository `openscope-ai/fvf-viewer` instead of the pre-transfer personal path, which redirected into the private source repository.

### Added

- Open-source readiness: MIT license (`FVF Viewer Contributors`); CHANGELOG refactored to Keep a Changelog 1.1.0 with no issue links; committed prose and metadata genericized to corpus-level references (no capture names, counts, or measurement contexts); the local-corpus and coverage suites degrade gracefully when the private empirical oracle manifest is absent; and a one-way release publisher workflow snapshots each release tag to the public repository as a single orphan commit (private artifacts excluded, internal URLs rewritten, coverage report regenerated synthetic-only).

[0.8.5]: https://github.com/openscope-ai/fvf-viewer/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/openscope-ai/fvf-viewer/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/openscope-ai/fvf-viewer/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/openscope-ai/fvf-viewer/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/openscope-ai/fvf-viewer/releases/tag/v0.8.1
