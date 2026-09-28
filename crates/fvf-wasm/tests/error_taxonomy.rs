//! Taxonomy mirror conformance (issue #9): every `FvfError` /
//! `ParseWarning` variant's stable code must appear exactly once in the
//! committed `tests/fixtures/error-taxonomy.json` mirror. The TS
//! error-code unions (`apps/web/src/types/capture.ts`) assert agreement
//! with the same file in the wasm32 conformance suite, so a Rust-side
//! code change cannot drift past CI without a matching TS update.

use std::fs;
use std::path::Path;

use fvf_wasm::error::{FvfError, ParseWarning};
use serde::Deserialize;

#[derive(Deserialize)]
struct Taxonomy {
    errors: Vec<String>,
    warnings: Vec<String>,
}

fn taxonomy() -> Taxonomy {
    let raw = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/error-taxonomy.json"),
    )
    .expect("error-taxonomy.json is present");
    serde_json::from_str(&raw).expect("error-taxonomy.json parses")
}

/// One instance of every hard-error variant, exercising each `code()` arm.
fn error_codes() -> Vec<&'static str> {
    vec![
        FvfError::InvalidSignature { detected: [0; 8] }.code(),
        FvfError::UnsupportedCaptureVersion { version: 2 }.code(),
        FvfError::InvalidTimebaseFormat {
            token: String::new(),
        }
        .code(),
        FvfError::InvalidTimebaseRange {
            seconds_per_div: 1.0,
        }
        .code(),
        FvfError::UnsupportedCaptureVariant {
            detected_tag: [0; 6],
        }
        .code(),
        FvfError::TruncatedCapture {
            needed: 1,
            available: 0,
        }
        .code(),
        FvfError::OpaqueHeader.code(),
        FvfError::CorruptSectorTable {
            detail: String::new(),
        }
        .code(),
        FvfError::InvalidTimeAxis {
            label: String::new(),
            detail: String::new(),
        }
        .code(),
    ]
}

/// One instance of every warning variant, exercising each `code()` arm.
fn warning_codes() -> Vec<&'static str> {
    vec![
        ParseWarning::UnknownTagPrefix {
            label: String::new(),
            letter: b'A',
        }
        .code(),
        ParseWarning::DerivedRecordIssue {
            label: String::new(),
            detail: String::new(),
        }
        .code(),
        ParseWarning::UnknownRecord {
            offset: 0,
            sector: 0,
        }
        .code(),
        ParseWarning::NonStandardTimebase {
            token: String::new(),
            seconds_per_div: 1.0,
        }
        .code(),
        ParseWarning::UnclassifiedTag {
            label: String::new(),
        }
        .code(),
        ParseWarning::DuplicateChannel {
            letter: b'A',
            ignored_label: String::new(),
        }
        .code(),
        ParseWarning::VerticalMetadataMismatch {
            label: String::new(),
            detail: String::new(),
        }
        .code(),
        ParseWarning::UnknownUnit {
            label: String::new(),
            unit: String::new(),
        }
        .code(),
        ParseWarning::SaturatedSamples {
            label: String::new(),
            low: 0,
            high: 0,
        }
        .code(),
        ParseWarning::DerivedLegacyValues {
            label: String::new(),
            detail: String::new(),
        }
        .code(),
        ParseWarning::TimeAxisSpanMismatch {
            label: String::new(),
            detail: String::new(),
        }
        .code(),
    ]
}

fn assert_exact_mirror(actual: Vec<&'static str>, committed: &[String], kind: &str) {
    let mut actual: Vec<String> = actual.into_iter().map(String::from).collect();
    actual.sort();
    let mut want = committed.to_vec();
    want.sort();
    assert_eq!(actual.len(), committed.len(), "{kind}: variant count");
    assert_eq!(
        actual, want,
        "{kind}: codes must match the committed taxonomy mirror exactly"
    );
}

#[test]
fn rust_taxonomy_matches_committed_mirror_exactly() {
    let mirror = taxonomy();
    assert_exact_mirror(error_codes(), &mirror.errors, "errors");
    assert_exact_mirror(warning_codes(), &mirror.warnings, "warnings");
}
