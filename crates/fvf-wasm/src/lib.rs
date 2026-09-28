//! FVF parsing engine core.
//!
//! Stage 1: header parsing and signature verification (`header.rs`) with
//! the typed error/warning taxonomy (`error.rs`), parser result types
//! (`types.rs`), timebase token grammar/validation (`timebase.rs`), the
//! Q16.16 fixed-point decoder (`fixed_point.rs`), record discovery /
//! full capture decoding (`records.rs`), and the wasm-bindgen bridge
//! (`parse_capture`, issue #9).
//!
//! # Wasm bridge contract (architecture.md 3.2)
//!
//! `parse_capture` returns a [`ParseResult`] that *owns* every decoded
//! vector inside Wasm linear memory. Per-channel sample data is exposed
//! as `(ptr, len)` accessor pairs so the JS side can construct
//! `Float32Array(memory.buffer, ptr, len)` views; the caller must copy
//! each view into a standalone JS-allocated `Float32Array` before
//! invoking any string-returning accessor (string getters allocate in
//! Wasm and may grow linear memory, which detaches every outstanding
//! view). Only the copies may ever enter a `postMessage` transfer list.

pub mod error;
pub mod fixed_point;
pub mod header;
pub mod records;
pub mod timebase;
pub mod types;

use serde::Serialize;
use serde_json::json;
use wasm_bindgen::prelude::*;

use crate::error::FvfError;
use crate::records::decode_capture;
use crate::types::{DecodedCapture, DescriptorFlavor};

/// Returns the engine crate version.
///
/// Placeholder proof-of-life export; the real parser API is
/// [`parse_capture`].
#[wasm_bindgen]
pub fn engine_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Hard parse failure crossing the JS boundary (issue #9).
///
/// wasm-bindgen has no structured-throw channel without `js-sys`, so the
/// thrown JS value is the JSON serialization of this struct; the worker
/// decodes it back into `{ code, message, details }` (see
/// `apps/web/src/workers/parse.worker.ts`). Because the type implements
/// `Into<JsValue>` it is a Result error type, not an exported JS class.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ParseError {
    code: String,
    message: String,
    details: String,
}

impl ParseError {
    fn from_fvf(error: &FvfError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.to_string(),
            details: error_details(error),
        }
    }

    /// Stable snake_case code mirroring [`FvfError::code`].
    pub fn code(&self) -> &str {
        &self.code
    }

    /// Human-readable failure message.
    pub fn message(&self) -> &str {
        &self.message
    }

    /// Structured JSON detail payload for the rejection UI.
    pub fn details(&self) -> &str {
        &self.details
    }
}

impl From<ParseError> for JsValue {
    fn from(error: ParseError) -> Self {
        JsValue::from_str(&serde_json::to_string(&error).expect("ParseError serializes"))
    }
}

/// JSON detail payload per error variant (all values are file-derived
/// numbers/hex; strings pass through `json!` escaping).
fn error_details(error: &FvfError) -> String {
    let details = match error {
        FvfError::InvalidSignature { detected } => json!({
            "detectedHex": detected
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<Vec<_>>()
                .join(" "),
            "detectedAscii": detected.iter().map(|byte| {
                if byte.is_ascii_graphic() || *byte == b' ' {
                    *byte as char
                } else {
                    '.'
                }
            }).collect::<String>(),
        }),
        FvfError::UnsupportedCaptureVersion { version } => json!({ "version": version }),
        FvfError::InvalidTimebaseFormat { token } => json!({ "token": token }),
        FvfError::InvalidTimebaseRange { seconds_per_div } => {
            json!({ "secondsPerDiv": seconds_per_div })
        }
        FvfError::UnsupportedCaptureVariant { detected_tag } => json!({
            "detectedTagHex": detected_tag
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<Vec<_>>()
                .join(" "),
            "detectedTag": String::from_utf8_lossy(detected_tag),
        }),
        FvfError::TruncatedCapture { needed, available } => {
            json!({ "needed": needed, "available": available })
        }
        FvfError::OpaqueHeader => json!({}),
        FvfError::CorruptSectorTable { detail } => json!({ "detail": detail }),
        FvfError::InvalidTimeAxis { label, detail } => {
            json!({ "label": label, "detail": detail })
        }
    };
    details.to_string()
}

/// Successful [`parse_capture`] result owning the decoded capture.
///
/// Sample vectors are not marshalled through the ABI; the `*_ptr`/`*_len`
/// accessor pairs expose their location in Wasm linear memory so JS can
/// build `Float32Array` views and copy them out (detachment guard).
#[derive(Debug)]
#[wasm_bindgen]
pub struct ParseResult {
    decoded: DecodedCapture,
}

/// Byte offset of an f32 series in Wasm linear memory. `Vec<f32>` is
/// 4-byte aligned, so the offset always satisfies the `Float32Array`
/// alignment requirement.
fn series_ptr<T>(series: &[T]) -> u32 {
    series.as_ptr() as u32
}

#[wasm_bindgen]
impl ParseResult {
    // ---- capture-level metadata ----

    #[wasm_bindgen(getter)]
    pub fn version(&self) -> u16 {
        self.decoded.version
    }

    /// Descriptor dialect: `"empirical"` or `"synthetic"`.
    #[wasm_bindgen(getter)]
    pub fn flavor(&self) -> String {
        match self.decoded.flavor {
            DescriptorFlavor::Empirical => "empirical",
            DescriptorFlavor::Synthetic => "synthetic",
        }
        .to_string()
    }

    #[wasm_bindgen(getter)]
    pub fn timebase_raw(&self) -> String {
        self.decoded.timebase_raw.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn seconds_per_div(&self) -> f64 {
        self.decoded.seconds_per_div
    }

    /// 14-digit capture timestamp `HHMMSSYYYYMMDD`.
    #[wasm_bindgen(getter)]
    pub fn timestamp14(&self) -> String {
        self.decoded.timestamp14.clone()
    }

    // ---- warnings ----

    #[wasm_bindgen(getter)]
    pub fn warning_count(&self) -> usize {
        self.decoded.warnings.len()
    }

    pub fn warning_code(&self, index: usize) -> String {
        self.decoded.warnings[index].code().to_string()
    }

    /// Structured detail: JSON serialization of the Rust warning.
    pub fn warning_message(&self, index: usize) -> String {
        serde_json::to_string(&self.decoded.warnings[index]).expect("warning serializes")
    }

    // ---- physical channels ----

    #[wasm_bindgen(getter)]
    pub fn channel_count(&self) -> usize {
        self.decoded.channels.len()
    }

    /// Physical input letter `"A"`..=`"D"`.
    pub fn channel_letter(&self, index: usize) -> String {
        (self.decoded.channels[index].letter as char).to_string()
    }

    pub fn channel_label(&self, index: usize) -> String {
        self.decoded.channels[index].label.clone()
    }

    pub fn channel_samples(&self, index: usize) -> usize {
        self.decoded.channels[index].samples
    }

    /// Verbatim channel unit from the record param block (issue #103:
    /// `"V"`, `"A"`, `"mA"`, ...).
    pub fn channel_unit(&self, index: usize) -> String {
        self.decoded.channels[index].unit.clone()
    }

    /// Per-division value in channel units (issue #103:
    /// `(window_max − window_min) / 8`).
    pub fn channel_per_div(&self, index: usize) -> f64 {
        self.decoded.channels[index].per_div
    }

    /// Stored vertical window edges in base-SI channel units (issue #106:
    /// the NaN edge-clipping and readout-card window display read these).
    pub fn channel_window_min(&self, index: usize) -> f64 {
        self.decoded.channels[index].window_min
    }

    pub fn channel_window_max(&self, index: usize) -> f64 {
        self.decoded.channels[index].window_max
    }

    pub fn channel_delta_t(&self, index: usize) -> f64 {
        self.decoded.channels[index].delta_t
    }

    pub fn channel_timestamps_ptr(&self, index: usize) -> u32 {
        series_ptr(&self.decoded.channels[index].timestamps)
    }

    pub fn channel_timestamps_len(&self, index: usize) -> usize {
        self.decoded.channels[index].timestamps.len()
    }

    /// Physical sample values (`raw × S`, NaN at saturation).
    pub fn channel_values_ptr(&self, index: usize) -> u32 {
        series_ptr(&self.decoded.channels[index].values)
    }

    pub fn channel_values_len(&self, index: usize) -> usize {
        self.decoded.channels[index].values.len()
    }

    /// Verbatim raw sample counts (`i32` lane).
    pub fn channel_raw_counts_ptr(&self, index: usize) -> u32 {
        series_ptr(&self.decoded.channels[index].raw_counts)
    }

    pub fn channel_raw_counts_len(&self, index: usize) -> usize {
        self.decoded.channels[index].raw_counts.len()
    }

    /// Count of saturated (NaN-reading) samples on the channel.
    pub fn channel_saturated_samples(&self, index: usize) -> usize {
        self.decoded.channels[index].saturated_sample_count
    }

    // ---- derived (math) channels ----

    #[wasm_bindgen(getter)]
    pub fn derived_count(&self) -> usize {
        self.decoded.derived_channels.len()
    }

    pub fn derived_label(&self, index: usize) -> String {
        self.decoded.derived_channels[index].label.clone()
    }

    /// Full record-trailer label (e.g. `Mathematik A-B`).
    pub fn derived_record_label(&self, index: usize) -> String {
        self.decoded.derived_channels[index].record_label.clone()
    }

    /// Physical source letters concatenated, e.g. `"AB"` (best-effort).
    pub fn derived_source_channels(&self, index: usize) -> String {
        self.decoded.derived_channels[index]
            .source_channels
            .iter()
            .map(|letter| (*letter as char).to_string())
            .collect()
    }

    /// Whether the payload extent was recovered (ADR 0007 best-effort).
    pub fn derived_samples_known(&self, index: usize) -> bool {
        self.decoded.derived_channels[index].samples.is_some()
    }

    /// Sample count (0 when [`Self::derived_samples_known`] is false).
    pub fn derived_samples(&self, index: usize) -> usize {
        self.decoded.derived_channels[index].samples.unwrap_or(0)
    }

    pub fn derived_delta_t_known(&self, index: usize) -> bool {
        self.decoded.derived_channels[index].delta_t.is_some()
    }

    /// Sampling interval (0.0 when [`Self::derived_delta_t_known`] is
    /// false).
    pub fn derived_delta_t(&self, index: usize) -> f64 {
        self.decoded.derived_channels[index].delta_t.unwrap_or(0.0)
    }

    /// Legacy Q16.16-estimated values (verbatim, no NaN rule).
    pub fn derived_values_ptr(&self, index: usize) -> u32 {
        series_ptr(&self.decoded.derived_channels[index].values)
    }

    pub fn derived_values_len(&self, index: usize) -> usize {
        self.decoded.derived_channels[index].values.len()
    }

    /// Verbatim raw sample counts (`i32` lane; empty when the payload
    /// extent was not recovered).
    pub fn derived_raw_counts_ptr(&self, index: usize) -> u32 {
        series_ptr(&self.decoded.derived_channels[index].raw_counts)
    }

    pub fn derived_raw_counts_len(&self, index: usize) -> usize {
        self.decoded.derived_channels[index].raw_counts.len()
    }

    /// Always zero on derived channels (legacy estimate is verbatim).
    pub fn derived_saturated_samples(&self, index: usize) -> usize {
        self.decoded.derived_channels[index].saturated_sample_count
    }
}

/// Parses a complete capture from raw bytes (issue #9 wasm bridge).
///
/// `bytes` is copied into Wasm linear memory by the generated glue. On
/// failure the thrown JS value is the JSON encoding of [`ParseError`]
/// (`{ code, message, details }`).
///
/// # Panics
///
/// `ParseResult` index accessors panic on out-of-range indices (the JS
/// caller derives indices from the matching `*_count()` accessors).
#[wasm_bindgen]
pub fn parse_capture(bytes: &[u8]) -> Result<ParseResult, ParseError> {
    match decode_capture(bytes) {
        Ok(decoded) => Ok(ParseResult { decoded }),
        Err(error) => Err(ParseError::from_fvf(&error)),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use super::*;

    fn fixture(name: &str) -> Vec<u8> {
        fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/synthetic")
                .join(name),
        )
        .expect("committed fixture is present")
    }

    #[test]
    fn engine_version_is_non_empty() {
        assert!(!super::engine_version().is_empty());
    }

    #[test]
    fn bridge_matches_internal_decode_on_the_4ch_fixture() {
        let result = parse_capture(&fixture("accepted-en-4ch-10000-10ms-div.fvf.bin"))
            .expect("bridge decodes the 4ch fixture");

        assert_eq!(result.version(), 1);
        assert_eq!(result.flavor(), "synthetic");
        assert_eq!(result.timebase_raw(), "10 ms/Div");
        assert!((result.seconds_per_div() - 0.01).abs() < 1.0e-12);
        assert_eq!(result.timestamp14(), "12000020260101");
        assert_eq!(result.channel_count(), 4);
        assert_eq!(result.derived_count(), 0);
        assert_eq!(result.warning_count(), 0);

        let letters = ["A", "B", "C", "D"];
        for (index, letter) in letters.iter().enumerate() {
            assert_eq!(result.channel_letter(index), *letter);
            assert_eq!(result.channel_label(index), format!("Input {letter}"));
            assert_eq!(result.channel_samples(index), 10_000);
            assert!((result.channel_delta_t(index) - 1.0e-5).abs() < 1.0e-15);
            assert_eq!(result.channel_timestamps_len(index), 10_000);
            assert_eq!(result.channel_values_len(index), 10_000);
            assert_eq!(result.channel_raw_counts_len(index), 10_000);
            assert_eq!(result.channel_saturated_samples(index), 0);
            // Issue #106: the stored vertical window rides the bridge for
            // NaN edge-clipping and the readout-card window display. The
            // 4ch fixture carries ±800 windows with 200 per-div on V.
            assert!(result.channel_window_max(index) > result.channel_window_min(index));
            assert!(
                (result.channel_per_div(index) * 8.0
                    - (result.channel_window_max(index) - result.channel_window_min(index)))
                .abs()
                    < 1.0e-9
            );
            assert_eq!(result.channel_timestamps_ptr(index) % 4, 0, "f32 alignment");
            assert_eq!(result.channel_values_ptr(index) % 4, 0, "f32 alignment");
            assert_eq!(result.channel_raw_counts_ptr(index) % 4, 0, "i32 alignment");
        }
    }

    #[test]
    fn bridge_exposes_derived_channels() {
        let result = parse_capture(&fixture("derived-mathematik-2ch-3000-10ms-div.fvf.bin"))
            .expect("derived fixture decodes");

        assert_eq!(result.channel_count(), 1);
        assert_eq!(result.derived_count(), 1);
        assert_eq!(result.derived_label(0), "Mathematik A");
        assert_eq!(result.derived_record_label(0), "Mathematik A");
        assert_eq!(result.derived_source_channels(0), "A");
        assert!(result.derived_samples_known(0));
        assert_eq!(result.derived_samples(0), 3_000);
        assert!(result.derived_delta_t_known(0));
        assert_eq!(result.derived_values_len(0), 3_000);
        assert_eq!(result.derived_raw_counts_len(0), 3_000);
        assert_eq!(result.derived_saturated_samples(0), 0);
        assert_eq!(result.derived_values_ptr(0) % 4, 0, "f32 alignment");
        assert_eq!(result.derived_raw_counts_ptr(0) % 4, 0, "i32 alignment");
    }

    #[test]
    fn bridge_maps_typed_failures_to_json_payloads() {
        let cases = [
            (
                "rejected-invalid-magic-1ch-1000.fvf.bin",
                "invalid_signature",
            ),
            (
                "rejected-timebase-format-1ch-1000.fvf.bin",
                "invalid_timebase_format",
            ),
            (
                "rejected-timebase-range-1ch-1000.fvf.bin",
                "invalid_timebase_range",
            ),
            (
                "unsupported-variant-settings.fvf.bin",
                "unsupported_capture_variant",
            ),
        ];
        for (name, code) in cases {
            let error = parse_capture(&fixture(name))
                .expect_err(&format!("{name} must fail through the bridge"));
            assert_eq!(error.code(), code, "{name}: code");
            assert!(!error.message().is_empty(), "{name}: message");
            let value: serde_json::Value =
                serde_json::from_str(&serde_json::to_string(&error).expect("serializes"))
                    .expect("thrown payload is JSON");
            assert_eq!(value["code"], code, "{name}: JSON code");
            assert!(value["message"].is_string(), "{name}: JSON message");
            assert!(value["details"].is_string(), "{name}: JSON details");
        }

        // Truncation exercises a non-fixture failure mode end-to-end.
        let error = parse_capture(&fixture("accepted-en-4ch-10000-10ms-div.fvf.bin")[..64])
            .expect_err("truncated input must fail");
        assert_eq!(error.code(), "truncated_capture");
        assert!(error.details().contains("needed"));
    }

    #[test]
    fn bridge_maps_invalid_time_axis_to_json_payload() {
        let error = ParseError::from_fvf(&FvfError::InvalidTimeAxis {
            label: "Input A".to_owned(),
            detail: "right edge 0 is not above left edge 0".to_owned(),
        });
        assert_eq!(error.code(), "invalid_time_axis");
        let value: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&error).expect("serializes"))
                .expect("thrown payload is JSON");
        assert_eq!(value["code"], "invalid_time_axis");
        assert!(value["message"].as_str().unwrap().contains("Input A"));
        assert!(value["details"].as_str().unwrap().contains("not above"));
    }

    #[test]
    fn invalid_signature_details_carry_detected_bytes() {
        let error = parse_capture(&fixture("rejected-invalid-magic-1ch-1000.fvf.bin"))
            .expect_err("invalid magic fixture fails");

        assert_eq!(error.code(), "invalid_signature");
        let details: serde_json::Value = serde_json::from_str(error.details()).expect("JSON");
        assert_eq!(details["detectedAscii"], "XX.XVF..");
        assert_eq!(details["detectedHex"], "58 58 2e 58 56 46 1a 00");
    }
}
