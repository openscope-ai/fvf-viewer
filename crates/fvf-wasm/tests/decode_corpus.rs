//! Manifest-driven full-decode conformance over the committed synthetic
//! mirror corpus (issue #8 acceptance): channel/derived counts, per-channel
//! sample counts, timestamp reconstruction at the envelope extremes,
//! typed rejections, an independent LCG re-derivation of the sample
//! values, and truncation sweeps that prove unaligned payloads never
//! panic.

use std::fs;
use std::path::{Path, PathBuf};

use fvf_wasm::header::locate_sector_table;
use fvf_wasm::records::{decode_capture, walk_sectors};
use serde::Deserialize;

#[derive(Deserialize)]
struct Manifest {
    fixtures: Vec<FixtureEntry>,
}

#[derive(Deserialize)]
struct FixtureEntry {
    file: String,
    expected: Expected,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expected {
    outcome: String,
    #[serde(default)]
    warnings: Vec<String>,
    #[serde(default)]
    timebase_raw: Option<String>,
    #[serde(default)]
    seconds_per_div: Option<f64>,
    #[serde(default)]
    channels: Vec<ChannelExpectation>,
    #[serde(default)]
    expected_error_code: Option<String>,
    #[serde(default)]
    timestamps: Option<TimestampsExpectation>,
    #[serde(default)]
    t_axis: Option<TAxisExpectation>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelExpectation {
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
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TAxisExpectation {
    t_left: f64,
    t_right: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TimestampsExpectation {
    delta_t: f64,
    t_first: f64,
    t_last: f64,
    t_center: f64,
    samples: u64,
}

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn manifest() -> Manifest {
    let raw =
        fs::read_to_string(fixtures_dir().join("manifest.json")).expect("manifest.json is present");
    serde_json::from_str(&raw).expect("manifest.json parses")
}

fn fixture_bytes(file: &str) -> Vec<u8> {
    let name = file.strip_prefix("synthetic/").unwrap_or(file);
    fs::read(fixtures_dir().join("synthetic").join(name))
        .unwrap_or_else(|error| panic!("reading committed fixture {file}: {error}"))
}

/// f64-vs-oracle tolerance for values produced by the same formula.
fn close(actual: f64, want: f64) -> bool {
    (actual - want).abs() <= want.abs().max(1.0) * 1.0e-9
}

/// f32-sample-vs-f64-oracle tolerance (one f32 rounding).
fn close_f32(actual: f32, want: f64) -> bool {
    (f64::from(actual) - want).abs() <= want.abs() * 1.0e-6 + 1.0e-9
}

fn assert_timestamps(
    file: &str,
    samples: usize,
    delta_t: f64,
    times: &[f32],
    want: &TimestampsExpectation,
) {
    assert_eq!(times.len(), samples, "{file}: timestamp vector length");
    assert_eq!(
        samples as u64, want.samples,
        "{file}: channel shares the manifest sample count"
    );
    assert!(
        close(delta_t, want.delta_t),
        "{file}: delta_t {delta_t:e} != {:e}",
        want.delta_t
    );
    // Stored time axis (issue #105): the center sample carries the
    // manifest center, trigger-relative rather than display-centered.
    assert_eq!(
        times[samples / 2],
        want.t_center as f32,
        "{file}: center sample carries the stored center"
    );
    assert!(
        close_f32(times[0], want.t_first),
        "{file}: t_first {} != {:e}",
        times[0],
        want.t_first
    );
    assert!(
        close_f32(times[samples - 1], want.t_last),
        "{file}: t_last {} != {:e}",
        times[samples - 1],
        want.t_last
    );
    for pair in times.windows(2) {
        assert!(pair[0] <= pair[1], "{file}: timestamps are monotonic");
    }
}

#[test]
fn full_corpus_decodes_per_manifest() {
    let mut accepted = 0;
    for fixture in manifest().fixtures {
        let bytes = fixture_bytes(&fixture.file);
        match fixture.expected.outcome.as_str() {
            "accepted" => {
                let decoded = decode_capture(&bytes)
                    .unwrap_or_else(|error| panic!("{}: unexpected {error}", fixture.file));
                accepted += 1;
                let mut got: Vec<String> = decoded
                    .warnings
                    .iter()
                    .map(|warning| warning.code().to_owned())
                    .collect();
                got.sort();
                let mut want = fixture.expected.warnings.clone();
                want.sort();
                assert_eq!(
                    got, want,
                    "{}: warning codes match the manifest",
                    fixture.file
                );
                let physical: Vec<_> = fixture
                    .expected
                    .channels
                    .iter()
                    .filter(|channel| !channel.derived)
                    .collect();
                let derived: Vec<_> = fixture
                    .expected
                    .channels
                    .iter()
                    .filter(|channel| channel.derived)
                    .collect();
                assert_eq!(
                    decoded.channels.len(),
                    physical.len(),
                    "{}: physical channel count",
                    fixture.file
                );
                assert_eq!(
                    decoded.derived_channels.len(),
                    derived.len(),
                    "{}: derived channel count",
                    fixture.file
                );
                for (channel, want) in decoded.channels.iter().zip(&physical) {
                    assert_eq!(
                        channel.letter,
                        want.letter.as_ref().expect("physical letter").as_bytes()[0],
                        "{}: letter",
                        fixture.file
                    );
                    assert_eq!(
                        channel.record_label, want.label,
                        "{}: record label",
                        fixture.file
                    );
                    assert_eq!(
                        channel.samples as u64,
                        want.samples.expect("physical sample count"),
                        "{}: {} sample count",
                        fixture.file,
                        want.label
                    );
                    assert_eq!(
                        channel.values.len(),
                        channel.samples,
                        "{}: values decode per sample",
                        fixture.file
                    );
                    assert_eq!(
                        channel.raw_counts.len(),
                        channel.samples,
                        "{}: raw counts decode per sample",
                        fixture.file
                    );
                    assert_eq!(
                        channel.saturated_sample_count, 0,
                        "{}: synthetic fixtures carry no saturation rails",
                        fixture.file
                    );
                }
                for (channel, want) in decoded.derived_channels.iter().zip(&derived) {
                    assert_eq!(
                        channel.record_label, want.label,
                        "{}: derived record label",
                        fixture.file
                    );
                    assert_eq!(
                        channel.samples.map(|count| count as u64),
                        want.samples,
                        "{}: derived sample count",
                        fixture.file
                    );
                    let want_sources: Vec<u8> = want
                        .source_channels
                        .as_ref()
                        .map(|letters| letters.iter().map(|letter| letter.as_bytes()[0]).collect())
                        .unwrap_or_default();
                    assert_eq!(
                        channel.source_channels, want_sources,
                        "{}: derived source channels",
                        fixture.file
                    );
                    if let Some(samples) = channel.samples {
                        assert_eq!(
                            channel.values.len(),
                            samples,
                            "{}: derived values decode per sample",
                            fixture.file
                        );
                        assert_eq!(
                            channel.raw_counts.len(),
                            samples,
                            "{}: derived raw counts decode per sample",
                            fixture.file
                        );
                        assert_eq!(
                            channel.saturated_sample_count, 0,
                            "{}: legacy derived estimate carries no NaN rule",
                            fixture.file
                        );
                    }
                }
                assert_eq!(
                    decoded.timebase_raw,
                    fixture.expected.timebase_raw.clone().unwrap_or_default(),
                    "{}: embedded timebase token",
                    fixture.file
                );
                let want_spd = fixture
                    .expected
                    .seconds_per_div
                    .unwrap_or_else(|| panic!("{}: manifest carries secondsPerDiv", fixture.file));
                assert!(
                    close(decoded.seconds_per_div, want_spd),
                    "{}: {} != {want_spd}",
                    fixture.file,
                    decoded.seconds_per_div
                );
                if let Some(want) = fixture.expected.timestamps {
                    for channel in &decoded.channels {
                        assert_timestamps(
                            &fixture.file,
                            channel.samples,
                            channel.delta_t,
                            &channel.timestamps,
                            &want,
                        );
                    }
                    for channel in &decoded.derived_channels {
                        if let (Some(samples), Some(delta_t)) = (channel.samples, channel.delta_t) {
                            assert_timestamps(
                                &fixture.file,
                                samples,
                                delta_t,
                                &channel.timestamps,
                                &want,
                            );
                        }
                    }
                }
            }
            outcome => {
                let error = decode_capture(&bytes)
                    .err()
                    .unwrap_or_else(|| panic!("{} must be rejected", fixture.file));
                assert_eq!(
                    error.code(),
                    fixture
                        .expected
                        .expected_error_code
                        .as_deref()
                        .unwrap_or_else(|| panic!("{}: manifest carries the code", fixture.file)),
                    "{}: rejection code for outcome {outcome}",
                    fixture.file
                );
            }
        }
    }
    assert_eq!(accepted, 8, "every accepted fixture decoded");
}

/// Independent re-derivation of the synthesizer's deterministic sample
/// stream (FNV-1a-32 seed + 32-bit LCG, per the fixtures README): if the
/// reader misplaced a payload by even one byte, every value would drift.
/// This counters writer/reader lockstep blindness without importing the
/// synthesizer module.
fn fnv1a(text: &str) -> u32 {
    let mut hash: u32 = 0x811C_9DC5;
    for byte in text.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

/// Independent LCG re-derivation of the synthesizer stream (issue
/// #104): physical values are `raw × S` computed in f32 arithmetic
/// against the decoder's f64 path, so agreement proves the scale wiring
/// rather than formula lockstep; derived values keep the legacy
/// `raw / 65536` estimate.
fn expected_values(
    fixture: &str,
    channel: usize,
    scale: f32,
    derived_offset: bool,
    count: usize,
) -> Vec<f32> {
    let mut state = fnv1a(fixture) ^ 0x9E37_79B9_u32.wrapping_mul(channel as u32 + 1);
    (0..count)
        .map(|_| {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let raw = (((state >> 8) & 0xFFFF) as i32) - 32_768;
            let raw = if derived_offset {
                raw.wrapping_add(4_096)
            } else {
                raw
            };
            if derived_offset {
                raw as f32 / 65_536.0
            } else {
                raw as f32 * scale
            }
        })
        .collect()
}

fn assert_values_close(actual: &[f32], want: &[f32], tag: &str) {
    assert_eq!(actual.len(), want.len(), "{tag}: sample count");
    for (index, (got, want)) in actual.iter().zip(want).enumerate() {
        assert!(
            close_f32(*got, f64::from(*want)),
            "{tag} sample {index}: {got} != {want}"
        );
    }
}

#[test]
fn decoded_values_match_the_synthesizer_lcg_stream() {
    let cases: [(&str, &[f32], usize); 6] = [
        (
            "accepted-en-4ch-10000-10ms-div.fvf.bin",
            &[0.0625; 4],
            10_000,
        ),
        (
            "accepted-de-eingang-1ch-3000-comma-decimal.fvf.bin",
            &[0.0625],
            3_000,
        ),
        (
            "nonsequential-abd-3ch-10000-20ms-div.fvf.bin",
            &[0.0625; 3],
            10_000,
        ),
        (
            "accepted-en-2ch-current-offcenter-1s-div.fvf.bin",
            &[0.015_625, 0.000_031_25],
            9_636,
        ),
        (
            "extreme-envelope-4ch-500-10ms-div.fvf.bin",
            &[0.0625; 4],
            500,
        ),
        (
            "extreme-envelope-1ch-250000-10ms-div.fvf.bin",
            &[0.0625],
            250_000,
        ),
    ];
    for (name, scales, samples) in cases {
        let decoded =
            decode_capture(&fixture_bytes(name)).unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(decoded.channels.len(), scales.len(), "{name}");
        for (index, channel) in decoded.channels.iter().enumerate() {
            assert_eq!(channel.samples, samples, "{name}");
            let tag = format!("{name} channel {}", channel.record_label);
            assert_values_close(
                &channel.values,
                &expected_values(name, index, scales[index], false, samples),
                &tag,
            );
            // Verbatim raw counts shadow the values lane sample for
            // sample (no rails in the synthetic corpus).
            assert_eq!(channel.raw_counts.len(), samples, "{tag}");
            for (value, raw) in channel.values.iter().zip(&channel.raw_counts) {
                assert!(
                    close_f32(*value, f64::from(*raw) * f64::from(scales[index])),
                    "{tag}: value {value} != raw {raw} x S"
                );
            }
        }
    }

    // Derived payload = source stream + 4096 raw counts; the physical
    // record decodes as raw x S while the derived record keeps the
    // legacy raw / 65536 estimate with a typed warning.
    let name = "derived-mathematik-2ch-3000-10ms-div.fvf.bin";
    let decoded = decode_capture(&fixture_bytes(name)).expect("derived fixture decodes");
    assert_values_close(
        &decoded.channels[0].values,
        &expected_values(name, 0, 0.0625, false, 3_000),
        name,
    );
    assert_eq!(
        decoded.derived_channels[0].values,
        expected_values(name, 0, 0.0625, true, 3_000)
    );
    assert_eq!(
        decoded
            .warnings
            .iter()
            .map(|warning| warning.code())
            .collect::<Vec<_>>(),
        ["derived_legacy_values"],
        "{name}: legacy estimate carries its typed warning"
    );
}

#[test]
fn envelope_extremes_carry_the_documented_timestamp_envelope() {
    for (name, samples, delta_t) in [
        (
            "extreme-envelope-4ch-500-10ms-div.fvf.bin",
            500usize,
            2.0e-4f64,
        ),
        (
            "extreme-envelope-1ch-250000-10ms-div.fvf.bin",
            250_000,
            4.0e-7,
        ),
    ] {
        let decoded =
            decode_capture(&fixture_bytes(name)).unwrap_or_else(|error| panic!("{name}: {error}"));
        for channel in &decoded.channels {
            assert_eq!(channel.samples, samples, "{name}");
            assert!(
                close(channel.delta_t, delta_t),
                "{name}: {} != {delta_t}",
                channel.delta_t
            );
            assert_eq!(channel.timestamps[samples / 2], 0.0, "{name}: t_center");
            assert_eq!(channel.timestamps.len(), samples, "{name}");
        }
    }
}

#[test]
fn truncation_sweeps_never_panic_and_report_typed_errors() {
    let short = fixture_bytes("extreme-envelope-4ch-500-10ms-div.fvf.bin");
    assert!(decode_capture(&short).is_ok());
    for length in 0..short.len() {
        let error = decode_capture(&short[..length])
            .err()
            .unwrap_or_else(|| panic!("truncation at {length} must not parse"));
        assert_eq!(error.code(), "truncated_capture", "at {length}");
    }

    // The 1 MB fixture gets boundary-focused probes, not a full sweep.
    let deep = fixture_bytes("extreme-envelope-1ch-250000-10ms-div.fvf.bin");
    assert!(decode_capture(&deep).is_ok());
    let mut lengths = vec![0, 8, 205, 206, 462, 826, 827, 829, 830, 831, 838, 100_0895];
    for length in (831..deep.len()).step_by(9_973) {
        lengths.push(length);
    }
    lengths.push(deep.len() - 1);
    for length in lengths {
        let error = decode_capture(&deep[..length])
            .err()
            .unwrap_or_else(|| panic!("deep truncation at {length} must not parse"));
        assert_eq!(error.code(), "truncated_capture", "at {length}");
    }
}

/// Issue #107 accrual: the synthesizer-written vertical metadata and
/// stored time axis in every accepted fixture, read at the documented
/// param-block slots through the parser's own record walk. The parser
/// itself decodes these slots in issues #103-#105; here the committed
/// bytes are pinned so those issues migrate against fixed ground truth.
#[test]
fn fixture_stored_metadata_matches_manifest() {
    const PARAM_BLOCK_LEN: usize = 388;
    const TIME_AXIS_LEFT_SLOT: usize = 20;
    const TIME_AXIS_RIGHT_SLOT: usize = 44;
    const WINDOW_MIN_SLOT: usize = 126;
    const UNIT_SLOT: usize = 312;
    const UNIT_FAMILY_SLOT: usize = 324;
    const SCALE_SLOT: usize = 328;
    const SCALE_DUP_SLOT: usize = 344;
    const WINDOW_DUP_SLOT: usize = 366;
    fn slot_f64(bytes: &[u8], param: usize, slot: usize, file: &str) -> f64 {
        f64::from_le_bytes(
            bytes[param + slot..param + slot + 8]
                .try_into()
                .unwrap_or_else(|_| panic!("{file}: f64 slot past end at +{slot}")),
        )
    }
    fn slot_u32(bytes: &[u8], param: usize, slot: usize, file: &str) -> u32 {
        u32::from_le_bytes(
            bytes[param + slot..param + slot + 4]
                .try_into()
                .unwrap_or_else(|_| panic!("{file}: u32 slot past end at +{slot}")),
        )
    }
    let mut asserted = 0;
    for fixture in manifest().fixtures {
        if fixture.expected.outcome != "accepted" {
            continue;
        }
        let bytes = fixture_bytes(&fixture.file);
        let table = locate_sector_table(&bytes)
            .unwrap_or_else(|error| panic!("{}: no sector table: {error}", fixture.file));
        let sectors = walk_sectors(&bytes, &table)
            .unwrap_or_else(|error| panic!("{}: no record walk: {error}", fixture.file));
        assert_eq!(
            sectors.len(),
            fixture.expected.channels.len(),
            "{}: record walk covers every manifest channel",
            fixture.file
        );
        let t_axis = fixture
            .expected
            .t_axis
            .as_ref()
            .unwrap_or_else(|| panic!("{}: manifest carries tAxis", fixture.file));
        for (sector, want) in sectors.iter().zip(&fixture.expected.channels) {
            if want.derived {
                continue;
            }
            asserted += 1;
            let tag = format!("{} {}", fixture.file, want.label);
            let param = sector.param_start;
            let unit_raw = &bytes[param + UNIT_SLOT..param + UNIT_SLOT + 4];
            let end = unit_raw.iter().position(|byte| *byte == 0).unwrap_or(4);
            assert_eq!(
                String::from_utf8_lossy(&unit_raw[..end]),
                want.unit.clone().expect("unit"),
                "{tag}: channel unit"
            );
            assert_eq!(
                slot_u32(&bytes, param, UNIT_FAMILY_SLOT, &fixture.file),
                want.unit_family.expect("unit family"),
                "{tag}: unit-family code"
            );
            let window_min = slot_f64(&bytes, param, WINDOW_MIN_SLOT, &fixture.file);
            let window_max = slot_f64(&bytes, param, WINDOW_MIN_SLOT + 8, &fixture.file);
            assert_eq!(
                (window_min, window_max),
                (
                    want.window_min.expect("window min"),
                    want.window_max.expect("window max")
                ),
                "{tag}: vertical window"
            );
            let scale = slot_f64(&bytes, param, SCALE_SLOT, &fixture.file);
            assert_eq!(scale, want.scale.expect("scale"), "{tag}: scale factor");
            assert_eq!(
                slot_f64(&bytes, param, SCALE_DUP_SLOT, &fixture.file).to_bits(),
                scale.to_bits(),
                "{tag}: scale duplicate at +344"
            );
            assert_eq!(
                slot_f64(&bytes, param, WINDOW_DUP_SLOT, &fixture.file).to_bits(),
                window_min.to_bits(),
                "{tag}: window-min duplicate at +366"
            );
            assert_eq!(
                slot_f64(&bytes, param, WINDOW_DUP_SLOT + 8, &fixture.file).to_bits(),
                window_max.to_bits(),
                "{tag}: window-max duplicate at +374"
            );
            let want_per_div = want.per_div.expect("per-division value");
            assert!(
                close((window_max - window_min) / 8.0, want_per_div),
                "{tag}: per-division is (window span)/8"
            );
            assert!(
                close(3_200.0 * scale, want_per_div),
                "{tag}: per-division is 3200 x S"
            );
            assert!(
                close(
                    slot_f64(&bytes, param, TIME_AXIS_LEFT_SLOT, &fixture.file),
                    t_axis.t_left
                ),
                "{tag}: stored t_left"
            );
            assert!(
                close(
                    slot_f64(&bytes, param, TIME_AXIS_RIGHT_SLOT, &fixture.file),
                    t_axis.t_right
                ),
                "{tag}: stored t_right"
            );
            if let (Some(want_raw_max), Some(want_raw_min)) = (want.raw_max, want.raw_min) {
                let payload_start = param + PARAM_BLOCK_LEN;
                let count = sector.samples.expect("physical sample count");
                let mut raw_max = i32::MIN;
                let mut raw_min = i32::MAX;
                for index in 0..count {
                    let at = payload_start + 4 * index;
                    let sample = i32::from_le_bytes(
                        bytes[at..at + 4].try_into().expect("four payload bytes"),
                    );
                    raw_max = raw_max.max(sample);
                    raw_min = raw_min.min(sample);
                }
                assert_eq!(raw_max as i64, want_raw_max, "{tag}: raw max count");
                assert_eq!(raw_min as i64, want_raw_min, "{tag}: raw min count");
                assert_eq!(
                    (raw_max as f64 * scale).to_bits(),
                    want.physical_max.expect("physical max").to_bits(),
                    "{tag}: max converts as raw x S"
                );
                assert_eq!(
                    (raw_min as f64 * scale).to_bits(),
                    want.physical_min.expect("physical min").to_bits(),
                    "{tag}: min converts as raw x S"
                );
            }
        }
    }
    assert_eq!(
        asserted, 18,
        "every physical fixture channel pins its metadata"
    );
}

/// Issue #103 accrual: the parser-decoded channel fields match the
/// manifest's vertical-metadata expectations on every accepted fixture
/// (the byte-level slot pinning lives in
/// `fixture_stored_metadata_matches_manifest` above).
#[test]
fn decoded_channels_carry_manifest_vertical_metadata() {
    let mut asserted = 0;
    for fixture in manifest().fixtures {
        if fixture.expected.outcome != "accepted" {
            continue;
        }
        let decoded = decode_capture(&fixture_bytes(&fixture.file))
            .unwrap_or_else(|error| panic!("{}: unexpected {error}", fixture.file));
        let physical: Vec<_> = fixture
            .expected
            .channels
            .iter()
            .filter(|channel| !channel.derived)
            .collect();
        assert_eq!(
            decoded.channels.len(),
            physical.len(),
            "{}: physical channel count",
            fixture.file
        );
        for (channel, want) in decoded.channels.iter().zip(&physical) {
            asserted += 1;
            let tag = format!("{} {}", fixture.file, want.label);
            assert_eq!(
                channel.unit,
                want.unit.clone().expect("manifest carries unit"),
                "{tag}: unit"
            );
            assert_eq!(
                channel.unit_family,
                want.unit_family.expect("manifest carries unit family"),
                "{tag}: unit family verbatim"
            );
            let (want_min, want_max) = (
                want.window_min.expect("manifest carries window min"),
                want.window_max.expect("manifest carries window max"),
            );
            assert!(
                close(channel.window_min, want_min) && close(channel.window_max, want_max),
                "{tag}: window [{}, {}] != [{want_min}, {want_max}]",
                channel.window_min,
                channel.window_max
            );
            let want_scale = want.scale.expect("manifest carries scale");
            assert!(
                close(channel.scale, want_scale),
                "{tag}: scale {} != {want_scale}",
                channel.scale
            );
            let want_per_div = want.per_div.expect("manifest carries per-division");
            assert!(
                close(channel.per_div, want_per_div),
                "{tag}: per-division {} != {want_per_div}",
                channel.per_div
            );
        }
    }
    assert_eq!(
        asserted, 18,
        "every physical fixture channel decodes its metadata"
    );
}

#[test]
fn unaligned_payload_fixtures_decode_whole_samples() {
    // 830 % 4 == 2: the classic unaligned offset from the issue plan.
    for (name, samples) in [
        (
            "accepted-de-eingang-1ch-3000-comma-decimal.fvf.bin",
            3_000usize,
        ),
        ("extreme-envelope-1ch-250000-10ms-div.fvf.bin", 250_000),
    ] {
        let decoded =
            decode_capture(&fixture_bytes(name)).unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(decoded.channels[0].samples, samples, "{name}");
        assert_eq!(decoded.channels[0].values.len(), samples, "{name}");
        assert_eq!(decoded.channels[0].raw_counts.len(), samples, "{name}");
        assert_eq!(
            decoded.channels[0].saturated_sample_count, 0,
            "{name}: no rails"
        );
        // Physical values are raw x S (S = 0.0625 here): the LCG stream
        // spans roughly ±2048, proving the scale wiring end to end.
        assert_values_close(
            &decoded.channels[0].values,
            &expected_values(name, 0, 0.0625, false, samples),
            name,
        );
    }
}
