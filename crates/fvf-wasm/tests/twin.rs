//! Local-only twin test (issue #8): the empirical capture mirroring the
//! committed synthetic twin (resolved from the private empirical oracle,
//! never hardcoded) and its committed synthetic mirror
//! `accepted-de-eingang-1ch-3000-comma-decimal.fvf.bin` must parse with
//! identical structure through both descriptor dialects — same channel
//! and derived counts, letters, sample counts, and stored time-axis
//! semantics (each side carries its own trigger-relative axis) —
//! countering writer/reader lockstep blindness per ADR 0006. Skips with
//! an explicit notice when the local corpus is absent (CI runs the
//! synthetic side only).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use fvf_wasm::records::decode_capture;
use fvf_wasm::types::{ChannelData, DecodedCapture, DescriptorFlavor};

const TWIN_FIXTURE: &str = "accepted-de-eingang-1ch-3000-comma-decimal.fvf.bin";

/// Resolves the empirical twin's filename from the private oracle manifest
/// (shape-selected, never hardcoded: the open-source policy keeps capture
/// names out of published source). Skips when the oracle is absent.
fn empirical_twin_name() -> Option<String> {
    let raw = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/empirical-local.manifest.json"),
    )
    .ok()?;
    let manifest: serde_json::Value = serde_json::from_str(&raw).ok()?;
    // Shape selector: single physical EN channel, 3,000 samples, no
    // derived records — the corpus capture the synthetic twin mirrors.
    manifest["captures"].as_array()?.iter().find_map(|capture| {
        let expected = &capture["expected"];
        let records = expected["records"].as_array()?;
        let physical: Vec<_> = records
            .iter()
            .filter(|r| r["derived"].as_bool() == Some(false))
            .collect();
        if expected["variant"].as_str()? == "waveform"
            && physical.len() == 1
            && physical[0]["samples"].as_u64()? == 3000
            && physical[0]["letter"].as_str()? == "A"
        {
            capture["file"].as_str().map(String::from)
        } else {
            None
        }
    })
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

fn twin_fixture() -> Vec<u8> {
    fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/synthetic")
            .join(TWIN_FIXTURE),
    )
    .expect("committed synthetic twin is present")
}

fn sole_physical<'a>(capture: &'a DecodedCapture, side: &str) -> &'a ChannelData {
    assert_eq!(
        capture.channels.len(),
        1,
        "{side}: the twin pair is single-channel"
    );
    assert!(
        capture.derived_channels.is_empty(),
        "{side}: the twin pair carries no derived records"
    );
    &capture.channels[0]
}

fn assert_structural_shape(capture: &DecodedCapture, side: &str, t_left: f64, span: f64) {
    assert!(capture.warnings.is_empty(), "{side}: no warnings");
    let channel = sole_physical(capture, side);
    assert_eq!(channel.letter, b'A', "{side}: channel letter");
    assert_eq!(channel.samples, 3_000, "{side}: sample count");
    assert_eq!(channel.values.len(), 3_000, "{side}: decoded values");
    assert_eq!(
        channel.raw_counts.len(),
        3_000,
        "{side}: verbatim raw counts"
    );
    assert_eq!(
        channel.saturated_sample_count, 0,
        "{side}: the twin pair carries no saturation rails"
    );
    assert_eq!(channel.timestamps.len(), 3_000, "{side}: timestamps");
    // Stored time axis (issue #105): the axis starts at the file's
    // left edge and t = 0 sits wherever the trigger puts it.
    let want_dt = span / 3_000.0;
    assert!(
        (channel.delta_t - want_dt).abs() <= want_dt.abs() * 1.0e-9,
        "{side}: delta_t {} vs {want_dt:e}",
        channel.delta_t
    );
    assert_eq!(
        channel.timestamps[0], t_left as f32,
        "{side}: axis starts at the stored left edge"
    );
    let want_center = t_left + 1_500.0 * want_dt;
    assert!(
        (f64::from(channel.timestamps[1_500]) - want_center).abs()
            <= want_center.abs() * 1.0e-6 + 1.0e-9,
        "{side}: t_center {} vs {want_center:e}",
        channel.timestamps[1_500]
    );
    // Issue #104: values are raw x S in f64, cast to f32 — no NaN on
    // the rail-free twin pair, and the raw lane shadows every value.
    for (index, (value, raw)) in channel.values.iter().zip(&channel.raw_counts).enumerate() {
        assert!(!value.is_nan(), "{side} sample {index}: no rails");
        assert_eq!(
            *value,
            (f64::from(*raw) * channel.scale) as f32,
            "{side} sample {index}: value is raw x S"
        );
    }
    // Every channel shares the file timebase (each record re-embeds it).
    assert_eq!(capture.channels[0].delta_t, channel.delta_t);
}

#[test]
fn empirical_capture_and_synthetic_twin_parse_identically() {
    let Some(corpus) = resolve_corpus() else {
        println!("skipped: local captures not present");
        return;
    };
    let Some(empirical_name) = empirical_twin_name() else {
        println!("skipped: private empirical oracle not present");
        return;
    };
    let empirical = fs::read(corpus.join(&empirical_name))
        .unwrap_or_else(|error| panic!("local capture {empirical_name} is required: {error}"));
    let empirical = decode_capture(&empirical)
        .unwrap_or_else(|error| panic!("{empirical_name}: unexpected {error}"));
    let twin = decode_capture(&twin_fixture())
        .unwrap_or_else(|error| panic!("{TWIN_FIXTURE}: unexpected {error}"));

    // Stored axes (issue #105): the empirical twin's trigger sits
    // off-center (t = 0 at ~40% of the window); the synthetic mirror is
    // centered.
    assert_structural_shape(&empirical, &empirical_name, -0.0006, 0.004);
    assert_structural_shape(&twin, TWIN_FIXTURE, -0.5, 1.0);

    // The structural decode is identical; the two dialect markers and the
    // locale-specific labels/values legitimately differ (the mirror
    // replicates shape, not bytes — that is the point of the twin).
    assert_eq!(empirical.flavor, DescriptorFlavor::Empirical);
    assert_eq!(twin.flavor, DescriptorFlavor::Synthetic);
    assert_eq!(
        sole_physical(&empirical, &empirical_name).letter,
        sole_physical(&twin, TWIN_FIXTURE).letter
    );
    assert_eq!(
        sole_physical(&empirical, &empirical_name).samples,
        sole_physical(&twin, TWIN_FIXTURE).samples
    );
    assert_eq!(
        sole_physical(&empirical, &empirical_name).timestamps.len(),
        sole_physical(&twin, TWIN_FIXTURE).timestamps.len()
    );

    // Each side carries its own manifest-verified timebase semantics.
    assert_eq!(empirical.timebase_raw, "400 us/Div");
    assert!((empirical.seconds_per_div - 4.0e-4).abs() < 1.0e-12);
    assert_eq!(twin.timebase_raw, "0,1 s/Div");
    assert!((twin.seconds_per_div - 0.1).abs() < 1.0e-12);
    assert_eq!(empirical.timestamp14, "15321620190514");
    assert_eq!(twin.timestamp14, "12000020260101");
}
