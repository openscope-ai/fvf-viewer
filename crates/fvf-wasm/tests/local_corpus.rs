use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;

use fvf_wasm::error::FvfError;
use fvf_wasm::header::{locate_sector_table, parse_header};
use fvf_wasm::records::{decode_capture, walk_sectors};
use fvf_wasm::timebase::validate_timebase;
use fvf_wasm::types::{ChannelKind, ParsedHeader};
use serde::Deserialize;
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
struct EmpiricalManifest {
    captures: Vec<Capture>,
}

#[derive(Deserialize)]
struct Capture {
    file: String,
    size: u64,
    sha256: String,
    #[serde(default)]
    expected: Option<Expected>,
}

/// Header-level expectations (issue #6) plus the timebase fields accrued
/// by issue #7 and the full-decode fields accrued by issue #8.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expected {
    variant: String,
    #[serde(default)]
    warnings: Vec<String>,
    #[serde(default)]
    expected_error_code: Option<String>,
    #[serde(default)]
    records: Vec<RecordExpectation>,
    #[serde(default)]
    timebase_raw: Option<String>,
    #[serde(default)]
    seconds_per_div: Option<f64>,
    #[serde(default)]
    timestamp14: Option<String>,
    #[serde(default)]
    timestamps: Option<TimestampsExpectation>,
    #[serde(default)]
    t_axis: Option<TAxisExpectation>,
    #[serde(default)]
    evidence: Vec<EvidenceExpectation>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordExpectation {
    letter: Option<String>,
    label: String,
    #[serde(default)]
    samples: Option<u64>,
    #[serde(default)]
    derived: bool,
    #[serde(default)]
    source_channels: Option<Vec<String>>,
    #[serde(default)]
    unit: Option<String>,
    #[serde(default)]
    unit_family: Option<u32>,
    #[serde(default)]
    window_min: Option<f64>,
    #[serde(default)]
    window_max: Option<f64>,
    #[serde(default)]
    scale: Option<f64>,
    #[serde(default)]
    per_div: Option<f64>,
    #[serde(default)]
    raw_max: Option<i64>,
    #[serde(default)]
    raw_min: Option<i64>,
    #[serde(default)]
    physical_max: Option<f64>,
    #[serde(default)]
    physical_min: Option<f64>,
    #[serde(default)]
    saturated: Option<SaturatedExpectation>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaturatedExpectation {
    low: usize,
    high: usize,
    #[serde(default)]
    low_rail: Option<i64>,
    #[serde(default)]
    high_rail: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TAxisExpectation {
    t_left: f64,
    t_right: f64,
}

#[derive(Deserialize)]
struct EvidenceExpectation {
    file: String,
    size: u64,
    sha256: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TimestampsExpectation {
    delta_t: f64,
    t_first: f64,
    t_last: f64,
    t_center: f64,
    #[allow(dead_code)]
    samples: u64,
}

/// Loads the private empirical oracle; skips the test when the manifest is
/// absent (published snapshots exclude it per the open-source policy, and
/// fresh clones/CI run synthetic-only).
fn load_empirical_manifest() -> Option<EmpiricalManifest> {
    let Ok(raw) = fs::read_to_string(fixtures_dir().join("empirical-local.manifest.json")) else {
        println!("skipped: private empirical manifest not present");
        return None;
    };
    Some(serde_json::from_str(&raw).expect("empirical-local.manifest.json parses"))
}

/// Resolves a corpus capture filename from the private oracle manifest by
/// shape (never hardcoded: published source must not carry capture names
/// per the open-source policy).
fn capture_name_by_shape(
    manifest: &EmpiricalManifest,
    matches: impl Fn(&Expected) -> bool,
) -> String {
    manifest
        .captures
        .iter()
        .find(|capture| capture.expected.as_ref().is_some_and(&matches))
        .map(|capture| capture.file.clone())
        .unwrap_or_else(|| panic!("no corpus capture matches the test shape"))
}

fn is_derived_math(expected: &Expected) -> bool {
    expected.variant == "waveform" && expected.records.iter().any(|record| record.derived)
}

fn is_ocr_verified_quad(expected: &Expected) -> bool {
    expected.variant == "waveform"
        && expected.records.iter().filter(|r| !r.derived).count() == 4
        && expected
            .records
            .iter()
            .any(|r| !r.derived && r.samples == Some(9636))
}

fn is_comma_decimal_quad(expected: &Expected) -> bool {
    // The golden-row carrier: comma-decimal nanosecond timebase, four
    // physical channels (distinguishes it from the slower comma-decimal
    // DE capture).
    expected.variant == "waveform"
        && expected
            .timebase_raw
            .as_deref()
            .is_some_and(|tb| tb.contains(',') && tb.contains("ns"))
        && expected.records.iter().filter(|r| !r.derived).count() == 4
}

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn corpus_from_env() -> Option<PathBuf> {
    let dir = PathBuf::from(std::env::var("FVF_CAPTURE_DIR").ok()?);
    dir.is_dir().then_some(dir)
}

fn corpus_from_primary_checkout() -> Option<PathBuf> {
    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .output()
        .ok()?;
    let text = String::from_utf8(output.stdout).ok()?;
    let main = text
        .lines()
        .find_map(|line| line.strip_prefix("worktree "))?;
    let dir = Path::new(main).join("test-data").join("real-captures");
    dir.is_dir().then_some(dir)
}

fn resolve_corpus() -> Option<PathBuf> {
    corpus_from_env().or_else(corpus_from_primary_checkout)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn assert_header_matches_manifest(capture: &Capture, parsed: &ParsedHeader, expected: &Expected) {
    assert!(
        parsed.warnings.is_empty(),
        "{}: manifest expects no header warnings, got {:?}",
        capture.file,
        parsed.warnings
    );
    assert_eq!(
        parsed.channels.len(),
        expected.records.len(),
        "{}: descriptor-derived channel count",
        capture.file
    );
    for (channel, want) in parsed.channels.iter().zip(&expected.records) {
        if want.derived {
            assert_eq!(
                channel.kind,
                ChannelKind::Derived,
                "{}: record {} must classify as derived",
                capture.file,
                want.label
            );
            assert_eq!(
                channel.letter, None,
                "{}: derived records carry no physical letter",
                capture.file
            );
            assert!(
                channel.label.starts_with("Math"),
                "{}: derived label {:?} carries a Math prefix (descriptor tag, not the record label)",
                capture.file,
                channel.label
            );
        } else {
            assert_eq!(
                channel.label, want.label,
                "{}: physical label must match the manifest",
                capture.file
            );
            assert_eq!(
                channel.letter,
                want.letter.as_ref().map(|letter| letter.as_bytes()[0]),
                "{}: letter for {} comes from descriptors, not index order",
                capture.file,
                want.label
            );
            assert_eq!(channel.kind, ChannelKind::Physical);
        }
    }
}

#[test]
fn local_corpus_matches_metadata_manifest() {
    let Some(manifest) = load_empirical_manifest() else {
        return;
    };
    assert_eq!(
        manifest.captures.len(),
        11,
        "the oracle lists the full local corpus"
    );
    let Some(corpus) = resolve_corpus() else {
        println!("skipped: local captures not present");
        return;
    };
    println!("local corpus at {}", corpus.display());
    for capture in &manifest.captures {
        let data = fs::read(corpus.join(&capture.file))
            .unwrap_or_else(|error| panic!("local capture {} is required: {error}", capture.file));
        assert_eq!(
            data.len() as u64,
            capture.size,
            "{} size deviates from the metadata manifest",
            capture.file
        );
        assert_eq!(
            sha256_hex(&data),
            capture.sha256,
            "{} content deviates from the metadata manifest",
            capture.file
        );
    }
}

#[test]
fn local_corpus_headers_parse_per_manifest() {
    let Some(manifest) = load_empirical_manifest() else {
        return;
    };
    let Some(corpus) = resolve_corpus() else {
        println!("skipped: local captures not present");
        return;
    };
    for capture in &manifest.captures {
        let Some(expected) = &capture.expected else {
            continue;
        };
        let data = fs::read(corpus.join(&capture.file))
            .unwrap_or_else(|error| panic!("local capture {} is required: {error}", capture.file));
        let parsed = parse_header(&data);
        if expected.variant == "waveform" {
            let parsed =
                parsed.unwrap_or_else(|error| panic!("{}: unexpected {error}", capture.file));
            assert_header_matches_manifest(capture, &parsed, expected);
        } else {
            let error = match parsed {
                Ok(got) => panic!(
                    "{} must be rejected as an unsupported variant, got channels {:?}",
                    capture.file, got.channels
                ),
                Err(error) => error,
            };
            assert_eq!(
                error.code(),
                expected
                    .expected_error_code
                    .as_deref()
                    .unwrap_or("unsupported_capture_variant"),
                "{}: rejection code",
                capture.file
            );
            let FvfError::UnsupportedCaptureVariant { detected_tag } = error else {
                panic!(
                    "{}: expected UnsupportedCaptureVariant, got {error:?}",
                    capture.file
                );
            };
            assert_eq!(
                &detected_tag, b"FV.FVS",
                "{}: settings dialect detected via the root tag",
                capture.file
            );
        }
    }
}

/// Record param-block slots used to locate the embedded timebase string
/// (tests/fixtures/README.md, "Record param block"). Sample counts and
/// timestamps in the same block accrue to issue #8.
const PARAM_BLOCK_LEN: usize = 388;
const TIMEBASE_SLOT: usize = 232;
const TRUNCATED_TIMEBASE_SLOT: usize = 316;
const PAYLOAD_POINTER_SLOT: usize = 308;
/// The last six bytes before every record payload carry this marker.
const PAYLOAD_MARKER: [u8; 6] = [0x02, 0x00, 0x01, 0x00, 0x04, 0x00];

/// Locates record 1's param block via the payload marker and validates the
/// candidate with three independent consistency checks (payload pointer,
/// printable slot bytes, truncated 8-byte copy) before returning the
/// embedded timebase string.
fn extract_embedded_timebase(data: &[u8], file: &str) -> String {
    let mut from = 0;
    while let Some(position) = data[from..]
        .windows(PAYLOAD_MARKER.len())
        .position(|window| window == PAYLOAD_MARKER)
        .map(|offset| from + offset)
    {
        from = position + 1;
        let payload_start = position + PAYLOAD_MARKER.len();
        if payload_start < PARAM_BLOCK_LEN || payload_start > data.len() {
            continue;
        }
        let param = payload_start - PARAM_BLOCK_LEN;
        let pointer = data
            .get(param + PAYLOAD_POINTER_SLOT..param + PAYLOAD_POINTER_SLOT + 4)
            .map(|bytes| {
                u32::from_le_bytes(bytes.try_into().expect("four bytes")) as usize + 48
                    == payload_start
            })
            .unwrap_or(false);
        if !pointer {
            continue;
        }
        let Some(slot) = data.get(param + TIMEBASE_SLOT..param + TIMEBASE_SLOT + 12) else {
            continue;
        };
        let end = slot
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(slot.len());
        let raw = &slot[..end];
        if raw.is_empty()
            || !raw
                .iter()
                .all(|byte| byte.is_ascii_graphic() || *byte == b' ')
        {
            continue;
        }
        let truncated_ok = data
            .get(param + TRUNCATED_TIMEBASE_SLOT..param + TRUNCATED_TIMEBASE_SLOT + 8)
            .map(|copy| {
                let keep = raw.len().min(8);
                copy[..keep] == raw[..keep] && copy[keep..].iter().all(|byte| *byte == 0)
            })
            .unwrap_or(false);
        if truncated_ok {
            return String::from_utf8(raw.to_vec()).expect("printable ASCII slot is valid UTF-8");
        }
    }
    panic!("{file}: embedded timebase slot not located");
}

#[test]
fn local_corpus_timebase_validates_per_manifest() {
    let Some(manifest) = load_empirical_manifest() else {
        return;
    };
    let Some(corpus) = resolve_corpus() else {
        println!("skipped: local captures not present");
        return;
    };
    let mut asserted = 0;
    for capture in &manifest.captures {
        let Some(expected) = &capture.expected else {
            continue;
        };
        let Some(timebase_raw) = &expected.timebase_raw else {
            continue;
        };
        let data = fs::read(corpus.join(&capture.file))
            .unwrap_or_else(|error| panic!("local capture {} is required: {error}", capture.file));
        let embedded = extract_embedded_timebase(&data, &capture.file);
        assert_eq!(
            embedded, *timebase_raw,
            "{}: embedded timebase must match the manifest",
            capture.file
        );
        let validated = validate_timebase(&embedded)
            .unwrap_or_else(|error| panic!("{}: {embedded:?} must parse: {error}", capture.file));
        let want = expected
            .seconds_per_div
            .unwrap_or_else(|| panic!("{}: manifest carries secondsPerDiv", capture.file));
        assert!(
            (validated.seconds_per_div - want).abs() <= 1.0e-12 * want.abs().max(1.0),
            "{}: normalized {} != {want}",
            capture.file,
            validated.seconds_per_div
        );
        assert!(
            validated.warnings.is_empty(),
            "{}: manifest expects no timebase warnings, got {:?}",
            capture.file,
            validated.warnings
        );
        asserted += 1;
    }
    assert_eq!(
        asserted, 10,
        "every waveform capture asserts its timebase; the settings variant carries none"
    );
}

/// Issue #8 accrual: every empirical capture decodes end to end per the
/// manifest — channel/derived counts, per-record sample counts (the Scope
/// 25 math record's count stays inventory-only per its null expectation),
/// record labels, capture timestamp, and the reconstructed time axes.
#[test]
fn local_corpus_decodes_per_manifest() {
    let Some(manifest) = load_empirical_manifest() else {
        return;
    };
    let Some(corpus) = resolve_corpus() else {
        println!("skipped: local captures not present");
        return;
    };
    let mut decoded_waveforms = 0;
    for capture in &manifest.captures {
        let Some(expected) = &capture.expected else {
            continue;
        };
        let data = fs::read(corpus.join(&capture.file))
            .unwrap_or_else(|error| panic!("local capture {} is required: {error}", capture.file));
        if expected.variant != "waveform" {
            let error = decode_capture(&data)
                .err()
                .unwrap_or_else(|| panic!("{} must not decode", capture.file));
            assert_eq!(
                error.code(),
                expected
                    .expected_error_code
                    .as_deref()
                    .unwrap_or("unsupported_capture_variant"),
                "{}: full-decode rejection code",
                capture.file
            );
            continue;
        }
        decoded_waveforms += 1;
        let decoded = decode_capture(&data)
            .unwrap_or_else(|error| panic!("{}: unexpected {error}", capture.file));
        let mut got: Vec<String> = decoded
            .warnings
            .iter()
            .map(|warning| warning.code().to_owned())
            .collect();
        got.sort();
        let mut want = expected.warnings.clone();
        want.sort();
        assert_eq!(
            got, want,
            "{}: warning codes match the manifest",
            capture.file
        );
        let physical: Vec<_> = expected
            .records
            .iter()
            .filter(|record| !record.derived)
            .collect();
        let derived: Vec<_> = expected
            .records
            .iter()
            .filter(|record| record.derived)
            .collect();
        assert_eq!(
            decoded.channels.len(),
            physical.len(),
            "{}: physical channel count",
            capture.file
        );
        assert_eq!(
            decoded.derived_channels.len(),
            derived.len(),
            "{}: derived channel count",
            capture.file
        );
        for (channel, want) in decoded.channels.iter().zip(&physical) {
            assert_eq!(
                channel.letter,
                want.letter.as_ref().expect("physical letter").as_bytes()[0],
                "{}: letter comes from the record walk",
                capture.file
            );
            assert_eq!(
                channel.record_label, want.label,
                "{}: record label from the trailer",
                capture.file
            );
            assert_eq!(
                channel.samples as u64,
                want.samples.expect("physical sample count"),
                "{}: {} sample count",
                capture.file,
                want.label
            );
            let tag = format!("{} {}", capture.file, want.label);
            assert_eq!(channel.values.len(), channel.samples, "{tag}: values lane");
            assert_eq!(channel.raw_counts.len(), channel.samples, "{tag}: raw lane");
            // The raw lane shadows the values lane sample for sample:
            // rails read NaN, everything else reads raw x S.
            let mut nan = 0usize;
            for (value, raw) in channel.values.iter().zip(&channel.raw_counts) {
                if value.is_nan() {
                    nan += 1;
                    assert!(
                        *raw == i32::MAX || *raw == i32::MIN || *raw == i32::MIN + 2,
                        "{tag}: NaN only at saturation rails, got raw {raw}"
                    );
                } else {
                    assert_eq!(
                        *value,
                        (f64::from(*raw) * channel.scale) as f32,
                        "{tag}: value is raw x S"
                    );
                }
            }
            assert_eq!(
                channel.saturated_sample_count, nan,
                "{tag}: saturated count matches the NaN sites"
            );
            if let Some(saturated) = &want.saturated {
                assert_eq!(
                    channel.saturated_sample_count,
                    saturated.low + saturated.high,
                    "{tag}: saturated count matches the manifest"
                );
            }
            if let (Some(want_max), Some(want_min)) = (want.raw_max, want.raw_min) {
                assert_eq!(
                    channel.raw_counts.iter().max(),
                    Some(&(want_max as i32)),
                    "{tag}: raw max count"
                );
                assert_eq!(
                    channel.raw_counts.iter().min(),
                    Some(&(want_min as i32)),
                    "{tag}: raw min count"
                );
            }
        }
        for (channel, want) in decoded.derived_channels.iter().zip(&derived) {
            assert_eq!(
                channel.record_label, want.label,
                "{}: derived record label from the trailer",
                capture.file
            );
            let want_sources: Vec<u8> = want
                .source_channels
                .as_ref()
                .map(|letters| letters.iter().map(|letter| letter.as_bytes()[0]).collect())
                .unwrap_or_default();
            assert_eq!(
                channel.source_channels, want_sources,
                "{}: derived source channels parsed from the record label",
                capture.file
            );
            if let Some(samples) = channel.samples {
                assert_eq!(
                    channel.values.len(),
                    samples,
                    "{}: derived values decode per sample",
                    capture.file
                );
                assert_eq!(
                    channel.raw_counts.len(),
                    samples,
                    "{}: derived raw counts decode per sample",
                    capture.file
                );
                assert_eq!(
                    channel.saturated_sample_count, 0,
                    "{}: legacy derived estimate carries no NaN rule",
                    capture.file
                );
            }
            // The manifest's null sample count stays inventory-only: no
            // value assertion for the derived math record.
        }
        assert_eq!(
            decoded.timebase_raw,
            expected.timebase_raw.clone().unwrap_or_default(),
            "{}: embedded timebase token",
            capture.file
        );
        let want_spd = expected
            .seconds_per_div
            .unwrap_or_else(|| panic!("{}: manifest carries secondsPerDiv", capture.file));
        assert!(
            (decoded.seconds_per_div - want_spd).abs() <= want_spd.abs().max(1.0) * 1.0e-12,
            "{}: {} != {want_spd}",
            capture.file,
            decoded.seconds_per_div
        );
        assert_eq!(
            decoded.timestamp14,
            expected.timestamp14.clone().unwrap_or_default(),
            "{}: 14-digit capture timestamp",
            capture.file
        );
        if let Some(want) = &expected.timestamps {
            for channel in &decoded.channels {
                assert_eq!(
                    channel.timestamps.len(),
                    channel.samples,
                    "{}: timestamp vector length",
                    capture.file
                );
                assert!(
                    (channel.delta_t - want.delta_t).abs() <= want.delta_t.abs().max(1.0) * 1.0e-9,
                    "{}: delta_t {} != {:e}",
                    capture.file,
                    channel.delta_t,
                    want.delta_t
                );
                // Stored time axis (issue #105): the center sample
                // carries the manifest center, trigger-relative.
                assert_eq!(
                    channel.timestamps[channel.samples / 2],
                    want.t_center as f32,
                    "{}: center sample carries the stored center",
                    capture.file
                );
                assert!(
                    (f64::from(channel.timestamps[0]) - want.t_first).abs()
                        <= want.t_first.abs() * 1.0e-6 + 1.0e-9,
                    "{}: t_first {} != {:e}",
                    capture.file,
                    channel.timestamps[0],
                    want.t_first
                );
                assert!(
                    (f64::from(channel.timestamps[channel.samples - 1]) - want.t_last).abs()
                        <= want.t_last.abs() * 1.0e-6 + 1.0e-9,
                    "{}: t_last {} != {:e}",
                    capture.file,
                    channel.timestamps[channel.samples - 1],
                    want.t_last
                );
            }
        }
    }
    assert_eq!(
        decoded_waveforms, 10,
        "every waveform capture fully decodes; the settings variant rejects"
    );
}

/// Issue #107 accrual: per-record vertical metadata ground truth for the
/// captures that carry it (schema 2). The parser does not decode these
/// slots yet (issues #103-#105), so the test reads the documented
/// param-block offsets directly from the file bytes — the same precedent
/// as the embedded-timebase slot probe above.
const WINDOW_MIN_SLOT: usize = 126;
const UNIT_SLOT: usize = 312;
const UNIT_SLOT_LEN: usize = 4;
const UNIT_FAMILY_SLOT: usize = 324;
const SCALE_SLOT: usize = 328;
const SCALE_DUP_SLOT: usize = 344;
const WINDOW_DUP_SLOT: usize = 366;
const TIME_AXIS_LEFT_SLOT: usize = 20;
const TIME_AXIS_RIGHT_SLOT: usize = 44;
const SAMPLE_COUNT_SLOT: usize = 224;

fn read_f64_le(data: &[u8], offset: usize, file: &str) -> f64 {
    let bytes: [u8; 8] = data
        .get(offset..offset + 8)
        .unwrap_or_else(|| panic!("{file}: f64 slot past end at {offset}"))
        .try_into()
        .expect("eight bytes");
    f64::from_le_bytes(bytes)
}

fn read_u32_le(data: &[u8], offset: usize, file: &str) -> u32 {
    let bytes: [u8; 4] = data
        .get(offset..offset + 4)
        .unwrap_or_else(|| panic!("{file}: u32 slot past end at {offset}"))
        .try_into()
        .expect("four bytes");
    u32::from_le_bytes(bytes)
}

fn read_ascii_slot(data: &[u8], offset: usize, len: usize, file: &str) -> String {
    let slot = data
        .get(offset..offset + len)
        .unwrap_or_else(|| panic!("{file}: ascii slot past end at {offset}"));
    let end = slot
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(slot.len());
    String::from_utf8(slot[..end].to_vec())
        .unwrap_or_else(|error| panic!("{file}: ascii slot at {offset} is not UTF-8: {error}"))
}

/// Record param-block starts through the parser's own record discovery
/// (`walk_sectors` asserts descriptor count and exact EOF termination),
/// so the slot assertions below exercise the real record walk.
fn record_param_starts(data: &[u8], file: &str, records: usize) -> Vec<usize> {
    let table = locate_sector_table(data)
        .unwrap_or_else(|error| panic!("{file}: no sector table: {error}"));
    let sectors = walk_sectors(data, &table)
        .unwrap_or_else(|error| panic!("{file}: no record walk: {error}"));
    assert_eq!(
        sectors.len(),
        records,
        "{file}: record walk must cover every manifest record"
    );
    sectors.iter().map(|sector| sector.param_start).collect()
}

#[test]
fn local_corpus_vertical_metadata_per_manifest() {
    let Some(manifest) = load_empirical_manifest() else {
        return;
    };
    let Some(corpus) = resolve_corpus() else {
        println!("skipped: local captures not present");
        return;
    };
    let mut asserted_captures = 0;
    let mut asserted_records = 0;
    for capture in &manifest.captures {
        let Some(expected) = &capture.expected else {
            continue;
        };
        if !expected.records.iter().any(|record| record.unit.is_some()) {
            continue;
        }
        asserted_captures += 1;
        let data = fs::read(corpus.join(&capture.file))
            .unwrap_or_else(|error| panic!("local capture {} is required: {error}", capture.file));
        for evidence in &expected.evidence {
            let bytes = fs::read(corpus.join(&evidence.file)).unwrap_or_else(|error| {
                panic!("local evidence {} is required: {error}", evidence.file)
            });
            assert_eq!(
                bytes.len() as u64,
                evidence.size,
                "{} evidence size deviates from the manifest",
                evidence.file
            );
            assert_eq!(
                sha256_hex(&bytes),
                evidence.sha256,
                "{} evidence content deviates from the manifest",
                evidence.file
            );
        }
        let params = record_param_starts(&data, &capture.file, expected.records.len());
        let t_axis = expected
            .t_axis
            .as_ref()
            .unwrap_or_else(|| panic!("{}: manifest carries tAxis", capture.file));
        for (param, want) in params.iter().zip(&expected.records) {
            asserted_records += 1;
            let tag = format!("{} {}", capture.file, want.label);
            let count = read_u32_le(&data, param + SAMPLE_COUNT_SLOT, &capture.file) as usize;
            assert_eq!(
                count as u64,
                want.samples.expect("physical sample count"),
                "{tag}: sample count slot"
            );
            let unit = read_ascii_slot(&data, param + UNIT_SLOT, UNIT_SLOT_LEN, &capture.file);
            assert_eq!(
                unit,
                want.unit.clone().expect("unit"),
                "{tag}: channel unit"
            );
            assert_eq!(
                read_u32_le(&data, param + UNIT_FAMILY_SLOT, &capture.file),
                want.unit_family.expect("unit family"),
                "{tag}: unit-family code passes through verbatim"
            );
            let window_min = read_f64_le(&data, param + WINDOW_MIN_SLOT, &capture.file);
            let window_max = read_f64_le(&data, param + WINDOW_MIN_SLOT + 8, &capture.file);
            let want_min = want.window_min.expect("window min");
            let want_max = want.window_max.expect("window max");
            assert!(
                (window_min - want_min).abs() <= want_min.abs().max(1.0) * 1.0e-12,
                "{tag}: window_min {window_min} != {want_min}"
            );
            assert!(
                (window_max - want_max).abs() <= want_max.abs().max(1.0) * 1.0e-12,
                "{tag}: window_max {window_max} != {want_max}"
            );
            let scale = read_f64_le(&data, param + SCALE_SLOT, &capture.file);
            let want_scale = want.scale.expect("scale");
            assert!(
                (scale - want_scale).abs() <= want_scale.abs().max(1.0) * 1.0e-12,
                "{tag}: scale {scale} != {want_scale}"
            );
            assert_eq!(
                read_f64_le(&data, param + SCALE_DUP_SLOT, &capture.file).to_bits(),
                scale.to_bits(),
                "{tag}: scale duplicate at +344"
            );
            assert_eq!(
                read_f64_le(&data, param + WINDOW_DUP_SLOT, &capture.file).to_bits(),
                window_min.to_bits(),
                "{tag}: window-min duplicate at +366"
            );
            assert_eq!(
                read_f64_le(&data, param + WINDOW_DUP_SLOT + 8, &capture.file).to_bits(),
                window_max.to_bits(),
                "{tag}: window-max duplicate at +374"
            );
            let want_per_div = want.per_div.expect("per-division value");
            assert!(
                ((window_max - window_min) / 8.0 - want_per_div).abs()
                    <= want_per_div.abs().max(1.0) * 1.0e-12,
                "{tag}: per-division is not (window span)/8"
            );
            assert!(
                (3_200.0 * scale - want_per_div).abs() <= want_per_div.abs().max(1.0) * 1.0e-12,
                "{tag}: per-division is not 3200 x S"
            );
            let t_left = read_f64_le(&data, param + TIME_AXIS_LEFT_SLOT, &capture.file);
            let t_right = read_f64_le(&data, param + TIME_AXIS_RIGHT_SLOT, &capture.file);
            assert!(
                (t_left - t_axis.t_left).abs() <= t_axis.t_left.abs().max(1.0) * 1.0e-12,
                "{tag}: t_left {t_left} != {}",
                t_axis.t_left
            );
            assert!(
                (t_right - t_axis.t_right).abs() <= t_axis.t_right.abs().max(1.0) * 1.0e-12,
                "{tag}: t_right {t_right} != {}",
                t_axis.t_right
            );
            let payload_start = param + PARAM_BLOCK_LEN;
            let mut raw_max = i32::MIN;
            let mut raw_min = i32::MAX;
            let mut saturated_low = 0usize;
            let mut saturated_high = 0usize;
            for index in 0..count {
                let at = payload_start + 4 * index;
                let sample =
                    i32::from_le_bytes(data[at..at + 4].try_into().expect("four payload bytes"));
                raw_max = raw_max.max(sample);
                raw_min = raw_min.min(sample);
                if sample == i32::MAX {
                    saturated_high += 1;
                }
                if sample == i32::MIN {
                    saturated_low += 1;
                }
            }
            let want_raw_max = want.raw_max.expect("raw max");
            let want_raw_min = want.raw_min.expect("raw min");
            assert_eq!(raw_max as i64, want_raw_max, "{tag}: raw max count");
            assert_eq!(raw_min as i64, want_raw_min, "{tag}: raw min count");
            let want_physical_max = want.physical_max.expect("physical max");
            let want_physical_min = want.physical_min.expect("physical min");
            assert_eq!(
                (raw_max as f64 * scale).to_bits(),
                want_physical_max.to_bits(),
                "{tag}: max converts as raw x S"
            );
            assert_eq!(
                (raw_min as f64 * scale).to_bits(),
                want_physical_min.to_bits(),
                "{tag}: min converts as raw x S"
            );
            let saturated = want.saturated.as_ref().expect("saturated counts");
            match (saturated.low_rail, saturated.high_rail) {
                (Some(low_rail), Some(high_rail)) => {
                    let (low, high) = (low_rail as i32, high_rail as i32);
                    let (mut low_count, mut high_count) = (0usize, 0usize);
                    for index in 0..count {
                        let at = payload_start + 4 * index;
                        let sample = i32::from_le_bytes(
                            data[at..at + 4].try_into().expect("four payload bytes"),
                        );
                        if sample == low {
                            low_count += 1;
                        }
                        if sample == high {
                            high_count += 1;
                        }
                    }
                    assert_eq!(low_count, saturated.low, "{tag}: low-rail count");
                    assert_eq!(high_count, saturated.high, "{tag}: high-rail count");
                }
                (None, Some(high_rail)) => {
                    let high = high_rail as i32;
                    let mut high_count = 0usize;
                    for index in 0..count {
                        let at = payload_start + 4 * index;
                        let sample = i32::from_le_bytes(
                            data[at..at + 4].try_into().expect("four payload bytes"),
                        );
                        if sample == high {
                            high_count += 1;
                        }
                    }
                    assert_eq!(0, saturated.low, "{tag}: no low saturation");
                    assert_eq!(high_count, saturated.high, "{tag}: high-rail count");
                }
                (None, None) => {
                    assert_eq!(
                        saturated.low, 0,
                        "{tag}: manifest carries no low saturation"
                    );
                    assert_eq!(
                        saturated.high, 0,
                        "{tag}: manifest carries no high saturation"
                    );
                    assert_eq!(saturated_low, 0, "{tag}: no i32::MIN sample");
                    assert_eq!(saturated_high, 0, "{tag}: no i32::MAX sample");
                }
                (Some(_), None) => panic!("{tag}: low rail without a high rail is not modeled"),
            }
        }
    }
    assert_eq!(
        asserted_captures, 2,
        "both new captures assert vertical metadata"
    );
    assert_eq!(
        asserted_records, 8,
        "all eight new records assert vertical metadata"
    );
}

/// Issue #103 accrual: the parser-decoded channel fields match the
/// manifest ground truth for all eight evidence-table rows, and the
/// The derived math record exposes its deviating reads verbatim without
/// warnings (derived layouts skip validation per ADR 0007).
#[test]
fn local_corpus_parser_exposes_vertical_metadata() {
    let Some(manifest) = load_empirical_manifest() else {
        return;
    };
    let Some(corpus) = resolve_corpus() else {
        println!("skipped: local captures not present");
        return;
    };
    let mut asserted = 0;
    for capture in &manifest.captures {
        let Some(expected) = &capture.expected else {
            continue;
        };
        if !expected.records.iter().any(|record| record.unit.is_some()) {
            continue;
        }
        let data = fs::read(corpus.join(&capture.file))
            .unwrap_or_else(|error| panic!("local capture {} is required: {error}", capture.file));
        let decoded = decode_capture(&data)
            .unwrap_or_else(|error| panic!("{}: unexpected {error}", capture.file));
        let physical: Vec<_> = expected
            .records
            .iter()
            .filter(|record| !record.derived)
            .collect();
        assert_eq!(
            decoded.channels.len(),
            physical.len(),
            "{}: physical channel count",
            capture.file
        );
        for (channel, want) in decoded.channels.iter().zip(&physical) {
            asserted += 1;
            let tag = format!("{} {}", capture.file, want.label);
            assert_eq!(
                channel.unit,
                want.unit.clone().expect("unit"),
                "{tag}: unit"
            );
            assert_eq!(
                channel.unit_family,
                want.unit_family.expect("unit family"),
                "{tag}: unit family verbatim"
            );
            assert_eq!(
                channel.window_min,
                want.window_min.expect("window min"),
                "{tag}: min"
            );
            assert_eq!(
                channel.window_max,
                want.window_max.expect("window max"),
                "{tag}: max"
            );
            assert_eq!(channel.scale, want.scale.expect("scale"), "{tag}: scale");
            assert_eq!(
                channel.per_div,
                want.per_div.expect("per-div"),
                "{tag}: per-div"
            );
        }
    }
    assert_eq!(asserted, 8, "every evidence-table row decodes its metadata");

    let Some(manifest) = load_empirical_manifest() else {
        return;
    };
    let derived_math = capture_name_by_shape(&manifest, is_derived_math);
    let data = fs::read(corpus.join(&derived_math))
        .unwrap_or_else(|error| panic!("local capture {derived_math} is required: {error}"));
    let decoded = decode_capture(&data).expect("the derived-math capture decodes");
    // The math record extent-decodes with the legacy estimate, so its
    // typed warning is the only one on the file.
    assert_eq!(
        decoded
            .warnings
            .iter()
            .map(|warning| warning.code())
            .collect::<Vec<_>>(),
        ["derived_legacy_values"],
        "{derived_math}: warnings"
    );
    // Eingang C is a standard kilovolt record: `kV` is an established
    // unit, so it parses warning-free.
    let kilovolt = decoded
        .channels
        .iter()
        .find(|channel| channel.letter == b'C')
        .expect("the derived-math capture carries channel C");
    assert_eq!(kilovolt.unit, "kV", "{derived_math}: standard kV record");
    // The math record's param block deviates from the standard layout, so
    // its chain-relative reads are opaque instrument bytes: exposed
    // verbatim, never validated, with only the legacy-estimate warning.
    assert_eq!(
        decoded.derived_channels.len(),
        1,
        "{derived_math}: math record still extent-decodes"
    );
}

/// Issue #104 accrual: Scope34's saturated channels decode to physical
/// values with NaN rails, pinned against the FlukeView screenshot
/// datablock (`scope 34 ... .png`, local-only OCR ground truth):
/// Input B Maximum 591.31 A / Minimum −583.13 A and Input D Maximum
/// 665.38 V / Minimum −690.31 V are exactly raw × S.
///
/// Rail map (bytes, manifest, and screenshot agree — Maximum/Minimum
/// read Overload/Underload exactly where rails occur): Input A carries
/// 123 low-rail (`i32::MIN + 2`) and 296 high-rail samples, Input C
/// carries 7880 high-rail samples, B and D are rail-free. Note the
/// scale slot is in base-SI units, so channel C (unit `mA`) decodes in
/// the A domain — the ×1000 display fold belongs to issue #106.
#[test]
fn local_corpus_ocr_physical_values_match_the_screenshot() {
    let Some(manifest) = load_empirical_manifest() else {
        return;
    };
    let Some(corpus) = resolve_corpus() else {
        println!("skipped: local captures not present");
        return;
    };
    let ocr_capture = capture_name_by_shape(&manifest, is_ocr_verified_quad);
    let data = fs::read(corpus.join(&ocr_capture))
        .unwrap_or_else(|error| panic!("local capture {ocr_capture} is required: {error}"));
    let decoded = decode_capture(&data).expect("the OCR-verified capture decodes");
    assert_eq!(decoded.channels.len(), 4, "{ocr_capture}: four inputs");

    let channel = |letter: u8| {
        decoded
            .channels
            .iter()
            .find(|channel| channel.letter == letter)
            .unwrap_or_else(|| panic!("{ocr_capture}: channel {letter}"))
    };
    let finite_extremes = |letter: u8| {
        let channel = channel(letter);
        let mut min = f32::INFINITY;
        let mut max = f32::NEG_INFINITY;
        for value in &channel.values {
            if !value.is_nan() {
                min = min.min(*value);
                max = max.max(*value);
            }
        }
        (min, max)
    };

    // Input B (A, S = 0.0625): screenshot Maximum 591.31 / Minimum
    // −583.13 are exactly 9461 × S and −9330 × S.
    let b = channel(b'B');
    assert_eq!((b.unit.as_str(), b.scale), ("A", 0.0625));
    assert_eq!(b.saturated_sample_count, 0);
    assert_eq!(finite_extremes(b'B'), (-583.125, 591.3125));
    // Input D (V, S = 0.0625): screenshot Maximum 665.38 / Minimum
    // −690.31 are exactly 10646 × S and −11045 × S.
    let d = channel(b'D');
    assert_eq!((d.unit.as_str(), d.scale), ("V", 0.0625));
    assert_eq!(d.saturated_sample_count, 0);
    assert_eq!(finite_extremes(b'D'), (-690.3125, 665.375));

    // Input A: 123 low-rail + 296 high-rail samples read NaN; the
    // remaining extremes are 11921 × S and −17458 × S (exact in f32,
    // written as the raw × S identity).
    let a = channel(b'A');
    assert_eq!(a.saturated_sample_count, 123 + 296);
    assert_eq!(
        a.values.iter().filter(|value| value.is_nan()).count(),
        123 + 296
    );
    assert_eq!(
        finite_extremes(b'A'),
        (
            (f64::from(-17_458) * a.scale) as f32,
            (f64::from(11_921) * a.scale) as f32
        )
    );

    // Input C (unit mA, S in A): 7880 high-rail samples read NaN; the
    // surviving minimum is −441 × S.
    let c = channel(b'C');
    assert_eq!(c.unit.as_str(), "mA");
    assert_eq!(c.saturated_sample_count, 7_880);
    let c_min = c
        .values
        .iter()
        .filter(|value| !value.is_nan())
        .copied()
        .reduce(f32::min)
        .expect("non-rail samples survive");
    assert_eq!(c_min, (f64::from(-441) * c.scale) as f32);

    // Exactly two saturation warnings, in record order.
    let mut warnings = decoded.warnings.iter();
    let first = warnings.next().expect("A saturation warning");
    let second = warnings.next().expect("C saturation warning");
    assert!(
        warnings.next().is_none(),
        "{ocr_capture}: no further warnings"
    );
    assert_eq!(first.code(), "saturated_samples");
    assert_eq!(second.code(), "saturated_samples");
    assert!(
        matches!(
            (first, second),
            (
                fvf_wasm::error::ParseWarning::SaturatedSamples {
                    label: first_label,
                    low: 123,
                    high: 296
                },
                fvf_wasm::error::ParseWarning::SaturatedSamples {
                    label: second_label,
                    low: 0,
                    high: 7_880
                }
            ) if first_label == "Input A" && second_label == "Input C"
        ),
        "{ocr_capture}: warning shapes: {:?}",
        decoded.warnings
    );

    // The manifest's saturated blocks agree with the decode.
    let capture = manifest
        .captures
        .iter()
        .find(|capture| capture.file == ocr_capture)
        .expect("OCR-verified capture manifest entry");
    let expected = capture
        .expected
        .as_ref()
        .expect("OCR-verified capture expectations");
    for record in expected.records.iter().filter(|record| !record.derived) {
        let saturated = record.saturated.as_ref().expect("saturated block");
        let letter = record.letter.as_ref().expect("letter").as_bytes()[0];
        assert_eq!(
            channel(letter).saturated_sample_count,
            saturated.low + saturated.high,
            "{ocr_capture} {}: manifest saturated counts",
            record.label
        );
    }
}

/// Issue #104 accrual: every golden spot-check row from the issue — the
/// comma-decimal corpus capture's extremes — decodes as raw × S, matching
/// the FlukeView OCR readouts to their quoted digit.
/// Scales are unit fractions (A: 1/640, B: 1/1600, C: 1/16, D: 1/320),
/// so the physical extremes below are exact in f32.
#[test]
fn local_corpus_comma_decimal_golden_rows_match_flukeview_ocr() {
    let Some(manifest) = load_empirical_manifest() else {
        return;
    };
    let Some(corpus) = resolve_corpus() else {
        println!("skipped: local captures not present");
        return;
    };
    let golden_name = capture_name_by_shape(&manifest, is_comma_decimal_quad);
    let data = fs::read(corpus.join(&golden_name))
        .unwrap_or_else(|error| panic!("local capture {golden_name} is required: {error}"));
    let decoded = decode_capture(&data).expect("the golden capture decodes");
    assert!(decoded.warnings.is_empty(), "{golden_name}: rail-free");
    assert_eq!(decoded.channels.len(), 4, "{golden_name}: four inputs");

    // (letter, scale, raw max, raw min, OCR max, OCR min): the OCR
    // column quotes the FlukeView datablock to its displayed digits
    // (D max has no issue row; the raw × S identity pins it instead).
    /// One golden spot-check row: the scale unit fraction, the raw
    /// extremes, and the FlukeView OCR readouts quoted to their
    /// displayed digits.
    struct GoldenRow {
        letter: u8,
        scale: f64,
        raw_max: i32,
        raw_min: i32,
        ocr_max: Option<f64>,
        ocr_min: Option<f64>,
    }
    let golden = [
        GoldenRow {
            letter: b'A',
            scale: 1.0 / 640.0,
            raw_max: 3_846,
            raw_min: -2_151,
            ocr_max: Some(6.009),
            ocr_min: Some(-3.361),
        },
        GoldenRow {
            letter: b'B',
            scale: 1.0 / 1_600.0,
            raw_max: 11_976,
            raw_min: -774,
            ocr_max: Some(7.4850),
            ocr_min: Some(-0.4838),
        },
        GoldenRow {
            letter: b'C',
            scale: 1.0 / 16.0,
            raw_max: 199,
            raw_min: -326,
            ocr_max: Some(12.44),
            ocr_min: Some(-20.38),
        },
        // D max has no issue row; the raw × S identity pins it instead.
        GoldenRow {
            letter: b'D',
            scale: 1.0 / 320.0,
            raw_max: -2_623,
            raw_min: -5_939,
            ocr_max: None,
            ocr_min: Some(-18.559),
        },
    ];
    for row in golden {
        let GoldenRow {
            letter,
            scale,
            raw_max,
            raw_min,
            ocr_max,
            ocr_min,
        } = row;
        let channel = decoded
            .channels
            .iter()
            .find(|channel| channel.letter == letter)
            .unwrap_or_else(|| panic!("{golden_name}: channel {letter}"));
        let tag = format!("{golden_name} {}", channel.record_label);
        assert_eq!(channel.scale, scale, "{tag}: scale is the unit fraction");
        assert_eq!(channel.saturated_sample_count, 0, "{tag}: no rails");
        let values_max = channel
            .values
            .iter()
            .copied()
            .reduce(f32::max)
            .expect("samples");
        let values_min = channel
            .values
            .iter()
            .copied()
            .reduce(f32::min)
            .expect("samples");
        // Exact raw × S identity at both extremes ...
        assert_eq!(
            values_max,
            (f64::from(raw_max) * scale) as f32,
            "{tag}: max"
        );
        assert_eq!(
            values_min,
            (f64::from(raw_min) * scale) as f32,
            "{tag}: min"
        );
        // ... and the raw lane carries the manifest counts there.
        assert!(
            channel.raw_counts.contains(&raw_max),
            "{tag}: raw max count present"
        );
        assert!(
            channel.raw_counts.contains(&raw_min),
            "{tag}: raw min count present"
        );
        // FlukeView OCR linkage: display rounding only (a wrong scale
        // would miss by orders of magnitude).
        for (value, ocr) in [(values_max, ocr_max), (values_min, ocr_min)] {
            if let Some(ocr) = ocr {
                assert!(
                    (f64::from(value) - ocr).abs() <= 6.0e-3,
                    "{tag}: {value} vs FlukeView {ocr}"
                );
            }
        }
    }
}
