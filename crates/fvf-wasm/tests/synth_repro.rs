use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::path::PathBuf;

use serde::Deserialize;
use sha2::{Digest, Sha256};

// The shared example module is compiled per test crate; this one consumes
// only the corpus fixture surface, so the demo-sample builder it also
// carries is legitimately unused here (sample_asset exercises it).
#[allow(dead_code)]
#[path = "../examples/synth.rs"]
mod synth;

#[derive(Deserialize)]
struct Manifest {
    fixtures: Vec<FixtureEntry>,
}

#[derive(Deserialize)]
struct FixtureEntry {
    file: String,
    size: u64,
    sha256: String,
    #[serde(default)]
    provenance: Option<Provenance>,
    expected: Expected,
}

#[derive(Deserialize)]
struct Provenance {
    parameters: Option<Parameters>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Parameters {
    timebase_raw: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expected {
    outcome: String,
    #[serde(default)]
    seconds_per_div: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenTable {
    tokens: Vec<TokenRow>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenRow {
    input: String,
    outcome: String,
    #[serde(default)]
    seconds_per_div: Option<f64>,
    #[serde(default)]
    carrier_fixture: Option<String>,
}

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn committed_synthetic_names() -> BTreeSet<String> {
    let dir = fixtures_dir().join("synthetic");
    let mut names = BTreeSet::new();
    for entry in fs::read_dir(&dir).expect("synthetic fixture directory is present") {
        let path = entry.expect("readable fixture entry").path();
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .expect("fixture file name is utf-8")
            .to_string();
        assert!(
            name.ends_with(".fvf.bin"),
            "unexpected file in synthetic/: {name}"
        );
        names.insert(name);
    }
    names
}

fn manifest() -> Manifest {
    let raw =
        fs::read_to_string(fixtures_dir().join("manifest.json")).expect("manifest.json is present");
    serde_json::from_str(&raw).expect("manifest.json parses")
}

fn normalize_token(token: &str) -> String {
    token
        .to_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect()
}

#[test]
fn manifest_enumerates_every_synthetic_fixture() {
    let manifest = manifest();
    let listed: BTreeSet<String> = manifest
        .fixtures
        .iter()
        .map(|fixture| {
            Path::new(&fixture.file)
                .file_name()
                .and_then(|value| value.to_str())
                .expect("manifest fixture file name is utf-8")
                .to_string()
        })
        .collect();
    assert_eq!(
        committed_synthetic_names(),
        listed,
        "manifest.json must enumerate every file under synthetic/ exactly once"
    );
}

#[test]
fn manifest_entries_match_committed_bytes() {
    for fixture in manifest().fixtures {
        let bytes = fs::read(fixtures_dir().join(&fixture.file))
            .unwrap_or_else(|error| panic!("reading {}: {error}", fixture.file));
        assert_eq!(
            bytes.len() as u64,
            fixture.size,
            "{} size drifted from manifest",
            fixture.file
        );
        assert_eq!(
            sha256_hex(&bytes),
            fixture.sha256,
            "{} content drifted from manifest",
            fixture.file
        );
    }
}

#[test]
fn regenerated_fixtures_are_byte_identical_to_committed_files() {
    let out_dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("synth-repro");
    let _ = fs::remove_dir_all(&out_dir);
    fs::create_dir_all(&out_dir).expect("regeneration output directory");
    for (name, bytes) in synth::build_all() {
        let committed = fs::read(fixtures_dir().join("synthetic").join(name))
            .unwrap_or_else(|error| panic!("reading committed {name}: {error}"));
        assert_eq!(
            bytes, committed,
            "regenerated {name} differs from the committed file"
        );
        fs::write(out_dir.join(name), &bytes)
            .unwrap_or_else(|error| panic!("writing regenerated {name}: {error}"));
    }
}

#[test]
fn synthesis_is_deterministic() {
    let first = synth::build_all();
    let second = synth::build_all();
    assert_eq!(first, second);
}

#[test]
fn oversized_fixture_is_regenerable_on_demand() {
    let (name, bytes) = synth::build_oversized();
    assert_eq!(name, "extreme-envelope-4ch-250000-10ms-div.fvf.bin");
    assert_eq!(bytes.len(), 4_002_259);
}

#[test]
fn timebase_table_has_full_architecture_row_coverage() {
    let raw = fs::read_to_string(fixtures_dir().join("timebase-tokens.json"))
        .expect("timebase-tokens.json is present");
    let table: TokenTable = serde_json::from_str(&raw).expect("timebase-tokens.json parses");
    let accepted = table
        .tokens
        .iter()
        .filter(|row| row.outcome == "accepted")
        .count();
    let rejected = table
        .tokens
        .iter()
        .filter(|row| row.outcome == "rejected")
        .count();
    assert_eq!(
        accepted, 11,
        "8 architecture accepted rows + 3 empirical extra rows"
    );
    assert_eq!(rejected, 6, "all 6 architecture rejected rows");
}

#[test]
fn every_carrier_fixture_exists_with_matching_expectation() {
    let raw = fs::read_to_string(fixtures_dir().join("timebase-tokens.json"))
        .expect("timebase-tokens.json is present");
    let table: TokenTable = serde_json::from_str(&raw).expect("timebase-tokens.json parses");
    let manifest = manifest();
    let required_carriers = [
        "10 ms/div",
        "0,1 s/Div",
        "1 min/Div",
        "abc us/div",
        "500 min/div",
    ];
    let carriers: Vec<&TokenRow> = table
        .tokens
        .iter()
        .filter(|row| row.carrier_fixture.is_some())
        .collect();
    assert!(
        carriers.len() >= required_carriers.len(),
        "the five required carrier categories (accepted EN, comma-decimal, minute roll-mode, rejected-format, rejected-range) must carry full-file fixtures"
    );
    for token in required_carriers {
        assert!(
            carriers
                .iter()
                .any(|row| normalize_token(&row.input) == normalize_token(token)),
            "token row {token:?} has no full-file carrier fixture"
        );
    }
    for row in carriers {
        let carrier = row.carrier_fixture.as_deref().expect("carrier name");
        let fixture = manifest
            .fixtures
            .iter()
            .find(|fixture| fixture.file.ends_with(carrier))
            .unwrap_or_else(|| panic!("carrier {carrier} missing from manifest.json"));
        let embedded = fixture
            .provenance
            .as_ref()
            .and_then(|provenance| provenance.parameters.as_ref())
            .and_then(|parameters| parameters.timebase_raw.as_deref())
            .map(normalize_token);
        if let Some(embedded) = embedded {
            assert_eq!(
                embedded,
                normalize_token(&row.input),
                "carrier {carrier} embeds a different timebase token"
            );
        }
        assert_eq!(
            fixture.expected.outcome, row.outcome,
            "carrier {carrier} outcome disagrees with its token row"
        );
        if row.outcome == "accepted" {
            assert_eq!(
                fixture.expected.seconds_per_div, row.seconds_per_div,
                "carrier {carrier} secondsPerDiv disagrees with its token row"
            );
        }
    }
}
