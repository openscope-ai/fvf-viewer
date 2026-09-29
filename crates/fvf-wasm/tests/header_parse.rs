use std::fs;
use std::path::Path;
use std::path::PathBuf;

use fvf_wasm::error::FvfError;
use fvf_wasm::header::parse_header;
use fvf_wasm::types::{ChannelKind, ParsedHeader};
use serde::Deserialize;

#[derive(Deserialize)]
struct Manifest {
    fixtures: Vec<Fixture>,
}

#[derive(Deserialize)]
struct Fixture {
    file: String,
    expected: Expected,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expected {
    outcome: String,
    #[serde(default)]
    expected_error_code: Option<String>,
    #[serde(default)]
    detected_magic: Option<String>,
    #[serde(default)]
    channels: Vec<ChannelExpectation>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelExpectation {
    letter: Option<String>,
    label: String,
    derived: bool,
}

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn assert_channels_match(parsed: &ParsedHeader, expected: &[ChannelExpectation]) {
    assert_eq!(parsed.channels.len(), expected.len(), "channel count");
    for (channel, want) in parsed.channels.iter().zip(expected) {
        assert_eq!(
            channel.label, want.label,
            "label order must follow descriptors"
        );
        assert_eq!(
            channel.letter,
            want.letter.as_ref().map(|letter| letter.as_bytes()[0]),
            "letter for {} comes from the descriptor, not index order",
            want.label
        );
        assert_eq!(
            channel.kind == ChannelKind::Derived,
            want.derived,
            "derived flag for {}",
            want.label
        );
    }
}

#[test]
fn synthetic_manifest_headers_parse_per_expectation() {
    let raw =
        fs::read_to_string(fixtures_dir().join("manifest.json")).expect("manifest.json is present");
    let manifest: Manifest = serde_json::from_str(&raw).expect("manifest.json parses");
    assert!(!manifest.fixtures.is_empty());
    for fixture in &manifest.fixtures {
        let bytes = fs::read(fixtures_dir().join(&fixture.file))
            .unwrap_or_else(|error| panic!("reading {}: {error}", fixture.file));
        match fixture.expected.expected_error_code.as_deref() {
            Some("invalid_signature") => {
                let error =
                    parse_header(&bytes).expect_err("invalid-signature fixture must be rejected");
                assert_eq!(error.code(), "invalid_signature");
                let FvfError::InvalidSignature { detected } = error else {
                    panic!("expected InvalidSignature, got {error:?}");
                };
                let detected_magic = fixture
                    .expected
                    .detected_magic
                    .as_deref()
                    .expect("manifest records the detected magic");
                assert_eq!(detected.len(), 8, "all 8 detected bytes are reported");
                assert_eq!(
                    &detected[..6],
                    detected_magic.as_bytes(),
                    "detected magic ASCII prefix"
                );
                assert_eq!(
                    &detected[6..8],
                    &[0x1a, 0x00],
                    "detected magic retains the untouched prologue tail"
                );
            }
            Some("unsupported_capture_variant") => {
                let error = parse_header(&bytes).expect_err("settings variant must be rejected");
                assert_eq!(error.code(), "unsupported_capture_variant");
                let FvfError::UnsupportedCaptureVariant { detected_tag } = error else {
                    panic!("expected UnsupportedCaptureVariant, got {error:?}");
                };
                assert_eq!(&detected_tag, b"FV.FVS");
            }
            // Timebase rejections are decided by the timebase grammar
            // (issue #7); the header itself parses cleanly.
            Some(code) => {
                parse_header(&bytes)
                    .unwrap_or_else(|error| panic!("{}: unexpected {error}", fixture.file));
                assert!(
                    code == "invalid_timebase_format" || code == "invalid_timebase_range",
                    "unexpected expected error code {code}"
                );
            }
            None => {
                assert_eq!(fixture.expected.outcome, "accepted");
                let parsed = parse_header(&bytes)
                    .unwrap_or_else(|error| panic!("{}: unexpected {error}", fixture.file));
                assert!(
                    parsed.warnings.is_empty(),
                    "accepted fixtures carry no warnings"
                );
                assert_channels_match(&parsed, &fixture.expected.channels);
            }
        }
    }
}

#[test]
fn nonsequential_abd_comes_from_descriptors_not_index_order() {
    let bytes =
        fs::read(fixtures_dir().join("synthetic/nonsequential-abd-3ch-10000-20ms-div.fvf.bin"))
            .expect("abd fixture is present");
    let parsed = parse_header(&bytes).expect("abd fixture header parses");
    let letters: Vec<Option<u8>> = parsed.channels.iter().map(|c| c.letter).collect();
    assert_eq!(letters, vec![Some(b'A'), Some(b'B'), Some(b'D')]);
    assert_eq!(parsed.warnings, Vec::new());
}

#[test]
fn derived_mathematik_classifies_without_a_letter() {
    let bytes =
        fs::read(fixtures_dir().join("synthetic/derived-mathematik-2ch-3000-10ms-div.fvf.bin"))
            .expect("derived fixture is present");
    let parsed = parse_header(&bytes).expect("derived fixture header parses");
    assert_eq!(parsed.channels[0].letter, Some(b'A'));
    assert_eq!(parsed.channels[0].kind, ChannelKind::Physical);
    assert_eq!(parsed.channels[1].label, "Mathematik A");
    assert_eq!(parsed.channels[1].letter, None);
    assert_eq!(parsed.channels[1].kind, ChannelKind::Derived);
}
