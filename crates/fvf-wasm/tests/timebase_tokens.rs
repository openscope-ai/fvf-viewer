//! Issue #7 acceptance test: every `timebase-tokens.json` row (the full
//! architecture.md §3.1 fixture table plus the empirical extra rows) must
//! pass/fail exactly, including the normalized secondsPerDiv and the
//! standard-step flag. The step-set and seed constants are also pinned
//! against the JSON so implementation drift cannot go unnoticed.

use std::fs;
use std::path::Path;

use fvf_wasm::error::FvfError;
use fvf_wasm::timebase::{
    MINUTE_ROLL_VALUES, PHYSICAL_RANGE_MAX_SECONDS_PER_DIV, PHYSICAL_RANGE_MIN_SECONDS_PER_DIV,
    STANDARD_STEP_TOLERANCE, SUB_SECOND_STEPS, validate_timebase,
};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenTable {
    physical_range_seconds_per_div: Range,
    standard_steps: StandardSteps,
    property_test: PropertyTest,
    tokens: Vec<TokenRow>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Range {
    min: f64,
    max: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StandardSteps {
    sub_second_mantissas: Vec<f64>,
    minute_roll_mode_values: Vec<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PropertyTest {
    seeds: Vec<u32>,
    iterations_per_seed: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenRow {
    input: String,
    outcome: String,
    #[serde(default)]
    seconds_per_div: Option<f64>,
    #[serde(default)]
    standard_step: Option<bool>,
    #[serde(default)]
    reason: Option<String>,
}

fn token_table() -> TokenTable {
    let raw = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/timebase-tokens.json"),
    )
    .expect("timebase-tokens.json is present");
    serde_json::from_str(&raw).expect("timebase-tokens.json parses")
}

fn seconds_match(got: f64, want: f64) -> bool {
    (got - want).abs() <= 1.0e-12 * want.abs().max(1.0)
}

#[test]
fn implementation_constants_match_the_token_table() {
    let table = token_table();
    assert!(seconds_match(
        PHYSICAL_RANGE_MIN_SECONDS_PER_DIV,
        table.physical_range_seconds_per_div.min
    ));
    assert!(seconds_match(
        PHYSICAL_RANGE_MAX_SECONDS_PER_DIV,
        table.physical_range_seconds_per_div.max
    ));
    assert_eq!(
        SUB_SECOND_STEPS.as_slice(),
        table.standard_steps.sub_second_mantissas.as_slice()
    );
    assert_eq!(
        MINUTE_ROLL_VALUES.as_slice(),
        table.standard_steps.minute_roll_mode_values.as_slice()
    );
    assert_eq!(STANDARD_STEP_TOLERANCE, 0.01);
    assert_eq!(
        table.property_test.seeds,
        [1, 24_301, 3_735_928_559, u32::MAX]
    );
    assert_eq!(table.property_test.iterations_per_seed, 512);
}

#[test]
fn every_fixture_table_row_passes_or_fails_exactly() {
    let table = token_table();
    assert!(table.tokens.len() >= 17, "full architecture table present");
    for row in &table.tokens {
        match row.outcome.as_str() {
            "accepted" => {
                let validated = validate_timebase(&row.input)
                    .unwrap_or_else(|error| panic!("{:?} must parse: {error}", row.input));
                let want = row
                    .seconds_per_div
                    .unwrap_or_else(|| panic!("{:?} carries secondsPerDiv", row.input));
                assert!(
                    seconds_match(validated.seconds_per_div, want),
                    "{:?}: normalized {} != {want}",
                    row.input,
                    validated.seconds_per_div
                );
                let standard = row
                    .standard_step
                    .unwrap_or_else(|| panic!("{:?} carries standardStep", row.input));
                assert_eq!(
                    validated.is_standard_step(),
                    standard,
                    "{:?}: standardStep flag",
                    row.input
                );
                if standard {
                    assert!(
                        validated.warnings.is_empty(),
                        "{:?}: standard rows carry no warnings",
                        row.input
                    );
                } else {
                    assert!(
                        validated
                            .warnings
                            .iter()
                            .any(|warning| warning.code() == "non_standard_timebase"),
                        "{:?}: non-standard rows carry the warning flag",
                        row.input
                    );
                }
            }
            "rejected" => {
                let error = validate_timebase(&row.input)
                    .expect_err(&format!("{:?} must be rejected", row.input));
                let reason = row
                    .reason
                    .as_deref()
                    .unwrap_or_else(|| panic!("{:?} carries a rejection reason", row.input));
                assert_eq!(error.code(), reason, "{:?}: rejection code", row.input);
                assert!(
                    row.seconds_per_div.is_none(),
                    "{:?}: rejected rows carry no value",
                    row.input
                );
                if reason == "invalid_timebase_range" {
                    assert!(
                        matches!(error, FvfError::InvalidTimebaseRange { .. }),
                        "{:?}: typed range error",
                        row.input
                    );
                } else {
                    assert!(
                        matches!(error, FvfError::InvalidTimebaseFormat { .. }),
                        "{:?}: typed format error",
                        row.input
                    );
                }
            }
            other => panic!("unknown outcome {other:?} for {:?}", row.input),
        }
    }
}

#[test]
fn accepted_rows_cover_both_step_domains_and_comma_locales() {
    let table = token_table();
    let accepted: Vec<&TokenRow> = table
        .tokens
        .iter()
        .filter(|row| row.outcome == "accepted")
        .collect();
    assert!(
        accepted
            .iter()
            .any(|row| row.input.contains(',') && row.input.ends_with("us/Div")),
        "comma-decimal micro row present"
    );
    assert!(
        accepted
            .iter()
            .any(|row| row.input.contains("min/Div") || row.input.contains("min/div")),
        "minute roll-mode row present"
    );
    assert!(
        accepted
            .iter()
            .any(|row| seconds_match(row.seconds_per_div.unwrap(), 6.667e-7)),
        "sub-nanosecond mantissa row present"
    );
    assert!(
        accepted
            .iter()
            .any(|row| seconds_match(row.seconds_per_div.unwrap(), 120.0)),
        "range-ceiling row present"
    );
}
