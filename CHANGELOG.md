# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

_This changelog records the public release history; releases appear here as they are published. Public history begins with 0.8.1._

## [0.9.3] - 2026-10-03

### Added

- Split badge control surface for channel and cursor configuration (issue #204): every channel (A–D) and cursor (C1/C2) toolbar badge is now a compound "Tonal Capsule" group — a primary body target (~80%) keeping the existing show → select → hide cycle and double-click inline rename, plus a secondary 26px gear opening a per-key configuration popover — with identity carried by a `color-mix` tonal fill from the effective trace color (13% active, 22% selected + 1px color ring) instead of border color, borderless padded capsules without divider lines, and separated 2px focus rings per target. The popover (one reusable portal-based anchored primitive owning trigger geometry, viewport collision, and a single `openKey` for mutual exclusivity) follows the reviewed "Rich Header" design: a hero with a 32px color square showing the effective color at the chosen opacity over a checkerboard plus a luminance-aware pencil toggle, an M3 ghost/flat name field bound to `channelNamesStore.setName` (24 chars, live commit) or a static cursor title, a read-only monospace stats line (samples · Vmin…Vmax from the capture; Sample N · timestamp for cursors), quick knobs (opacity preset chips 25/50/75/100 with `aria-pressed`, a dual-canvas preview over both theme backgrounds, and an advisory low-contrast guard), and a collapsible color detail with the 30 curated swatches in a 15-column grid, native picker, content-width hex entry (live-commit valid values, rollback on blur/Enter), a no-slider precise opacity scrub field (±5 steppers, drag-to-scrub at ≈1%/4px with 3px click/drag disambiguation, click-to-type, clamped 5–100, arrow-key stepping), and a per-key ↺ reset restoring the theme-default color and 100% opacity in one action. Cursor popovers add the movement hint footer; accessibility covers `role="group"`/`role="dialog"` (non-modal), `aria-pressed`/`aria-haspopup`/`aria-expanded`, initial focus on the first interactive element, and Esc blurring a focused field first before dismissing back to the gear. Per-key trace opacity is the one new capability: persisted alongside color in one per-key `{ color, opacity }` record (legacy flat payloads still hydrate) and applied as `rgba()` stroke color in the uPlot series config and cursor strokes (hex stays canonical at full opacity), with the PNG snapshot overlay following the same effective stroke. `PaletteSettings.tsx` and the standalone "Colors" toolbar button are retired; the global "Reset to Default Palette" is dropped (per-key ↺ covers the need); existing badge `data-testid` selectors survive on the body button.

## [0.9.2] - 2026-09-30

### Changed

- The sample-capture CTA's yellow hand glyph is ~25% larger (issue #217): sized to 1.25em of the CTA label's font-size (previously 1em, ≈13px → ≈16px) so it stays proportional to the muted "Test fvf • viewer…" label, relying on the CTA's existing flex centering for vertical alignment with no alignment-specific code; the label font, muted color, and persistent underline are unchanged so the CTA still stays tertiary to the drop zone. Browser tests assert both the relative glyph size and the centering.

### Fixed

- Loaded-capture banner brand lockup is pixel-identical to the landing-page lockup and sits at the same viewport position (issue #216): the button reset from the #208 work was keyed to a `.banner-lockup-button` selector that never matched the `brand-lockup-button` class the shared `BrandLockup` component actually emits, so the banner lockup kept the browser's default button chrome (an unwanted greyish background-and-border frame and default padding) and its keyboard focus ring never applied; the selectors now match the emitted class, and the two page headers' paddings are aligned (banner `10px 20px` → `16px 24px`, plus the banner GitHub link padding `5px` → `6px` so both header rows are equally tall) so the lockup occupies the same viewport offset on both pages and navigating via the logo produces no visible jump — the capture banner becomes slightly taller and the metrics row nudges 4px right (accepted). A browser test asserts both lockups share identical bounding-box dimensions, identical viewport offset, and identical computed background/border/padding, and the click-to-landing behavior from #208 is unchanged.

## [0.9.1] - 2026-09-30

### Changed

- Homepage sample-capture CTA reads as an actionable link (issue #210): a solid filled hand silhouette (the Iconoir `one-finger-select-hand-gesture` glyph with fill and stroke in the fvf yellow `#fcc603`, rotated 90° clockwise so the finger points at the text, at font height) now precedes the label, the label reads "Test fvf • viewer with a 100k sample synthetic capture" (accurate for the shipped 100,000-sample synthetic capture), and the text is persistently underlined with the hover underline's existing 3px offset; the muted tertiary font, color, and size are unchanged so the CTA still never competes with the drop zone, and hover/keyboard treatments plus the loaded capture are untouched.

- Deploy runbook's Cloud Build submit command is copy-paste runnable (issue #209): it now explains that `gcloud builds submit` with local source does not populate the `COMMIT_SHA` substitution (only build triggers do), so the documented `…/fvf-viewer:${COMMIT_SHA}` image tag previously resolved with an empty suffix and Docker rejected the build with `invalid reference format` at step 0 (exactly how the first v0.9.0 production deploy attempt failed), and instructs operators to submit from a clean checkout of the intended release tag so the image tag and the uploaded source always correspond.

- Loaded-capture banner header row completed with the full brand lockup (issue #208): the `fvf • viewer` logo + wordmark now stays visible once a capture is loaded, rendered pixel-identical to the landing page (same 32px logo, Geist SemiBold wordmark, gold interpunct) by one shared `BrandLockup` component used by both pages so they cannot drift apart; the lockup is the app's first back-to-landing affordance — clicking (or keyboard-activating, with a visible focus ring) it discards the loaded capture and its view state (viewport, cursors) immediately without a confirmation step and returns to a clean file-drop page; a thin vertical divider with a consistent 14px gap separates the lockup from the capture filename, which is slightly dimmer (`#cccccc`) and slightly smaller (0.86rem) than before while keeping its monospace font and ellipsis overflow; the "Open file…" control, GitHub link, waveform-information row, and landing page are otherwise unchanged.

- Loaded-capture banner restructured into two fixed rows (issue #207): a header row with the brand logo, capture filename, "Open file…" control, and the GitHub repository link — now pinned to the banner's top-right corner and vertically aligned with the logo, where it stays regardless of how far the metric fields below wrap or how narrow the viewport gets — above the unchanged waveform-information row (Date/Time, Timebase, Channels, Samples, Vertical, Derived, Trigger); the rows are separated by spacing only (no horizontal rule), and the GitHub badge icon is unified at 28px across the landing page (previously 24px) and the banner (previously 22px). All existing banner behavior is preserved (filename ellipsis, metric field content and tooltips, "Open file…" file picker, GitHub link target), with browser tests covering the two-row structure, the pinned link position across viewport widths, and the icon size.

## [0.9.0] - 2026-09-29

### Added

- Homepage "Try a sample capture" action (issue #193): a muted link-style tertiary control below the privacy notice loads a shipped synthetic capture through the exact upload pipeline (ticket, worker parse, error modal), so the app can be explored without a real `.fvf` file. The sample is a deterministic four-channel showcase (`Input A`–`D`: 230 V RMS mains with harmonics, soft-start motor current, duty-sweeping PWM gate, run/fault/restart state signal) over a 1 s span at 100,000 samples per channel (~1.6 MB, "100 ms/Div"), mixing V/A logic-level y-axis scales with dense cycle detail for zooming and crisp edges for cursors. It is generated byte-exactly by `cargo run -p fvf-wasm --example synth -- --sample` from the extended synthesizer (structured waveform shapes alongside the legacy noise payload; the committed fixture corpus stays byte-identical), committed as `apps/web/public/samples/fvf-sample.fvf.bin` (the `.bin` suffix keeps the empirical-capture `*.fvf` gitignore guard intact), and gated by a Rust drift test plus browser/E2E coverage of the load flow; the vitest browser project now serves `apps/web/public` so absolute-path assets resolve in tests.

### Fixed

- Public snapshot publisher pushes over HTTPS with a new `PUBLIC_REPO_TOKEN` secret (Contents + Workflows write on the public repository) instead of the SSH deploy key: GitHub rejects workflow-file updates from deploy keys, and the v0.8.5 publish — the first release whose snapshot changed `.github/workflows/ci.yml` — was rejected with "refusing to allow … to create or update workflow"; the token is passed as an environment-scoped git `http.extraheader` so it never appears in remote URLs, command arguments, or on-disk config (the publish job's checkout runs with `persist-credentials: false` — checkout v7 persists its credential through an includeIf-wired config file that cannot be unset by key, and GitHub rejects requests carrying two Authorization headers), and the publish is re-dispatchable for an existing tag via `workflow_dispatch` (Ref #198).

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

[0.9.3]: https://github.com/openscope-ai/fvf-viewer/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/openscope-ai/fvf-viewer/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/openscope-ai/fvf-viewer/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/openscope-ai/fvf-viewer/compare/v0.8.5...v0.9.0
[0.8.5]: https://github.com/openscope-ai/fvf-viewer/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/openscope-ai/fvf-viewer/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/openscope-ai/fvf-viewer/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/openscope-ai/fvf-viewer/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/openscope-ai/fvf-viewer/releases/tag/v0.8.1
