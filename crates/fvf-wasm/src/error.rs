//! Typed parser error taxonomy for the FVF parsing engine.
//!
//! Every error carries a stable snake_case `code` string; this is the
//! contract surface that crosses the JS boundary (issue #9 wires it into
//! the wasm-bindgen entry points).

use thiserror::Error;

/// Hard parse failures. A capture either parses per the observed dialect
/// or fails with exactly one typed error.
#[derive(Debug, Clone, PartialEq, Error)]
pub enum FvfError {
    /// The 8-byte prologue is not `FV.FVF\x1a\x00`; all 8 detected bytes
    /// are reported for the rejection UI.
    #[error("invalid signature, detected {detected:02x?}")]
    InvalidSignature { detected: [u8; 8] },
    /// Header version word at offset 8 is not 1.
    #[error("unsupported capture version {version}")]
    UnsupportedCaptureVersion { version: u16 },
    /// Timebase token does not match the grammar (exercised by issue #7).
    #[error("invalid timebase format {token:?}")]
    #[allow(dead_code)]
    InvalidTimebaseFormat { token: String },
    /// Timebase parses but falls outside 1 ns/div..120 s/div (issue #7).
    #[error("invalid timebase range {} s/div", seconds_per_div)]
    #[allow(dead_code)]
    InvalidTimebaseRange { seconds_per_div: f64 },
    /// Valid signature but the root tag is not the `CUR_` waveform format
    /// (e.g. the `FV.FVS` settings dialect of `3.fvf`).
    #[error("unsupported capture variant, tag {detected_tag:02x?}")]
    UnsupportedCaptureVariant { detected_tag: [u8; 6] },
    /// A descriptor pointer or structure reaches past the end of the file.
    #[error("truncated capture: needed {needed} bytes, have {available}")]
    TruncatedCapture { needed: usize, available: usize },
    /// The descriptor region matched no known layout, so no channel set
    /// can be derived (defensive; never observed on the corpus).
    #[error("descriptor region matched no known layout")]
    OpaqueHeader,
    /// The sector table's record pointers or the record chain they anchor
    /// did not resolve into a structurally valid record sequence (ADR
    /// 0007: records are discovered by walking the table, never by
    /// scanning the buffer).
    #[error("corrupt sector table: {detail}")]
    CorruptSectorTable { detail: String },
    /// A record's stored time-axis range (param+20/+44) is missing or
    /// invalid (issue #105): non-finite edges, `t_right <= t_left`, or a
    /// zero sample count. Stored-only policy — no fallback reconstruction.
    #[error("invalid time axis on {label}: {detail}")]
    InvalidTimeAxis { label: String, detail: String },
}

impl FvfError {
    /// Stable snake_case code for the JS boundary.
    pub fn code(&self) -> &'static str {
        match self {
            FvfError::InvalidSignature { .. } => "invalid_signature",
            FvfError::UnsupportedCaptureVersion { .. } => "unsupported_capture_version",
            FvfError::InvalidTimebaseFormat { .. } => "invalid_timebase_format",
            FvfError::InvalidTimebaseRange { .. } => "invalid_timebase_range",
            FvfError::UnsupportedCaptureVariant { .. } => "unsupported_capture_variant",
            FvfError::TruncatedCapture { .. } => "truncated_capture",
            FvfError::OpaqueHeader => "opaque_header",
            FvfError::CorruptSectorTable { .. } => "corrupt_sector_table",
            FvfError::InvalidTimeAxis { .. } => "invalid_time_axis",
        }
    }
}

/// Non-fatal parse observations (ADR 0007: the classification is total;
/// unknowns are inventoried as warnings, never silently dropped).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[allow(dead_code)]
pub enum ParseWarning {
    /// Unknown prefix whose label still ends in ` [A-D]`; treated as the
    /// physical channel named by the letter.
    UnknownTagPrefix { label: String, letter: u8 },
    /// A derived record could not be fully decoded (best-effort per ADR 0007).
    DerivedRecordIssue { label: String, detail: String },
    /// A structure was skipped; located for the unknown-record inventory.
    UnknownRecord { offset: usize, sector: i64 },
    /// Timebase parses and is in range but off the instrument step sets (issue #7).
    NonStandardTimebase { token: String, seconds_per_div: f64 },
    /// Label matched no known or recoverable prefix; channel skipped.
    UnclassifiedTag { label: String },
    /// Duplicate physical channel letter; first occurrence wins.
    DuplicateChannel { letter: u8, ignored_label: String },
    /// Saturated overload samples on a channel (issue #104): counts of
    /// low-rail and high-rail samples, which read NaN in `values` while
    /// `raw_counts` keeps the verbatim rail counts.
    SaturatedSamples {
        label: String,
        low: usize,
        high: usize,
    },
    /// A derived (math) channel decoded with the legacy Q16.16-normalized
    /// estimate (issue #104): the derived scale/offset model is
    /// unvalidated research (issue #108), so values stay `raw / 65536`
    /// with this warning instead of silently claiming physical values.
    DerivedLegacyValues { label: String, detail: String },
    /// A per-channel vertical-metadata consistency check failed (issue
    /// #103): duplicate copies differ, a value is non-finite, the window
    /// is inverted, or the scale is not positive. The verbatim values
    /// are still exposed; `detail` names the failed check.
    VerticalMetadataMismatch { label: String, detail: String },
    /// Channel unit token outside the established set (`V`, `mV`, `kV`,
    /// `A`, `mA`); parsed through verbatim (issue #103, full table open
    /// in issue #108).
    UnknownUnit { label: String, unit: String },
    /// Stored time-axis span disagrees with the timebase-implied span
    /// (10 × seconds/div) beyond ~5% (issue #105): the timebase string
    /// stays display-only while the stored range rules.
    TimeAxisSpanMismatch { label: String, detail: String },
}

impl ParseWarning {
    /// Stable snake_case code for the JS boundary.
    pub fn code(&self) -> &'static str {
        match self {
            ParseWarning::UnknownTagPrefix { .. } => "unknown_tag_prefix",
            ParseWarning::DerivedRecordIssue { .. } => "derived_record_issue",
            ParseWarning::UnknownRecord { .. } => "unknown_record",
            ParseWarning::NonStandardTimebase { .. } => "non_standard_timebase",
            ParseWarning::UnclassifiedTag { .. } => "unclassified_tag",
            ParseWarning::DuplicateChannel { .. } => "duplicate_channel",
            ParseWarning::SaturatedSamples { .. } => "saturated_samples",
            ParseWarning::DerivedLegacyValues { .. } => "derived_legacy_values",
            ParseWarning::VerticalMetadataMismatch { .. } => "vertical_metadata_mismatch",
            ParseWarning::UnknownUnit { .. } => "unknown_unit",
            ParseWarning::TimeAxisSpanMismatch { .. } => "time_axis_span_mismatch",
        }
    }
}
