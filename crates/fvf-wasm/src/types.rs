//! Internal parser result types (issue #6 header slice).
//!
//! Serialization derives exist so the JS boundary (issue #9) can map these
//! structs verbatim without reshaping.

use serde::Serialize;

use crate::error::ParseWarning;

/// Physical input channels vs derived (math) channels per ADR 0007.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelKind {
    Physical,
    Derived,
}

/// One descriptor-derived channel entry. `letter` is `b'A'..=b'D'` for
/// physical channels and `None` for derived ones; the original label is
/// always preserved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChannelDescriptor {
    pub label: String,
    pub letter: Option<u8>,
    pub kind: ChannelKind,
}

/// Which descriptor-table dialect the header used.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DescriptorFlavor {
    /// Empirical instrument dialect: 16-byte entries, `[1][N][N]`
    /// terminal marker, 18-byte label slots with index + pointer tail.
    Empirical,
    /// Synthetic-mirror dialect (ADR 0006): 14-byte entries, 14-byte
    /// tail block, zero-padded 18-byte label slots.
    Synthetic,
}

/// Result of parsing the capture header: the descriptor-derived channel
/// set (never assumed sequential) plus the warning inventory.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ParsedHeader {
    pub version: u16,
    pub flavor: DescriptorFlavor,
    pub channels: Vec<ChannelDescriptor>,
    pub warnings: Vec<ParseWarning>,
}

/// Decoded per-channel time axis (issues #8, #105): the sampling
/// interval and the stored-range sample timestamps, trigger-relative.
/// `delta_t` is carried in f64 (the decode domain); `times` are the f32
/// sample values.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TimestampAxis {
    pub delta_t: f64,
    pub times: Vec<f32>,
}

/// Maps a verbatim channel unit token to its base-SI unit and the exact
/// decimal factor with `base_value × factor = token-unit value` (issue
/// #104): `mV`/`mA` fold into `V`/`A` (×1000), `kV` into `V` (×0.001);
/// `V`/`A` map to themselves. Powers of ten only — no empirical
/// calibration; unknown tokens pass through with factor 1. The stored
/// scale S already converts raw counts to base SI, so sample values need
/// no conversion; this helper is the shared mechanical fold for display
/// and export surfaces (canonical base-SI CSV in issue #106).
pub fn canonical_unit(unit: &str) -> (String, f64) {
    match unit {
        "mV" => ("V".to_owned(), 1_000.0),
        "mA" => ("A".to_owned(), 1_000.0),
        "kV" => ("V".to_owned(), 0.001),
        "V" => ("V".to_owned(), 1.0),
        "A" => ("A".to_owned(), 1.0),
        _ => (unit.to_owned(), 1.0),
    }
}

/// A fully decoded physical channel: descriptor classification, record
/// identity, physical sample values, the reconstructed time axis, and
/// the per-channel vertical metadata (issues #103–#104).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ChannelData {
    /// Descriptor-table label (classification input).
    pub label: String,
    /// Physical input letter `A`..=`D` (always present for physical kind).
    pub letter: u8,
    /// Label found in the record trailer (equals `label` for physical
    /// records across the whole corpus).
    pub record_label: String,
    pub samples: usize,
    pub delta_t: f64,
    pub timestamps: Vec<f32>,
    /// Physical sample values in base-SI channel units: `raw × S`
    /// (issue #104). Saturated overload samples read NaN: the
    /// instrument clamps overloads to the rails instead of wrapping, so
    /// raw counts equal to `i32::MAX`, `i32::MIN`, or the observed low
    /// rail `i32::MIN + 2` (Scope34-A) read NaN here while
    /// `raw_counts` keeps the verbatim rail counts.
    pub values: Vec<f32>,
    /// Verbatim raw sample counts (issue #104).
    pub raw_counts: Vec<i32>,
    /// Count of saturated (NaN-reading) samples on this channel.
    pub saturated_sample_count: usize,
    /// Verbatim channel unit from param+312 (`V`, `A`, `mA`, ...).
    pub unit: String,
    /// Unit-family code from param+324, exposed verbatim (3 = voltage,
    /// 10 = current observed; exact table open per the research issue).
    pub unit_family: u32,
    /// Vertical window from param+126/+134, in channel units.
    pub window_min: f64,
    pub window_max: f64,
    /// Scale factor S from param+328: physical value = raw × S.
    pub scale: f64,
    /// Per-division value: (window_max − window_min) / 8.
    pub per_div: f64,
}

/// A best-effort decoded derived (math) channel per ADR 0007: derived
/// parameter blocks deviate from the standard layout, so `samples`,
/// `delta_t`, and the vectors are empty whenever the payload extent
/// could not be recovered (a `DerivedRecordIssue` warning is raised
/// alongside).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DerivedChannelData {
    /// Descriptor-table label (e.g. `Mathematik A`).
    pub label: String,
    /// Full record-trailer label (e.g. `Mathematik A-B`).
    pub record_label: String,
    /// Physical source letters parsed from the record label (`A`..=`D`
    /// after the `Mathematik ` prefix), best-effort.
    pub source_channels: Vec<u8>,
    pub samples: Option<usize>,
    pub delta_t: Option<f64>,
    pub timestamps: Vec<f32>,
    /// Legacy Q16.16-normalized estimate (issue #104): the derived
    /// scale/offset model is unvalidated research (issue #108), so
    /// values stay `raw / 65536` verbatim — no saturation rule applies —
    /// with a `DerivedLegacyValues` warning. `saturated_sample_count`
    /// is always zero on derived channels.
    pub values: Vec<f32>,
    /// Verbatim raw sample counts (issue #104).
    pub raw_counts: Vec<i32>,
    /// Count of saturated samples on this channel (issue #104): rails
    /// read NaN in `values` while `raw_counts` keeps the verbatim rail
    /// counts. Always zero on derived channels, whose legacy estimate is
    /// verbatim (no NaN rule applies).
    pub saturated_sample_count: usize,
    /// Verbatim vertical-metadata reads from the derived record's param
    /// block (issue #103). Derived layouts deviate from the standard
    /// slots (ADR 0007), so these are exposed without consistency
    /// validation and carry no metadata warnings.
    pub unit: String,
    pub unit_family: u32,
    pub window_min: f64,
    pub window_max: f64,
    pub scale: f64,
    pub per_div: f64,
}

/// Full decode of one waveform capture (issue #8): header classification,
/// validated timebase, capture timestamp, physical and derived channel
/// payloads, and the warning inventory.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DecodedCapture {
    pub version: u16,
    pub flavor: DescriptorFlavor,
    pub timebase_raw: String,
    pub seconds_per_div: f64,
    /// 14-digit capture timestamp `HHMMSSYYYYMMDD` from the first
    /// physical record's parameter block.
    pub timestamp14: String,
    pub channels: Vec<ChannelData>,
    pub derived_channels: Vec<DerivedChannelData>,
    pub warnings: Vec<ParseWarning>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_unit_folds_decimal_prefixes_to_base_si() {
        // (token, base unit, base_value × factor = token-unit value).
        for (token, want_unit, want_factor) in [
            ("V", "V", 1.0),
            ("A", "A", 1.0),
            ("mV", "V", 1_000.0),
            ("mA", "A", 1_000.0),
            ("kV", "V", 0.001),
        ] {
            assert_eq!(canonical_unit(token), (want_unit.to_owned(), want_factor));
        }
        // Powers of ten only: unknown tokens pass through untouched.
        assert_eq!(canonical_unit("dB"), ("dB".to_owned(), 1.0));
        assert_eq!(canonical_unit(""), ("".to_owned(), 1.0));
        // The Scope34-C relationship: a 0.2 A shunt current displays as
        // 200 mA through the fold.
        let (unit, factor) = canonical_unit("mA");
        assert_eq!(unit, "A");
        assert!((0.2 * factor - 200.0).abs() < 1.0e-9);
    }
}
