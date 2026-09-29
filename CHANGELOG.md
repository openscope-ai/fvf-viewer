# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

_This changelog records the public release history; releases appear here as they are published._

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

## [0.8.0] - 2026-09-20

### Added

- End-to-end test suite (Playwright) running headless in CI on every PR against the production server (`pnpm build && node apps/server` serving the built SPA): a 28-spec pass in `apps/web/e2e` covering every overview §6 acceptance criterion reachable via UI — client-side-only parsing (no off-origin request during load), the parser robustness matrix through the UI (EN multi-channel, comma-decimal German with unaligned payload, non-sequential A/B/D, 500 and 250,000-point envelope extremes, typed error modals with detected bytes), box-zoom and Ctrl+drag cursor gestures with a >100 ms main-thread long-task guard, directional out-of-view cursor recovery (C1 to 33% / C2 to 67%), CSV and PNG export downloads, the narrow-viewport Desktop Required roadblock, and the verbatim nominative fair-use disclaimer on every view. Server integration is asserted end-to-end (`/api/health` 200 with the released version, deep-link routes return the SPA shell, unknown `/api/*` routes return a JSON 404), and a suite-wide guard fails any spec observing a console CSP violation. A dedicated CI job builds wasm+web+server, boots the server, and runs the suite; the deployment-stage acceptance criteria are recorded as shipped in 0.7.0.
- Instrumented performance benchmarks (`apps/web/src/perf`) running inside the normal test suite with results documented in `docs/benchmarks.md`: parse wall-time across the committed 500–250,000-point envelope (hard budget p95 < 50 ms per ADR 0001; measured ≤ 4.6 ms) and 60 FPS interaction budgets on a 4-channel 40,000-point capture — per-event dispatch cost for box-zoom and cursor drags (hard p95 < 16.6 ms; measured ≤ 0.1 ms) and the synchronous box-zoom commit redraw (hard < 16.7 ms; measured 2.4 ms) — plus self-calibrated compositor frame-cadence metrics tracked against a committed baseline (`baseline.json`) with a soft >20 % regression flag surfaced as CI warnings. The benchmarks document that a discrete pan interaction does not exist by design (wheel zoom suppressed; navigation is box-zoom + Fit Waveform).
- Parser conformance regression gate: the wasm32 conformance suite now asserts the executed fixture set is the exact manifest count and accounts a literal 100 % fixture pass rate on the wasm target, and a generated corpus composition report (`docs/conformance-coverage.md`, kept in sync with the manifests by test) lists the empirical vs synthetic composition per architecture.md §3.1 acceptance/rejection category.

## [0.7.0] - 2026-09-20

### Added

- Production Fastify server (`apps/server`): serves the built SPA from `apps/web/dist` with an SPA fallback for deep links (unknown non-API routes return `index.html`; unknown `/api/*` routes return JSON 404), a `GET /api/health` endpoint reporting status, version, and uptime for Cloud Run probes, hardening headers via `@fastify/helmet` (HSTS `max-age=31536000; includeSubDomains`; CSP pinned to the app's actual needs — `script-src 'self' 'wasm-unsafe-eval'` for the Wasm parser, `style-src 'self' 'unsafe-inline'`, `worker-src 'self'`, `frame-ancestors 'none'` — plus `X-Content-Type-Options`, COOP/CORP, and referrer policy), gzip/brotli compression with brotli preferred, `trustProxy` for the Cloud Run edge, and ETag/Last-Modified revalidation without stale `max-age`; after `pnpm build`, `node apps/server` starts the compiled server (env overrides `PORT`, `FVF_STATIC_ROOT`).
- Production container and deployment configuration (`deploy/`): a three-stage `Dockerfile` building in topological order (wasm-pack 0.13.1 on Rust 1.98 → pnpm server `tsc` + Vite builds → minimal non-root Node 22 runtime with a `/api/health` `HEALTHCHECK`), a `.dockerignore` that keeps proprietary empirical captures and local build state out of images, a Cloud Build pipeline (`cloudbuild.yaml`) that pushes `${COMMIT_SHA}`-tagged images to Artifact Registry and deploys to Cloud Run in `europe-west3` with `max-instances=5`, scale-to-zero, concurrency 80, and 512Mi, and an operator guide (`deploy/README.md`) covering prerequisites, IAM roles, local container verification, budget alerts, rollback, and teardown. Verified end-to-end: local `docker build`/`docker run` healthy and a live Cloud Build → Cloud Run deployment.

## [0.6.0] - 2026-09-19

### Added

- Brand presence in the loaded-capture metadata banner: the FVF Viewer logo renders in the upper left beside the filename, and an icon-only Iconoir `github-circle` repository link sits in the upper-right corner (new tab, `noopener`/`noreferrer`, `aria-label`), with existing metadata readouts and the open-file control unobstructed and the banner's responsive wrapping preserved.
- Waveform hover tooltip: after 500 ms of dwell on the same snap point (the dot uPlot renders on the nearest visible channel line), a minimalist tooltip appears beside the dot showing the sample's x coordinate in SI-scaled time and y coordinate in the channel's canonical SI unit with the channel name in its trace color; moving to another sample or channel, leaving the canvas, zooming, or starting any drag resets the dwell and hides the tooltip.

### Changed

- Replaced the legacy blue-wave favicon with the finalized FVF Viewer logo: `favicon.svg` now renders the gold (`#fcc603`) distorted sine wave over the muted reticle on the charcoal squircle tile (wave stroke tuned for 16px legibility; the self-contained dark tile keeps contrast on light and dark tab themes), and `favicon.ico` ships 64/48/32/16 multi-resolution mipmaps regenerated from the same geometry.
- Reworked the empty-state Drop capture page around the finalized brand identity: a new top bar carries the `fvf • viewer` wordmark (Geist SemiBold, vendored variable font) with the static logo upper left and an icon-only Iconoir `github-circle` repository link upper right; the drop zone centers the animated phosphor-sweep hero logo (5.5 s loop with `prefers-reduced-motion` static fallback) replacing the legacy oscilloscope graphic; the `Fluke ScopeMeter® .fvf captures` badge is removed so the only Fluke reference is the legal footer disclaimer; the default empty-state tab title reads `fvf • viewer`; and the drop zone states that captures are processed locally in the browser with nothing uploaded.

## [0.5.4] - 2026-09-19

### Changed

- Reworked Measurement Cursors floating panel identity colors and help: channel and differential rows now carry exact canvas trace-color swatches resolved in the active viewport theme with readable untinted labels, the C1/C2 badges mirror the toolbar treatment (theme-matching ring and glow, white text with tinted fill when selected) with the selection dots removed, and the help (?) button toggles a floating cursor-guidance panel in the card's own style instead of a tooltip-only affordance (tooltip reads `Cursor help`).

### Fixed

- Light-theme default for Channel B changed from navy (`#00008B`) to dodger blue (`#1E90FF`): distinguishable from the C1 cursor purple and visible on the dark toolbar chrome, while holding contrast on the white canvas.
- Y-axis titles for channels B–D no longer overlap the neighboring axis tick marks: the rotated title column widens from 14px to 20px (6px title gap plus glyph ascent plus margin) on both the live canvas and PNG exports.
- Renamed channels no longer show a trailing colon in the Measurement Cursors panel (`A: V_grid` instead of `A: V_grid:`); default names keep the `A:` form.
- Restored expanded-by-default Measurement Cursors panel for sessions that persisted a collapse before this change; explicit collapses after the migration are still remembered.

## [0.5.3] - 2026-09-17

### Added

- Surfaced cursor movement controls across the UI: added a dedicated help-circle button (from Iconoir) in the Measurement Cursors floating card titlebar with an informative tooltip detailing cursor interactions (Ctrl+Drag to move smoothly, Ctrl+Click to snap to pointer, and Ctrl+Mousewheel or Ctrl+Arrow keys to step sample-by-sample), and enriched canvas cursor handles (C1/C2) and toolbar cursor toggle buttons with corresponding movement instructions in their tooltips.
- Initial zero alignment for all channel Y-axes: on initial waveform file load and when triggering "Fit Waveform (100%)", each channel's Y-axis scale is computed symmetrically around zero (`[-bound, +bound]`) so all channel zero values align at the 50% vertical center, while preserving asymmetric box-zoom exploration.

### Changed

- Increased horizontal spacing between elements of waveform information banner: widened gap between banner sections (Date/Time, Timebase, Channels, Samples, Vertical, Trigger) and between primary group and metrics to 28px, separated individual channel entries in the Vertical section with a 14px left margin, and ensured clean vertical alignment and responsive wrapping across desktop viewports.
- Cleaned up Measurement Cursors floating panel and enriched channel banner tooltips: removed the redundant 'Input ' prefix from channel readout rows and differential rows (displaying 'A:', 'B:', or custom names), removed the channel metadata context rows from the floating card and snapshot exports, and surfaced complete per-channel vertical metadata (canonical per-division, stored window, saturated sample count, and custom names) in the CHANNELS section letter tooltips in the waveform banner.

### Fixed

- Differentiated off-canvas cursor recovery placement: activating the recovery badge for C1 places C1 at 33% of the visible viewport while C2 recovers to 67% (snapped to the nearest discrete sample index), preventing the two cursors from colliding and occluding one another at the 50% midpoint when both are recovered from off-canvas.
- Preserved Y-axis tick and label font sizing during zoom, resize, and channel toggle: isolated axis width measurements in `measureYAxisSize` to a dedicated offscreen canvas context so `uPlot.ctx.font` on the main render canvas is never mutated or overwritten, preventing tick values and rotated labels from shrinking on high-DPI displays.

## [0.5.2] - 2026-09-17

### Added

- Per-channel Y axes with selected-channel grid: every visible physical channel renders its own labeled, channel-colored axis column (`<letter> (<unit>)`, or `<custom name> (<unit>)`) with measured dynamic tick-to-title spacing across both live canvas and PNG snapshot exports; toolbar badges gain a three-state cycle (`hidden` → `visible` → `selected` → `hidden`), trace and axis-column clicks update selection without affecting scale bounds, horizontal gridlines draw exclusively for the currently selected channel, and hiding all channels cleanly collapses axis columns and gridlines.

### Changed

- Y-axis SI prefix scaling: scales select SI prefixes using the largest absolute window bound $\max(|\text{min}|, |\text{max}|)$ so asymmetric and zero-crossing windows never mislabel ticks into oversized units (e.g. a $\pm 665\text{ A}$ window renders in $\text{A}$ rather than $\text{kA}$); bounds of zero or non-finite fallback to the unscaled base unit, and per-division and readout values preserve own-magnitude canonical SI.
- Compact waveform information banner: removed the `Input` prefix across the banner, formatting CHANNELS as `N channels (A, B, C, D)` and VERTICAL as a single compact line (`A: 50 A/Div  B: 200 A/Div …`) with color-coded channel letters matching canvas trace colors; custom channel names and non-uniform sample counts move into letter tooltips while uniform counts remain in SAMPLES, and CSV export headers remain verbatim descriptor labels (`Input A`).
- Waveform banner trigger section alignment & styling: restyled the TRIGGER section into a standard banner field with matching label and value styling and vertical alignment, dropping the inline `(stored axis)` copy in favor of `0 s` while preserving the full trigger-reference explanation in the section tooltip.

## [0.5.1] - 2026-09-16

### Changed

- Replaced em-dash separator with standard ASCII hyphen-minus (`<filename> - FVF Viewer`) in dynamic browser tab title formatting.
- Updated default color for cursor C2 from amber to theme-adapted grey (`#B0B0B0` in Dark OLED theme, `#4B5563` in Light/Lab theme) with corresponding cursor line, badge/pill, readout card, and print snapshot parity.

## [0.5.0] - 2026-09-16

### Added

- Unit-aware UI with an axis-per-channel scale model: every physical channel owns its uPlot scale (`y0`, `y1`, …) while a single rendered Y axis binds the active trace (sticky click focus, hover preview, first visible channel default) with a `<descriptor label> (<base unit>)` heading and channel-color axis, and other visible channels appear as collapsed edge markers; readout card and PNG rows show base-SI values with per-channel context (verbatim file unit, canonical per-division, stored window, saturated count), differentials read `Δ<unit>`, the banner gross list shows descriptor labels with canonical-SI per-division lines, and CSV gains `# channel[N]: label=…; unit=…; [file_unit=…;] samples=…` traceability with empty overload cells under unchanged verbatim headers. The Wasm bridge exposes `channel_window_min/max`; saturated samples plot clipped at the window edge (readout `—`, CSV empty). Dual/triad Y axes and the channel-toggle legend stay deferred.

- Physical sample-value decode: channels expose `values` (`raw × S` in f64, cast to f32) with verbatim `raw_counts` and per-channel `saturated_sample_count`; instrument saturation rails (`i32::MAX`, `i32::MIN`, `i32::MIN + 2`) read NaN with a typed `saturated_samples` warning, and derived math records keep the legacy Q16.16 estimate with a typed `derived_legacy_values` warning (real derived scale/offset model stays open research). Scope34 pins the FlukeView screenshot datablock end to end (Input B 591.31/−583.13 A, Input D 665.38/−690.31 V as exact raw × S; Input A 123 low + 296 high rails, Input C 7880 high rails). The worker carries the `values`/`rawCounts` lanes plus per-channel saturated counts through the Wasm bridge.
- Stored time-axis decode: per-channel timestamps come from the record param block (`t_left` at +20, `t_right` at +44; `dt = span / N`, `t_i = t_left + i·dt`) instead of the deleted display-center reconstruction — t = 0 sits at the trigger reference wherever the file puts it (~40% into the window for several captures). Missing or invalid ranges fail typed (`invalid_time_axis`, no fallback); a stored-span disagreement beyond ~5% against the timebase-implied span warns (`time_axis_span_mismatch`) while the stored range rules. The banner now reads "Trigger: 0 s (stored axis)".
- Empirical corpus ground truth: `empirical-local.manifest.json` (schema 2) registers the corpus captures with per-record vertical metadata (unit, axis window, scale factor, per-division), golden `raw × S` sample conversions, Overload saturation counts with rail values, stored time-axis edges, and the FlukeView screenshots as local-only evidence (name, size, SHA-256; PNGs never committed). The synthesizer writes the `unit`/`scale`/`window`/`t_left` param-block fields and gains a current-unit (A/mA) off-center-trigger fixture; all fixtures regenerated with valid stored axes.
- Per-channel vertical metadata decode: the parser exposes verbatim `unit`, `window_min`/`window_max`, `scale`, `unit_family`, and derived `per_div` on every channel (known units `V`, `mV`, `kV`, `A`, `mA`; unknown tokens parse through with a typed warning), with typed consistency warnings for standard records and no validation for deviating derived layouts. The metadata banner surfaces per-channel `{label} · {per-div} {unit}/Div` lines. Sample values remain Q16.16-normalized pending physical-value decoding.
- Multi-waveform comparison and channel vertical offset roadmap specifications: added Stage 6 work items covering 2-file comparison, cursor-snap time alignment, draggable ground reference markers, and composite CSV export.
- Expanded the domain model: formalized ubiquitous language for reference captures, time slip, cursor snapping, ground reference markers, quick-stack, and composite CSVs.
- AI Canvas Copilot architecture in `docs/architecture.md`: documented the deterministic Wasm DSP feature extraction pipeline and interactive two-way UI tool harness.

### Changed

- Reconciled completed stages and historical work items in the staged implementation plan through release v0.4.3.

## [0.4.3] - 2026-09-14

### Added

- Unique compact-timestamped export filenames: `formatCompactTimestamp` formats local time as `YYYYMMDD-HHmmss` so multiple exports within the same session maintain strict chronological sort order with zero browser download collision numbering (`(1)`, `(2)`); snapshots download as `<stem>-snapshot-<timestamp>.png` (or `snapshot-<timestamp>.png`), and CSV exports download as `<stem>-<timestamp>.csv` (or `capture-<timestamp>.csv`).
- Transparent high-contrast sine-wave favicon: `favicon.svg` drops the enclosing dark squircle container in favor of an open glyph sitting directly on native browser tab chrome, centers an 87.5% full-bleed continuous sine wave with a bold 9px stroke (`stroke-linecap="round"`, `stroke-linejoin="round"`) free of dashed baseline ticks, adapts stroke color dynamically via `prefers-color-scheme` between Dark OLED cyan (`#00BFFF`) and Light theme royal blue (`#0066CC`), and is paired with a synced Chromium-rendered multi-resolution `favicon.ico` fallback (64/48/32/16) with full alpha transparency.

### Changed

- Canvas fingerprinting protection detection & user guidance: proactively detects Canvas Block / RFP / Tor Browser canvas data scrambling on initial startup through an isolated offscreen 16x16 test tile; surfaces a non-blocking informational banner and a dedicated explanatory dialog ("Canvas Protection Detected") guiding users to grant HTML5 Canvas extraction permissions for the domain, with seamless live recovery via `VisibilityObserver` upon tab re-focus.
- Trigger marker rising-edge alignment & unbroken top border: the t = 0 rising-edge trigger glyph aligns its low-to-high step transition exactly on the vertical zero-time accent line ($t = 0$) rather than off-center, and the top horizontal graticule border line renders unbroken across the full canvas width behind the trigger marker.
- Dynamic zoom-adaptive Y-axis SI units with hysteresis: the Y-axis selects optimal SI prefix units (MV, kV, V, mV, µV, nV, pV) driven by the active visible voltage span with float-noise-free tick formatting, 5% hysteresis across zoom boundaries, and synchronization between live canvas and offscreen print snapshot exports while CSV export remains lossless unscaled volts.

## [0.4.2] - 2026-09-13

### Added

- Dynamic browser tab title and Iconoir sine-wave favicon: `document.title` reactively mirrors the capture store as `<filename> — FVF Viewer` (filename leftmost so it survives crowded tab bars, full file extension retained) and cleanly reverts to the default `FVF Viewer` on the landing state, after reset, or on ingestion failure; the Iconoir sine-wave trace renders in electric cyan (`#00BFFF`) on a dark squircle (`#0f172a`), shipped as a scalable `favicon.svg` plus a Chromium-rendered multi-size `favicon.ico` fallback, both linked in `index.html`.

### Fixed

- Blank canvas and missing X axis on initial file open: the fit bounds are computed before uPlot construction and passed straight into the scale options so the first (deferred) scale commit lands on the full-capture 100% fit, and the channel-names redraw is guarded to skip identical-content store updates and never fire while the initial scale commit is pending — a racing `redraw()` used to clobber the pending fit bounds into null scales, leaving a blank canvas with a hidden bottom axis until Fit Waveform (100%) was clicked.
- Off-center toolbar badge text: the leading color dots and trailing selection star are removed outright — inactive badges rendered 0×0 dots inside a 7px flex gap (19px left vs 12px right inset) and cursor badges carried the phantom gap permanently; channel and cursor badges are now centered typographic pills with symmetrical 3px 10px padding and a uniform 38px minimum width across all states, identity and state remain carried by border color, text color, background fill, and glow, and deactivated badges now shed their active inline styling (React never diffs a `style` prop transitioning object → undefined).
- Palette propagation to the Measurement Cursors card: the floating HUD subscribes to the palette store and resolves cursor badge border/text/glow and channel voltage and differential ΔV label colors through the shared effective-color helpers — user customizations appear live in the card (previously only the canvas and PNG exports updated), un-customized entries keep the high-contrast Dark OLED baseline on the dark translucent backdrop in both viewport themes, and differential metrics keep the `#00e5ff` accent.
- t = 0 trigger indicator visibility: the vertical accent line now starts 4px below the trigger glyph so it no longer bisects the icon, the rising-edge glyph is enlarged to a 12px-wide, 14px-tall silhouette with a 1.75px stroke and renders above the traces on a theme-background clear-zone pill that shields it from the top graticule border, gridlines, and high-amplitude traces, and the live canvas and offscreen PNG render share the same two draw functions so exported snapshots keep exact parity.

## [0.4.1] - 2026-09-13

### Added

- Draggable floating cursor readout card: titlebar drag handle via Pointer Events with capture and stopPropagation isolation from the uPlot box-zoom plugin, strict 8px clamping inside the oscilloscope wrapper with upward re-clamping when a collapsed card expands near the bottom boundary, double-click reset to the default top-right anchor (`top: 76px; right: 16px`), keyboard repositioning (arrow keys 10px, Shift 50px, Enter/Escape commit/release), position and collapse state persisted across browser sessions in local storage with re-clamping on resize, and PNG snapshot compositing of the card at its live position/state with dark HUD chrome for Dark OLED exports and contrast-adapted light chrome for print-inverted exports.
- Advanced inline color picker accordion: channel and cursor rows streamlined to label + active color chip + reset, single-open inline accordions presenting a curated 30-swatch high-contrast engineering matrix with the active color highlighted, live in-place waveform/cursor restyling while the accordion stays open, a validated `#RRGGBB` hex input committing live and rolling back invalid drafts on blur/Enter, a native color picker for arbitrary off-matrix shades, full keyboard/ARIA support, and unchanged per-row/global reset and localStorage persistence.
- t = 0 trigger reference: metadata banner badge reworded to "Trigger: 0 s (Center)" with an explanatory tooltip, an accented vertical graticule line at t = 0 in a graticule-matched neutral tone (Dark OLED `#555555`, Light Lab `#888888`), a traditional rising-edge trigger glyph (low-to-high step with upward arrow) pinned to the top grid border tracking zoom/pan and hiding cleanly when t = 0 leaves the window, and exact live/print snapshot parity via a shared draw function.
- Zoom-adaptive X-axis SI time units: the visible-span-driven unit selection (min at ≥ 120 s, then s/ms/µs/ns, ps for extreme sub-nanosecond envelopes) updates the axis title and scales tick numbers with float-noise-free formatting through a 5% hysteresis band preventing boundary flapping; the offscreen print render adopts the same unit so exported PNGs match the live axis, while CSV export stays lossless unscaled seconds.
- User-editable channel names: toolbar channel badges rename inline on double-click (fixed letter prefix, 24-character cap, Enter/blur commit, Escape cancel, empty clears to the default letter; single click still toggles visibility), with per-file persistence keyed by capture identity and propagation to toolbar badges, cursor readout rows, canvas series legend, PNG snapshot export, CSV export headers, and the metadata banner.

### Fixed

- Oscilloscope Y-axis layout: the Y axis grew from 40px to a measured, generous fixed 72px with explicit gap/labelGap paddings so multi-digit and decimal tick values keep clear separation from the rotated "Voltage (V)" title without canvas-width twitching; a shared axis-geometry builder makes the live canvas and exported PNG snapshots identical by construction.
- Zero-scroll viewport layout: the app frame owns the 100vh constraint with a 560px minimum floor; the shell and ingestion containers flex within it instead of forcing their own 100vh min-heights, and the oscilloscope uses `flex: 1; min-height: 0` rather than inline `height: 100%`, eliminating the vertical overflow that pushed the X-axis below the fold on 1080p/1440p screens; a 400px canvas floor with graceful page scrolling protects aggressive split-screens and the legal footer keeps a compact 6px footprint.

## [0.4.0] - 2026-09-12

### Added

- Desktop-only viewport roadblock: strict `matchMedia("(max-width: 1023px)")` enforcement with an event-driven `change` listener (no `innerWidth` logic, no user-agent sniffing), `inert` app-shell blocking (pointer, keyboard, and assistive tech in one step) with live boundary crossings preserving all app state without reload, a non-dismissable `role="dialog"` overlay (`aria-modal`, focus-on-appear with prior-target restore), and a share-first "Share Link to Desktop" action — `navigator.share` primary, clipboard fallback with a transient "Link Copied ✓" morph and `aria-live` announcement, selectable-URL last resort, and `AbortError` sheet dismissal as a silent no-op. ADR 0003 and architecture.md §5.1 updated to the share-first wording.
- CSV export: client-side chunked `Blob` generation with `#`-prefixed metadata header rows (file, capture timestamp, timebase, sample count, detected channels, display-center time origin) plus a `sample,time_s,<detected channel names…>` table aligned to the capture time axis — physical channels plus extent-aligned derived channels, misaligned channels omitted with an explicit note — shortest-exact f32 value formatting for exact round-trip, CSV escaping, bounded 5,000-row chunks yielding to the event loop (250,000-point export never freezes the main thread), and an "Export CSV" toolbar control downloading locally.
- High-resolution PNG snapshot export: offscreen compositing pass drawing the uPlot base canvas onto a device-pixel-ratio-scaled export canvas and explicitly re-drawing the DOM-overlay state raw `toBlob()` cannot capture — C1/C2 cursor lines and labeled handles with selected highlight, out-of-view recovery badges pinned to the margins, and the visible-channel legend — finalized with `canvas.toBlob()`; correct with cursors inside the window and pinned outside as recovery markers, and an "Export PNG" toolbar control.
- Inverted print-friendly PNG snapshot export: "Invert colors for print / white background" toggle driving a temporary offscreen uPlot render with the light palette (white background, dark graticule, contrast-adapted traces, light cursor colors) at the live viewport bounds, composited with accurate cursor overlays at full device pixel ratio while the live on-screen viewport remains completely unchanged.
- Site-wide legal footer: nominative fair-use disclaimer rendered verbatim on every app view, including a compact variant inside the desktop roadblock overlay.

## [0.3.1] - 2026-09-12

### Added

- Light/dark viewport theme toggle: toolbar control switching the oscilloscope canvas viewport between the default Dark OLED theme (`#000000`) and a Light/Lab theme — white canvas, high-contrast graticule grid (`#C8C8C8`), legible axis text (`#555555`), and contrast-adapted trace strokes (darkened yellow/amber `#B8860B`, navy blue `#00008B`, crimson `#B22222`, forest green `#228B22`; cursors C1 `#6A1B9A`, C2 `#B45309`) — with in-place uPlot restyling (axis/series stroke resolver mutations plus one redraw; no canvas destruction or waveform re-parse), theme-following cursor lines/handles and toolbar badges, and theme persistence across browser sessions in local storage.
- User-configurable channel color palette: color settings panel with per-channel (A-D) and per-cursor (C1/C2) rows, each offering quick preset swatches, a native color picker, and a validated hex input, plus a per-entry revert and a one-click "Reset to Default Palette" restoring the architecture.md §4.1 standard palette (A `#FFD700`, B `#00BFFF`, C `#FF4500`, D `#00FF7F`, C1 `#E040FB`, C2 `#FF9100`); overrides apply dynamically in place (single in-place series-option mutation and redraw — uPlot 1.6.32's `setSeries` handles only `show`/`focus`), render as authored in both themes, and persist across browser sessions in local storage.

## [0.3.0] - 2026-09-05

### Added

- Dual measurement cursors C1/C2 & readout panel: interactive vertical cursor lines C1 (`#E040FB`) and C2 (`#FF9100`) default to 25% and 75% of capture length; active cursor selectable via toolbar button, cursor line click, or readout badge; `Ctrl+drag` (`Cmd+drag`) moves cursor snapping to discrete sample points at 60 FPS while unmodified canvas drag retains box-zoom; `Ctrl+click` relocates selected cursor to clicked timestamp; `Ctrl+LeftArrow` and `Ctrl+RightArrow` micro-step by 1 sample index; `Ctrl+wheel` moves cursor with dynamic acceleration; Escape key cancels drag; floating HUD readout card displays real-time sample index, trigger-relative time, interpolated voltages per active channel, differential metrics ($\Delta t$, $1/\Delta t$, $\Delta V$), dynamic SI prefix formatting with 3-4 significant figures, and automatic suppression of hidden channels.
- Out-of-view cursor recovery markers & readout dimming: pinned directional badges (`◀ C1`, `C2 ▶`) appear on canvas margins when active cursor timestamps fall outside visible zoom window ($t < x_{min}$ top-left, $t > x_{max}$ top-right); vertical stacking without overlap when both cursors are off-screen on the same margin; accessible button controls with tooltips, keyboard activation (Enter/Space), and event propagation isolation; midpoint recovery snapping to nearest sample index with automatic cursor selection; reactive badge dismissal on recovery, deactivation, or viewport expansion; and visual dimming (`cursor-readout-row--out-of-view`) of off-screen cursor sections in the floating readout card.

## [0.2.3] - 2026-09-04

### Added

- Rectangular box-zoom plugin: custom 2D drag-selection uPlot plugin with translucent selection overlay, 8px click-safe threshold on both axes, Escape key cancellation restoring full pre-drag state, and atomic two-axis scale update via uPlot.batch(). (Ref #13)
- Channel toggles & fit/reset: toolbar channel badges toggling trace visibility with stable Y scaling (no automatic Y rescaling on toggle), one-click 'Fit Waveform (100%)' restoring full capture view with optimal dynamic Y-margins, and explicitly disabled mouse wheel zoom to prevent canvas drift. (Ref #12)

## [0.2.2] - 2026-09-04

### Added

- File ingestion & metadata inspector: production drag-and-drop hero zone with drop-anywhere capture replacement and native file picker (`apps/web/src/hooks/`, `components/ingestion|banner|modals/`), a human-readable parse-error modal naming the error and detected magic bytes (hex + ASCII), and a top metadata banner (file name, capture date/time, channel count, samples per channel, timebase, Display-Center Trigger Reference); the dev-only drop harness is retired.

## [0.2.1] - 2026-09-03

### Added

- uPlot canvas wrapper with dark OLED theme, channel color palette, resize observer hook, and Zustand viewport store for 60 FPS rendering.

## [0.2.0] - 2026-09-02

### Added

- Wasm bridge & Web Worker IPC (`crates/fvf-wasm/src/lib.rs`, `apps/web/src/workers/`): `parse_capture` wasm-bindgen entry exposing per-channel Q16.16 voltages and Display-Center timestamps as `Float32Array` views into Wasm linear memory with typed `{ code, message, details }` error payloads; a dedicated parse worker implementing the `{ PARSE_FVF } -> { PARSE_SUCCESS | PARSE_ERROR }` protocol with transfer-safe standalone `Float32Array` copies (the Wasm-heap detachment guard of architecture.md 3.2 — a Wasm-aliasing buffer never enters a transfer list); a main-thread worker client with request/response correlation and input-buffer transfer; Zustand capture/parseState/error store slices; a dev-only drop-zone harness route; a committed Rust error-taxonomy mirror (`error-taxonomy.json`) keeping the TS error-code unions in sync via a wasm32 conformance suite that drives the full synthetic corpus through the real wasm build in Node vitest; a chromium browser-mode vitest project (real-Worker transfer assertions, three-successive-parse survival, typed errors end-to-end, median-of-5 16 ms 250k-point round-trip budget with the `VITE_TEST_TIMING_BUDGET_MS` escape hatch); and a cached Playwright chromium install step in the CI web job.

- Channel record decoding (`crates/fvf-wasm/src/records.rs`, `fixed_point.rs`): sector-table record walk with strict contiguity checks, unaligned little-endian Q16.16 to f32 decoding (`raw / 65536.0`; scalar baseline, opt-in wasm32 `simd128` feature), derived (Math) channel best-effort decoding with typed warning downgrade, Display-Center timestamp reconstruction (delta-t = secondsPerDiv x 10 / N, t = 0 at N/2) across the 500-250,000-point envelope, plus a local-only twin test asserting an empirical capture and its synthetic twin decode structurally identically.

- Timebase grammar & validation pipeline (`crates/fvf-wasm/src/timebase.rs`): decidable case-insensitive token grammar (hand-rolled, no regex dependency), comma-to-dot normalization, unit scaling, physical range gate (1 ns/div .. 120 s/div inclusive), hardware step-sequence classification with `nonStandardTimebase` warning flag, and seeded deterministic property tests (lcg32 per `timebase-tokens.json`).

- Header parsing engine (`crates/fvf-wasm/src/error.rs`, `header.rs`, `types.rs`): full 8-byte signature verification (`InvalidSignature` with detected bytes), format-version gate (`UnsupportedCaptureVersion` for v>=2), empirically reconciled sector-descriptor discovery (grammar-scanned, pointer-anchored - no fixed absolute offsets), truncation-safe bounds-checked reads via `byteorder` (zero `unsafe`), typed error/warning taxonomy with stable codes, and locale-tolerant channel-tag classification (Input/Eingang, derived Math, unknown-prefix warning) per ADR 0007.

- Synthetic mirror fixture corpus for the FVF parser: 11 deterministic `.fvf.bin` fixtures under `crates/fvf-wasm/tests/fixtures/synthetic/` (accepted EN/DE-comma/minute-roll-mode, invalid magic, rejected timebase format/range, non-sequential A/B/D, derived Math channel, unsupported variant, 500-point and 250,000-point envelope extremes) with `manifest.json` (SHA-256, parameters, expected outcomes), `timebase-tokens.json` (every architecture §3.1 fixture-table row plus property-test seeds), and a metadata-only SHA-256-pinned oracle (`empirical-local.manifest.json`) for the local-only empirical captures per ADR 0006.
- Deterministic fixture synthesizer (`crates/fvf-wasm/examples/synth.rs`) parameterized by tag set/locale, timebase string, per-channel sample count, and payload start offset; CI-reproducible via byte-diff regeneration tests, plus a skip-aware local-corpus integrity harness (`tests/local_corpus.rs`).

## [0.1.0] - 2026-08-31

### Added

- pnpm workspace monorepo scaffold per `docs/architecture.md` §2.1: `apps/web` (Vite + React + TypeScript strict, dark-themed shell), `apps/server` (zero-route Fastify placeholder with `buildServer()` + start entry on `PORT ?? 3000`), and `crates/fvf-wasm` (wasm-bindgen engine stub exposed as `@fvf/fvf-wasm`).
- Root scripts `dev`, `build`, `build:wasm`, `lint`, `typecheck`, `test`; topological build order guarantees the Wasm module is built before Vite compiles.
- ESLint 9+ flat config and Prettier at the root; shared strict `tsconfig.base.json`; root Cargo workspace; `.nvmrc` (Node 22) and `packageManager`/`engines` pinning.
- Vitest smoke test loading the wasm-pack ES module and asserting `engine_version()`; web shell lazily initialises the engine and logs its version.
- GitHub Actions CI pipeline (`.github/workflows/ci.yml`): parallel `web` (pnpm lint, typecheck, vitest after an in-job wasm build) and `rust` (fmt, clippy `-D warnings`, test, wasm-pack build) jobs on PRs and pushes to `main`; pinned Node 22 (`.nvmrc`) / Rust 1.98.0 / wasm-pack 0.13.1 toolchains, wasm32 target, pnpm-store and rust-cache caching, concurrency-cancelled runs.

### Documentation

- Architecture specification, domain-model context, and ADRs 0001–0005 (Rust/Wasm worker parser, Cloud Run + Gemini, desktop-only viewport, uPlot Canvas2D rendering, GitHub Actions CI topology).
- Staged implementation plan with per-issue scopes and boundaries.

[0.8.4]: https://github.com/openscope-ai/fvf-viewer/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/openscope-ai/fvf-viewer/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/openscope-ai/fvf-viewer/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/openscope-ai/fvf-viewer/compare/v0.8.0...v0.8.1
[0.2.0]: https://github.com/openscope-ai/fvf-viewer/compare/v0.1.0...v0.2.0
[0.2.1]: https://github.com/openscope-ai/fvf-viewer/compare/v0.2.0...v0.2.1
[0.2.2]: https://github.com/openscope-ai/fvf-viewer/compare/v0.2.1...v0.2.2
[0.2.3]: https://github.com/openscope-ai/fvf-viewer/compare/v0.2.2...v0.2.3
[0.3.0]: https://github.com/openscope-ai/fvf-viewer/compare/v0.2.3...v0.3.0
[0.3.1]: https://github.com/openscope-ai/fvf-viewer/compare/v0.3.0...v0.3.1
[0.4.0]: https://github.com/openscope-ai/fvf-viewer/compare/v0.3.1...v0.4.0
[0.4.1]: https://github.com/openscope-ai/fvf-viewer/compare/v0.4.0...v0.4.1
[0.4.2]: https://github.com/openscope-ai/fvf-viewer/compare/v0.4.1...v0.4.2
[0.4.3]: https://github.com/openscope-ai/fvf-viewer/compare/v0.4.2...v0.4.3
[0.5.0]: https://github.com/openscope-ai/fvf-viewer/compare/v0.4.3...v0.5.0
[0.5.1]: https://github.com/openscope-ai/fvf-viewer/compare/v0.5.0...v0.5.1
[0.5.2]: https://github.com/openscope-ai/fvf-viewer/compare/v0.5.1...v0.5.2
[0.5.3]: https://github.com/openscope-ai/fvf-viewer/compare/v0.5.2...v0.5.3
[0.5.4]: https://github.com/openscope-ai/fvf-viewer/compare/v0.5.3...v0.5.4
[0.6.0]: https://github.com/openscope-ai/fvf-viewer/compare/v0.5.4...v0.6.0
[0.7.0]: https://github.com/openscope-ai/fvf-viewer/compare/v0.6.0...v0.7.0
[0.8.0]: https://github.com/openscope-ai/fvf-viewer/compare/v0.7.0...v0.8.0
[0.1.0]: https://github.com/openscope-ai/fvf-viewer/releases/tag/v0.1.0
