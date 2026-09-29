# FVF fixture corpus

Conformance substrate for the Rust/Wasm parsing engine (`crates/fvf-wasm`).
Per ADR 0006 (local-only captures with a synthetic mirror corpus)
the committed conformance corpus is a **synthetic mirror corpus**; the owner-held
empirical captures stay **local-only** under `test-data/real-captures/`
and are never committed.

## Why the fixture files end in `.fvf.bin`

The repository `.gitignore` blocks `*.fvf` everywhere with no negation
patterns; that rule is the mechanical enforcement of the local-only capture
policy (see ADR 0006) and must never be bypassed with
`git add -f`. Committed synthetic mirrors therefore use the `.fvf.bin`
extension. Byte content is identical to a real `.fvf` stream.

## Directory contents

| File                            | Role                                                                                                                                                                                                                                                                                                                                                                 |
| :------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `synthetic/*.fvf.bin`           | Deterministic synthetic mirror fixtures (committed).                                                                                                                                                                                                                                                                                                                 |
| `manifest.json`                 | Schema 2. Enumerates every committed fixture: size, SHA-256, synthesizer parameters, expected parse outcome, and (accepted rows) the reconstructed timestamp expectations (`deltaT`, `tFirst`, `tLast`, `tCenter`), per-channel vertical-metadata expectations (`unit`, `unitFamily`, `windowMin/Max`, `scale`, `perDiv`), and the stored time-axis block (`tAxis`). |
| `timebase-tokens.json`          | Every architecture.md §3.1 timebase token row (accepted + rejected) with normalized values, plus carrier-fixture mapping and property-test seeds.                                                                                                                                                                                                                    |
| `empirical-local.manifest.json` | Schema 2. Metadata-only oracle for the local empirical captures (name, size, SHA-256, expected variant/records/timebase/timestamp axes, per-record vertical ground truth, stored `tAxis`, local-only screenshot evidence). No capture bytes are committed or embedded.                                                                                               |
| `README.md`                     | This document.                                                                                                                                                                                                                                                                                                                                                       |

## Synthetic fixture inventory

| Fixture                                      | Mirrors                  | Shape                                                                                                                                                     |
| :------------------------------------------- | :----------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accepted-en-4ch-10000-10ms-div`             | 4ch EN corpus mirror     | 4ch EN, 10,000 pts, `10 ms/Div`, payload at 827                                                                                                           |
| `accepted-de-eingang-1ch-3000-comma-decimal` | 1ch DE corpus mirror     | 1ch DE, 3,000 pts, `0,1 s/Div`, Eingang tags, **unaligned payload at byte 830**                                                                           |
| `accepted-en-2ch-10000-1min-div`             | —                        | 2ch EN, 10,000 pts, `1 min/Div` (minute roll-mode domain)                                                                                                 |
| `rejected-invalid-magic-1ch-1000`            | —                        | magic mutated to `XX.XVF` → `invalid_signature`                                                                                                           |
| `rejected-timebase-format-1ch-1000`          | —                        | `abc us/div` → `invalid_timebase_format`                                                                                                                  |
| `rejected-timebase-range-1ch-1000`           | —                        | `500 min/div` (30,000 s/div) → `invalid_timebase_range`                                                                                                   |
| `nonsequential-abd-3ch-10000-20ms-div`       | A/BD corpus mirror       | 3ch A/B/D, 10,000 pts, `20 ms/Div`                                                                                                                        |
| `derived-mathematik-2ch-3000-10ms-div`       | derived-record mirror    | input record + derived `Mathematik A` record (payload = source + 4096 raw counts; physical decodes as raw × S, derived keeps the legacy +0.0625 estimate) |
| `extreme-envelope-4ch-500-10ms-div`          | —                        | envelope lower bound, 4ch × 500 pts (~8 KB)                                                                                                               |
| `extreme-envelope-1ch-250000-10ms-div`       | —                        | envelope upper bound, 1ch × 250,000 pts (~1 MB committed)                                                                                                 |
| `accepted-en-2ch-current-offcenter-1s-div`   | current-unit mirror      | 2ch EN, 9,636 pts, `1 s/Div`: current-unit A + mA channels, off-center trigger                                                                            |
| `unsupported-variant-settings`               | settings-variant capture | valid outer magic, `FV.FVS` inner tag → `unsupported_capture_variant`                                                                                     |

Not committed: `extreme-envelope-4ch-250000-10ms-div` (4ch × 250,000 pts,
~4 MB) is regenerable on demand via
`cargo run -p fvf-wasm --example synth -- --out <dir> --oversized`.

## Synthesizer parameter reference

`crates/fvf-wasm/examples/synth.rs` builds every fixture from explicit bytes.
It is fully deterministic: no clocks, no entropy, no float formatting.

- `FixtureSpec`: `name`, `timebase` (raw embedded string, e.g. `0,1 s/Div`),
  `payload_start` (absolute byte offset of the first raw-count sample),
  `timestamp` (14 ASCII digits, `HHMMSS` + `YYYYMMDD`), `records`
  (`RecordSpec` per sector: `label`, `samples`, optional `source` record for
  derived channels, plus the issue-#107 vertical/time-axis metadata below).
- `RecordSpec` metadata (written per record, empirical dialect): `unit`
  (verbatim channel unit at param+312, e.g. `V`, `kV`, `A`, `mA`), `unit_family`
  (verbatim code at param+324; 3 = voltage, 10 = current observed),
  `scale` (factor S at param+328, duplicated at +344),
  `window_min`/`window_max` (axis window at param+126/+134, duplicated at
  +366/+374), `t_left` (stored time-axis left edge at param+20;
  `t_right = t_left + span` at +44; `None` centers the trigger at
  `−span/2`). Span is an explicit per-timebase match (`10 ms/Div` → 0.1 s,
  `0,1 s/Div` → 1.0 s, `1 min/Div` → 600.0 s, `20 ms/Div` → 0.2 s,
  `1 s/Div` → 10.0 s); fixtures with deliberately invalid timebases keep
  legacy +20/+44 bytes because they are rejected before timestamp
  reconstruction.
- Determinism: per-channel sample seed = FNV-1a-32(fixture name) XOR
  `0x9E3779B9 * (channel_index + 1)`; samples from a 32-bit LCG
  (`x = 1664525·x + 1013904223 mod 2³²`, bits 8..23, offset to signed
  raw counts). Under the legacy Q16.16 decode those span ±0.5 V; under
  the issue-#104 physical decode they span raw × S. Derived records reuse
  their source record's seed with a constant `+4096` sample offset.
- CLI: `--out <dir>` (default `tests/fixtures/synthetic`), `--oversized`
  (additionally emit the uncommitted 4ch × 250k fixture), `--hashes`
  (print `name size sha256` lines).
- Regeneration conformance: `tests/synth_repro.rs` rebuilds every fixture
  in-process, byte-diffs it against the committed copy, and re-verifies the
  manifest hashes — this is the "synthesizer reproducible in CI" gate.

## Observed empirical format dialect

Facts below were re-derived from the local empirical captures by manual binary
inspection and cross-file consistency checks (see ADR 0006 for the
clean-room provenance). Offsets are decimal unless prefixed `0x`.

### File and sector layout

- Magic: bytes `0..6` = ASCII `FV.FVF`; then `u16 26` at 6, `u32 1` at 8.
- `u32` at `0x1C` = 44, pointing at the `CUR_` format tag at `0x2C`.
- `u32` at `0x20` = `file_size − 44` in **every corpus capture** (tail
  back-pointer).
- A waveform file holds one _sector_ (record) per channel: `[global
header][record 1][record 2]…`. Each record =
  `[param block (388 bytes)][raw-count payload (4·N bytes)][trailer
(60 + label_len bytes)]`. Verified: record stride 40,455 (7-char labels)
  / 40,457 (9-char labels) across the local corpus.
- Payload start is frequently unaligned (observed 689, 827, 830): the last
  six bytes before the payload are the marker `02 00 01 00 04 00`; samples
  are little-endian `i32` raw counts. Physical channels decode as
  `raw × S` in f64 cast to f32, with instrument saturation rails
  (`i32::MAX`, `i32::MIN`, `i32::MIN + 2`) reading NaN; derived records
  keep the legacy Q16.16 estimate (`raw / 65536.0`, issue #108 owns the
  real scale/offset model).
- Trailer (60 + `L` bytes, `L` = label length), formula-derived and verified
  on several corpus captures:
  `12×00 | u32 payload_end−24 | u32 0 | u32 payload_end−16 | u32 0 | u16 1
| "FlukeView" + 7×00 (16 bytes) | u32 trailer_start+6 | u16 8+L
| u32 trailer_start+12 | u16 L | label | 2×00`.
- Sector table (descriptor region): anchored by the pointer word `u32`
  at `0x40`. The planned abstract shape ("entries of `begin u32, size
u32, index u16, reserved`") was reconciled empirically against the
  local corpus; see **Sector table reconciliation** below for the
  exact field semantics. Labels are read from descriptors, never
  assumed sequential (A/B/D channel sets exist in the corpus).
- Record param block (388 bytes) — decoded slots, identical in every
  record: `u32` sample count `N` at +224, embedded timebase string at +232
  (up to 12 bytes, e.g. `400 us/Div`, `0,1 s/Div`), a truncated 8-byte copy
  of the timebase at +316, the 14-digit timestamp at +164, display-range
  f64 pair (±800.0) at +366/+374, and self-referential trailer offsets at
  +160/+182 (`trailer_start−44`/`−42`) and +308 (`payload_start−48`).
- Record param block (388 bytes) — vertical-metadata and time-axis slots
  grounded on OCR-verified captures against FlukeView
  screenshots (issue #107; parser decodes them in issues #103–#105):
  stored time-axis edges `f64` at +20 (`t_left`) / +44 (`t_right`),
  vertical-window `f64` pair at +126/+134 (duplicated at +366/+374),
  4-byte NUL-padded unit string at +312 (`V`, `kV`, `A`, `mA`), an 8-byte
  timebase-label copy at +316 (may truncate the `/Div` suffix),
  `u32` unit-family code at +324 (3 = voltage, 10 = current observed;
  exact table open), and scale factor `f64` S at +328 (duplicated at
  +344). Derived relation: per-division = (window span)/8 = 3200 × S.
- Adjacent opaque words (replicated, unmodeled, asserted by no test):
  +340..344 is zero in the synthesized dialect and in the older captures,
  but carries `0x80000000` in every OCR-verified capture; the `u16` at
  +360 varies per record even within one file (`FFF8`–`FFFC` observed) and
  the synthesizer keeps the legacy `FFFC`. Both are open research, not
  ground truth.
- Variant: one corpus capture keeps the outer `FV.FVF` magic but carries an `FV.FVS`
  tag at `0x2C` and `u32 2` at `0x24`, with no waveform records — the
  trigger for `unsupported_capture_variant`.

### Tag dialects and derived records

#### Sector table reconciliation (issue #6)

The issue plan sketched "a sector table at offset 28 with 16-byte entries
`<begin u32, size u32, index u16, 3× u16 reserved>`" and required the exact
field semantics to be reconciled empirically against the corpus.
Reconciled facts, verified on every corpus capture:

- The word at **offset 28 (`0x1C`)** is the _root pointer_: `u32 44`,
  targeting the variant tag at `0x2C` — `CUR_` for waveform files,
  `FV.FVS` for the settings dialect (the unsupported-variant capture, with discriminator
  `u32 2` at `0x24`). This pointer drives `unsupported_capture_variant`.
- The word at **`0x40`** is the _descriptor-region anchor_. Because the
  ±12-byte opaque reserved drift moves the surrounding blocks per firmware
  flavor, the parser never uses fixed absolute offsets: it grammar-scans
  forward from the anchor (window ≤ 48 bytes) for the terminal marker and
  validates the entire table before trusting it.
- **Empirical layout** (all seven waveform captures): for `N` channels —
  `(N−1)` contiguous **16-byte entries**
  `[u16 1][u16 k][u32 1][u16 0][u16 2][u32 trailer_k+23]` (`k` = 1-based
  channel index; the trailing `u32` points at record `k`'s trailer and
  advances by the record stride — this is the entry's "begin pointer"; no
  field carries an observable size, so the planned "size u32" has no
  empirical counterpart and the three reserved `u16`s appear as the
  constant words `1`/`0`/`2`); a **terminal marker**
  `[u16 1][u16 N][u16 N]`; then `N` **18-byte label slots**
  `[12-byte NUL-padded ASCII label][u16 k][u32 ptr]`. The distance
  anchor → label block was 46 bytes in every capture, but the parser does
  not hard-code it.
- **Synthetic-mirror layout** (ADR 0006 corpus): fixed table at `0xA0`
  (`0xA0` also being the anchor value the synthesizer writes at `0x40`),
  14-byte entries `[u16 slot=k][u32 label_pos][u16 2][u32 1][u16 0]`, a
  14-byte tail block starting with `u16 0` that references the first
  trailer (`trailer1+23`), and 18-byte zero-padded label slots.
- The parser (`crates/fvf-wasm/src/header.rs`) accepts both dialects via
  fully validated grammar recognition — the empirical scan first, the
  synthetic walk as fallback — reports which flavor matched
  (`DescriptorFlavor`), and bounds-checks every read
  (`TruncatedCapture`). No `unsafe`, no unaligned deref; all multi-byte
  reads use `byteorder::LittleEndian`.

- EN captures label channels `Input A`…`Input D`; DE captures use
  `Eingang A`…`Eingang D` (9-char labels widen the trailer by `L − 7`
  bytes and the descriptor slots accordingly).
- EN files embed the plot-format tag `%w  %d  %t` in the global header;
  the DE comma-decimal capture does not. Header "flavors" also differ
  by ±12 bytes in a reserved region between captures — parser stages treat
  that region as opaque and locate content via pointers/grammar scans.
- Derived (math) channels appear as extra records whose labels encode the
  operation (`Mathematik A-B` in the derived-math capture). The global descriptor table
  lists the math source (`Mathematik A`), the record carries the full
  label. The derived record's param block deviates from the standard
  layout; its `+224` sample-count slot carries no valid count (see
  "Record walking and full decode" below for the extent-based recovery).

### Record walking and full decode (issue #8)

Reconciled facts for `crates/fvf-wasm/src/records.rs`, verified across all
waveform captures and the synthetic corpus:

- **Record 1 location.** Empirical dialect: label slot k's `u32` pointer
  equals `param_k + 112` for every physical record (the derived-math capture's
  slot deviates by +4, which the extent decode tolerates). Synthetic
  dialect: the plot-format tag sits after the label-slot block (gap 45–59
  bytes in the corpus) and record 1 starts 78 bytes past the tag.
- **Record chain.** Records are strictly contiguous —
  `[param (388)][payload (4·N)][trailer (60+L)]` — each trailer ends where
  the next param begins, and the last trailer ends exactly at end-of-file
  (verified on all captures and fixtures). The walk asserts both the
  descriptor count and the exact EOF termination; structural violations
  fail typed with `corrupt_sector_table`, short files with
  `truncated_capture`.
- **Standard decode** (physical; hard errors): `u32 N` at +224 inside the
  500..=250,000 envelope, self-referential payload pointer at +308
  (`= param + 340`), the `02 00 01 00 04 00` marker at +382, and the
  validated trailer grammar at `payload_start + 4·N` (`u32@+12 + 24 ==
start`, `u32@+20 + 16 == start`, `u16 1` at +28, `FlukeView` at +30,
  label at +58 with `u16 L` at +56).
- **Derived extent decode** (best-effort, ADR 0007): after a failed
  standard decode, the payload is bounded by the first payload marker and
  the validated trailer. The derived-math capture's `Mathematik A-B` recovers 621 samples
  (2484 bytes) this way; its param-block layout itself remains
  inventory-only. Source letters are parsed from the record label
  (`Mathematik A-B` → sources A and B).
- **Timestamps (issue #105, sole source).** `delta_t = (t_right −
t_left) / N` in f64; `t_i = t_left + i · delta_t` in f64 cast to f32,
  with the stored edges at param+20/+44; t = 0 sits at the trigger
  reference wherever the file puts it. Both manifests carry per-fixture
  `timestamps` blocks (`deltaT`, `tFirst`, `tLast`, `tCenter`) computed
  from this formula.
- **Physical-value decoding (issue #104).** `(raw as f64 * S) as f32` —
  exact for the dyadic fixture scales, so physical values are pinned
  bit-exactly against the synthesizer LCG stream. The legacy Q16.16 path
  (`(raw as f32) / 65536.0`, retained for derived records) keeps its
  scalar/wasm32-SIMD128 bit-identity by construction (parity test executes
  in issue #9's wasm32 conformance suite).

## Ground-truth derivation method

- Capture expectations in `empirical-local.manifest.json` were derived by
  manual binary inspection (hex offsets above) plus cross-file consistency:
  every structural formula (record stride, trailer pointers, `N` slot,
  timebase slot) was validated on at least two independent captures before
  being recorded.
- Sizes and SHA-256 digests are computed directly from the local files; the
  local-corpus test (`tests/local_corpus.rs`) re-verifies presence, size,
  and digest on every run and **skips with an explicit
  "skipped: local captures not present" notice** when the corpus is absent
  (`FVF_CAPTURE_DIR`, else `test-data/real-captures/` under the primary
  checkout from `git worktree list`).
- Any empirical capture that fails to decode per its manifest expectation
  in later issues is a stop condition: escalate, never weaken the manifest.

## Metadata coverage

Markings: **(a) decoded+tested** — expectation recorded and exercised by the
corpus tests; **(b) inventory-only** — recorded for provenance, not yet
asserted by a parser test.

| Metadata field                                              | Captures                                     | Marking                                                    |
| :---------------------------------------------------------- | :------------------------------------------- | :--------------------------------------------------------- |
| Variant (waveform vs unsupported)                           | all captures                                 | (a)                                                        |
| Record order + labels (incl. A/B/D non-sequential)          | all waveform files                           | (a)                                                        |
| Per-record sample counts                                    | all except the derived-math record           | (a)                                                        |
| Embedded timebase string + normalized secondsPerDiv         | all waveform files                           | (a)                                                        |
| 14-digit timestamp (HHMMSS+YYYYMMDD)                        | all waveform files                           | (a)                                                        |
| Tail back-pointer `u32@0x20 = size−44`                      | all captures                                 | (a)                                                        |
| Trailer pointer formulas                                    | several captures                             | (a)                                                        |
| Reconstructed time axes (deltaT, tFirst, tLast, tCenter)    | all waveform files                           | (a) since issue #8                                         |
| Derived-math record: payload extent + sources (621 samples) | the derived-math capture                     | (a) extent-decoded best-effort; count value inventory-only |
| Derived-math `Mathematik A-B` param-block layout            | the derived-math capture                     | (b) inventory-only                                         |
| Opaque reserved header region contents                      | all (flavor-dependent)                       | (b) inventory-only                                         |
| Display-range f64 pairs (±800.0 etc.)                       | verified const across files                  | (b) inventory-only until metadata tests land               |
| Vertical metadata (unit, window, scale, family, per-div)    | OCR-verified captures (8 records)            | (a) since issue #107                                       |
| Stored time axis (`t_left`/`t_right`, incl. off-center)     | OCR-verified captures + all fixtures         | (a) bytes pinned since issue #107; decoded in issue #105   |
| Golden sample conversions (`raw × S`) + saturation counts   | OCR-verified captures + current-unit fixture | (a) since issue #107; parser values land in issue #104     |
| FlukeView screenshots as local-only evidence                | OCR-verified captures (local PNGs)           | (a) presence + SHA-256 registered, never committed         |

## Provenance and clean-room note

Synthetic fixtures replicate the observed instrument dialect (8-byte-magic
prologue, `CUR_` sector table, length-prefixed channel tags, embedded
timebase strings, unaligned raw-count payloads, `FlukeView` sector trailers).
The GPL-3.0 repository `pasccom/python-fluke` was consulted for format
**facts only** (magic length, sector-table layout) — no code, tables, or
definitions were copied; clean-room discipline per ADR 0001 and ADR 0006 is
maintained. No empirical capture bytes, timestamps, or channel values are
embedded in committed fixtures; synthetic timestamps and sample data are
generated constants.
