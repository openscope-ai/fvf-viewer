//! Channel record discovery, Q16.16 payload decoding, and timestamp
//! reconstruction (issue #8).
//!
//! Record discovery walks the sector table per ADR 0007 — the buffer is
//! never blindly scanned:
//!
//! - **Record 1 location.** Empirical dialect: the first label-slot
//!   pointer minus 112 lands on record 1's parameter block (verified on
//!   all eight waveform captures). Synthetic dialect (ADR 0006): a
//!   bounded, grammar-validated scan forward from the label-slot block
//!   finds the 10-byte plot-format tag `%w  %d  %t`, and record 1 starts
//!   78 bytes later. Every candidate is confirmed by the full record
//!   grammar below before the chain starts; an unresolvable table fails
//!   typed with [`FvfError::CorruptSectorTable`].
//! - **Record chain.** Records are strictly contiguous:
//!   `[param block (388)][Q16.16 payload (4·N)][trailer (60+L)]`, so each
//!   record's trailer end is the next record's param start, and the last
//!   trailer ends exactly at end-of-file (corpus-verified invariant).
//! - **Standard decode (physical records; hard errors).** `u32` sample
//!   count N at param+224 inside the 500..=250,000 envelope, the
//!   self-referential payload pointer `u32` at param+308 equal to
//!   `param+340` (`payload_start − 48`), the marker `02 00 01 00 04 00`
//!   occupying param+382..388, and a fully validated trailer at
//!   `payload_start + 4·N` (`u32@+12 + 24 == start`, `u32@+20 + 16 ==
//!   start`, `u16@+28 == 1`, `FlukeView` at +30, printable label at +58
//!   with length at +56).
//! - **Vertical metadata (issue #103).** Every record exposes its
//!   verbatim unit (+312), window (+126/+134), scale (+328), family
//!   (+324), and derived per-division; standard records additionally
//!   run consistency validation (duplicate equality, finiteness,
//!   `window_max > window_min`, `scale > 0`) with typed warnings, never
//!   errors. Derived records skip validation (deviating layout).
//! - **Derived records (best-effort).** Derived (`Math`/`Mathematik`)
//!   parameter blocks deviate from the standard layout (the corpus derived-math
//!   record shifts its slots non-uniformly and carries no valid sample
//!   count at +224), so after a failed standard decode the payload extent
//!   is recovered from the first payload marker inside the record and the
//!   validated trailer grammar; undecodable extents downgrade to
//!   [`ParseWarning::DerivedRecordIssue`] warnings per ADR 0007 while the
//!   record chain continues through the validated trailer. Empirically
//!   The corpus derived-math record's `Mathematik A-B` extent-decodes to 621 samples.
//! - **Timestamps.** With N known per channel, the stored time-axis
//!   range (param+20/+44) decodes to `delta_t = (t_right − t_left) / N`
//!   in f64 and `t_i = t_left + i · delta_t` in f64 cast to f32 (issue
//!   #105, the sole timestamp source — no fallback). Non-finite edges,
//!   `t_right <= t_left`, or a zero sample count fail typed as
//!   `invalid_time_axis`; a span disagreement beyond ~5% against the
//!   timebase-implied span warns while the stored range rules.
//!
//! All multi-byte reads are bounds-checked `byteorder::LittleEndian`
//! reads; unaligned payload offsets (689, 827, 830 in the corpus) never
//! go through typed pointer dereferences, keeping the module
//! wasm32-compatible.

use crate::error::{FvfError, ParseWarning};
use crate::fixed_point;
use crate::header::{
    SectorTable, classify_channel, locate_sector_table, read_f64, read_tag, read_u16, read_u32,
};
use crate::timebase::validate_timebase;
use crate::types::{ChannelData, ChannelKind, DecodedCapture, DerivedChannelData, TimestampAxis};

/// Envelope lower bound: 500 points per channel (shortened captures).
pub const MIN_SAMPLES_PER_CHANNEL: usize = 500;
/// Envelope upper bound: 250,000 points per channel (deep captures).
pub const MAX_SAMPLES_PER_CHANNEL: usize = 250_000;
/// Record parameter block length in bytes.
pub const PARAM_BLOCK_LEN: usize = 388;
/// The last six param-block bytes immediately before a payload.
pub const PAYLOAD_MARKER: [u8; 6] = [0x02, 0x00, 0x01, 0x00, 0x04, 0x00];
/// EN-dialect plot-format tag; the synthetic record-1 scan anchor.
pub const PLOT_FORMAT_TAG: [u8; 10] = *b"%w  %d  %t";
/// Bytes between the plot-format tag and record 1's parameter block.
const POST_FORMAT_LEN: usize = 68;
/// `u32` sample count slot inside the param block.
const SAMPLE_COUNT_SLOT: usize = 224;
/// Self-referential payload pointer slot (`payload_start − 48`).
const PAYLOAD_POINTER_SLOT: usize = 308;
/// Embedded timebase string slot (NUL-padded, up to 12 bytes).
const TIMEBASE_SLOT: usize = 232;
const TIMEBASE_SLOT_LEN: usize = 12;
/// 14-digit capture timestamp slot (`HHMMSSYYYYMMDD`).
const TIMESTAMP_SLOT: usize = 164;
const TIMESTAMP_LEN: usize = 14;
/// Stored time-axis edges in seconds, trigger-relative (issue #105):
/// left edge at +20, right edge at +44. The sole timestamp source —
/// no fallback reconstruction.
const TIME_AXIS_LEFT_SLOT: usize = 20;
const TIME_AXIS_RIGHT_SLOT: usize = 44;
/// Span disagreement beyond this relative fraction against the
/// timebase-implied span (10 × seconds/div) raises a typed warning
/// (issue #105); the stored range always rules.
const TIME_AXIS_SPAN_TOLERANCE: f64 = 0.05;
/// Empirical label-slot pointers sit this far into the param block.
const SLOT_POINTER_PARAM_OFFSET: usize = 112;
/// Trailer sector-name magic at trailer+30.
const TRAILER_NAME: [u8; 9] = *b"FlukeView";
/// Offset of the sector-name magic inside the trailer.
const TRAILER_NAME_OFFSET: usize = 30;
const TRAILER_LABEL_LEN_SLOT: usize = 56;
const TRAILER_LABEL_SLOT: usize = 58;
const TRAILER_BASE_LEN: usize = 60;
/// Defensive label-length bound (largest observed: 14 = `Mathematik A-B`).
const MAX_RECORD_LABEL_LEN: usize = 32;
/// Bounded window for the synthetic record-1 plot-format tag scan.
const PLOT_TAG_SCAN_LIMIT: usize = 256;
/// The standard payload marker ends at param+388; the derived extent
/// search starts a few bytes earlier to cover layout drift (+8 observed).
const MARKER_SEARCH_BACK_OFFSET: usize = PARAM_BLOCK_LEN - 6;
/// Cap on grammar-invalid `FlukeView` occurrences probed per derived
/// record before the walk gives up (defensive; zero observed).
const MAX_TRAILER_CANDIDATES: usize = 8;

fn corrupt(detail: impl Into<String>) -> FvfError {
    FvfError::CorruptSectorTable {
        detail: detail.into(),
    }
}

fn need(data: &[u8], end: usize) -> Result<(), FvfError> {
    if end > data.len() {
        return Err(FvfError::TruncatedCapture {
            needed: end,
            available: data.len(),
        });
    }
    Ok(())
}

/// One discovered record sector: located payload extent, trailer label,
/// and whether the standard param-block decode succeeded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sector {
    /// 1-based sector index (descriptor order).
    pub index: usize,
    pub param_start: usize,
    pub payload_start: usize,
    pub payload_len: usize,
    pub trailer_start: usize,
    /// Total trailer length in bytes (`60 + label_len`).
    pub trailer_len: usize,
    /// Label read from the record trailer (the instrument's own tag).
    pub record_label: String,
    /// Decoded sample count; `None` when even the best-effort extent was
    /// not a whole number of samples (derived records only).
    pub samples: Option<usize>,
    /// True when the param block decoded through the standard layout.
    pub standard: bool,
}

impl Sector {
    /// First byte past this record == the next record's param start.
    fn end(&self) -> usize {
        self.trailer_start + self.trailer_len
    }
}

/// Validates the full trailer grammar at `trailer_start` and returns the
/// record label plus the total trailer length.
fn validate_trailer(data: &[u8], trailer_start: usize) -> Result<(String, usize), FvfError> {
    need(data, trailer_start + TRAILER_LABEL_SLOT)?;
    if read_u32(data, trailer_start + 12)? as usize + 24 != trailer_start
        || read_u32(data, trailer_start + 20)? as usize + 16 != trailer_start
        || read_u16(data, trailer_start + 28)? != 1
        || data[trailer_start + 30..trailer_start + 39] != TRAILER_NAME
    {
        return Err(corrupt(format!(
            "trailer grammar rejected at {trailer_start}"
        )));
    }
    let label_len = read_u16(data, trailer_start + TRAILER_LABEL_LEN_SLOT)? as usize;
    if label_len == 0 || label_len > MAX_RECORD_LABEL_LEN {
        return Err(corrupt(format!(
            "implausible trailer label length {label_len} at {trailer_start}"
        )));
    }
    let label = read_tag(data, trailer_start + TRAILER_LABEL_SLOT, label_len)?;
    if !label
        .iter()
        .all(|byte| byte.is_ascii_graphic() || *byte == b' ')
    {
        return Err(corrupt(format!(
            "non-printable trailer label at {trailer_start}"
        )));
    }
    Ok((
        String::from_utf8_lossy(label).into_owned(),
        TRAILER_BASE_LEN + label_len,
    ))
}

/// Standard param-block decode: sample count, self-referential payload
/// pointer, marker, and a fully validated trailer at `payload_start+4·N`.
fn standard_sector(data: &[u8], index: usize, param_start: usize) -> Result<Sector, FvfError> {
    let payload_start = param_start + PARAM_BLOCK_LEN;
    need(data, payload_start)?;
    if data[payload_start - 6..payload_start] != PAYLOAD_MARKER {
        return Err(corrupt(format!(
            "payload marker missing before {payload_start}"
        )));
    }
    let count = read_u32(data, param_start + SAMPLE_COUNT_SLOT)? as usize;
    if !(MIN_SAMPLES_PER_CHANNEL..=MAX_SAMPLES_PER_CHANNEL).contains(&count) {
        return Err(corrupt(format!(
            "sample count {count} outside the {MIN_SAMPLES_PER_CHANNEL}..={MAX_SAMPLES_PER_CHANNEL} envelope at {param_start}"
        )));
    }
    if read_u32(data, param_start + PAYLOAD_POINTER_SLOT)? as usize + 48 != payload_start {
        return Err(corrupt(format!(
            "payload pointer mismatch for record at {param_start}"
        )));
    }
    let payload_len = count * 4;
    let payload_end = payload_start + payload_len;
    need(data, payload_end)?;
    let (record_label, trailer_len) = validate_trailer(data, payload_end)?;
    Ok(Sector {
        index,
        param_start,
        payload_start,
        payload_len,
        trailer_start: payload_end,
        trailer_len,
        record_label,
        samples: Some(count),
        standard: true,
    })
}

/// Best-effort extent decode for derived records whose param block
/// deviates from the standard layout: the first payload marker inside the
/// record bounds the payload from the left, the validated trailer grammar
/// bounds it from the right.
fn extent_sector(data: &[u8], index: usize, param_start: usize) -> Result<Sector, FvfError> {
    let search_from = param_start + MARKER_SEARCH_BACK_OFFSET;
    let mut from = param_start + PARAM_BLOCK_LEN;
    let mut attempts = 0;
    let trailer_start = loop {
        attempts += 1;
        if attempts > MAX_TRAILER_CANDIDATES {
            return Err(corrupt(format!(
                "no grammar-valid trailer for derived record at {param_start}"
            )));
        }
        let Some(found) = data[from..]
            .windows(TRAILER_NAME.len())
            .position(|window| window == TRAILER_NAME)
            .map(|offset| from + offset)
        else {
            return Err(corrupt(format!(
                "no trailer candidate for derived record at {param_start}"
            )));
        };
        from = found + 1;
        let Some(candidate) = found.checked_sub(TRAILER_NAME_OFFSET) else {
            continue;
        };
        if validate_trailer(data, candidate).is_ok() {
            break candidate;
        }
    };
    if trailer_start < search_from + PAYLOAD_MARKER.len() {
        return Err(corrupt(format!(
            "derived record at {param_start} shorter than a param block"
        )));
    }
    let marker = data[search_from..trailer_start]
        .windows(PAYLOAD_MARKER.len())
        .position(|window| window == PAYLOAD_MARKER)
        .map(|offset| search_from + offset)
        .ok_or_else(|| {
            corrupt(format!(
                "no payload marker in derived record at {param_start}"
            ))
        })?;
    let payload_start = marker + PAYLOAD_MARKER.len();
    let payload_len = trailer_start - payload_start;
    let (record_label, trailer_len) = validate_trailer(data, trailer_start)?;
    let samples = if payload_len > 0 && payload_len.is_multiple_of(4) {
        Some(payload_len / 4)
    } else {
        None
    };
    Ok(Sector {
        index,
        param_start,
        payload_start,
        payload_len,
        trailer_start,
        trailer_len,
        record_label,
        samples,
        standard: false,
    })
}

fn decode_sector(
    data: &[u8],
    index: usize,
    param_start: usize,
    derived: bool,
) -> Result<Sector, FvfError> {
    match standard_sector(data, index, param_start) {
        Ok(sector) => Ok(sector),
        Err(error) if derived => match extent_sector(data, index, param_start) {
            Ok(sector) => Ok(sector),
            // Truncation is the more fundamental diagnosis: the file is
            // short, not structurally wrong.
            Err(FvfError::TruncatedCapture { .. }) => Err(error),
            Err(extent) => Err(extent),
        },
        Err(error) => Err(error),
    }
}

fn is_derived_label(label: &str) -> bool {
    label.as_bytes().starts_with(b"Math")
}

/// Record 1 param-block candidates, in walk order: the empirical
/// label-slot pointer, then the plot-format tag position (synthetic
/// dialect; also embedded by EN empirical captures).
fn first_record_candidates(data: &[u8], table: &SectorTable) -> Vec<usize> {
    let mut candidates = Vec::new();
    if let Some(param) = table
        .slot_pointers
        .first()
        .and_then(|pointer| pointer.checked_sub(SLOT_POINTER_PARAM_OFFSET))
    {
        candidates.push(param);
    }
    if table.labels_end > 0 {
        let scan_end = table
            .labels_end
            .saturating_add(PLOT_TAG_SCAN_LIMIT)
            .min(data.len());
        if let Some(found) = data[table.labels_end..scan_end]
            .windows(PLOT_FORMAT_TAG.len())
            .position(|window| window == PLOT_FORMAT_TAG)
            .map(|offset| table.labels_end + offset)
        {
            candidates.push(found + PLOT_FORMAT_TAG.len() + POST_FORMAT_LEN);
        }
    }
    candidates
}

/// Walks the full record chain: record 1 located through the sector
/// table, then strictly contiguous records, asserting the descriptor
/// count and an exact end-of-file termination.
pub fn walk_sectors(data: &[u8], table: &SectorTable) -> Result<Vec<Sector>, FvfError> {
    let count = table.labels.len();
    if count == 0 {
        return Err(corrupt("sector table lists no records"));
    }
    // A valid file always holds at least one record after the label
    // block (≥ 2.4 KB), so a short scan window means truncation.
    if table.labels_end > 0 {
        need(data, table.labels_end + PLOT_TAG_SCAN_LIMIT)?;
    }
    let mut sectors: Vec<Sector> = Vec::with_capacity(count);
    let mut first_error = None;
    for candidate in first_record_candidates(data, table) {
        match decode_sector(data, 1, candidate, is_derived_label(&table.labels[0])) {
            Ok(sector) => {
                sectors.push(sector);
                break;
            }
            Err(error) => {
                first_error.get_or_insert(error);
            }
        }
    }
    if sectors.is_empty() {
        return Err(
            first_error.unwrap_or_else(|| corrupt("sector table carries no usable record pointer"))
        );
    }
    while sectors.len() < count {
        let index = sectors.len() + 1;
        let derived = is_derived_label(&table.labels[sectors.len()]);
        let param_start = sectors[sectors.len() - 1].end();
        sectors.push(decode_sector(data, index, param_start, derived)?);
    }
    let chain_end = sectors[count - 1].end();
    need(data, chain_end)?;
    if chain_end != data.len() {
        return Err(corrupt(format!(
            "record chain ends at {chain_end} but the file holds {} bytes",
            data.len()
        )));
    }
    Ok(sectors)
}

/// Physical source letters encoded in a derived record label
/// (`Mathematik A-B` → `[A, B]`), best-effort.
fn math_source_letters(record_label: &str) -> Vec<u8> {
    let rest = record_label
        .strip_prefix("Mathematik ")
        .unwrap_or(record_label);
    rest.bytes()
        .filter(|byte| (b'A'..=b'D').contains(byte))
        .collect()
}

/// Param-block slots for per-channel vertical metadata (issue #103).
const WINDOW_MIN_SLOT: usize = 126;
const UNIT_SLOT: usize = 312;
const UNIT_SLOT_LEN: usize = 4;
const UNIT_FAMILY_SLOT: usize = 324;
const SCALE_SLOT: usize = 328;
const SCALE_DUP_SLOT: usize = 344;
const WINDOW_DUP_SLOT: usize = 366;

/// Unit tokens with established physical meaning (issue #103), grounded
/// on the corpus — including `kV`, observed on a standard
/// kilovolt record. Anything else parses through verbatim with an
/// [`ParseWarning::UnknownUnit`] warning; the full token table is open
/// research (issue #108).
const KNOWN_UNITS: [&str; 5] = ["V", "mV", "kV", "A", "mA"];

/// Decoded per-channel vertical metadata: verbatim reads plus the derived
/// per-division value, with consistency warnings for standard records.
#[derive(Debug, Clone, PartialEq)]
pub struct VerticalMetadata {
    pub unit: String,
    pub unit_family: u32,
    pub window_min: f64,
    pub window_max: f64,
    pub scale: f64,
    pub per_div: f64,
}

/// Decodes the vertical-metadata slots at `param_start`. Every record —
/// physical and derived — exposes its verbatim reads, but only standard
/// records (`validate = true`) run the consistency checks: derived param
/// blocks deviate from the standard layout (ADR 0007), so validating
/// their reads would warn about instrument garbage (the derived-math
/// record carries `kV`, scale 20.0, and a degenerate window). Validation
/// failures are warnings, never errors; the verbatim values are always
/// exposed.
fn decode_vertical_metadata(
    data: &[u8],
    param_start: usize,
    label: &str,
    validate: bool,
) -> Result<(VerticalMetadata, Vec<ParseWarning>), FvfError> {
    let unit = nul_terminated_ascii(read_tag(data, param_start + UNIT_SLOT, UNIT_SLOT_LEN)?);
    let unit_family = read_u32(data, param_start + UNIT_FAMILY_SLOT)?;
    let window_min = read_f64(data, param_start + WINDOW_MIN_SLOT)?;
    let window_max = read_f64(data, param_start + WINDOW_MIN_SLOT + 8)?;
    let scale = read_f64(data, param_start + SCALE_SLOT)?;
    let scale_dup = read_f64(data, param_start + SCALE_DUP_SLOT)?;
    let window_min_dup = read_f64(data, param_start + WINDOW_DUP_SLOT)?;
    let window_max_dup = read_f64(data, param_start + WINDOW_DUP_SLOT + 8)?;
    let mut warnings = Vec::new();
    if validate {
        if !KNOWN_UNITS.contains(&unit.as_str()) {
            warnings.push(ParseWarning::UnknownUnit {
                label: label.to_owned(),
                unit: unit.clone(),
            });
        }
        if !window_min.is_finite() || !window_max.is_finite() || !scale.is_finite() {
            warnings.push(ParseWarning::VerticalMetadataMismatch {
                label: label.to_owned(),
                detail: format!(
                    "non-finite value: window [{window_min}, {window_max}], scale {scale}"
                ),
            });
        }
        if scale_dup.to_bits() != scale.to_bits() {
            warnings.push(ParseWarning::VerticalMetadataMismatch {
                label: label.to_owned(),
                detail: format!("scale duplicate at +344 differs from +328 ({scale})"),
            });
        }
        if window_min_dup.to_bits() != window_min.to_bits()
            || window_max_dup.to_bits() != window_max.to_bits()
        {
            warnings.push(ParseWarning::VerticalMetadataMismatch {
                label: label.to_owned(),
                detail: format!(
                    "window duplicates at +366/+374 differ from +126/+134 ([{window_min}, {window_max}])"
                ),
            });
        }
        if window_max <= window_min {
            warnings.push(ParseWarning::VerticalMetadataMismatch {
                label: label.to_owned(),
                detail: format!("window_max {window_max} is not above window_min {window_min}"),
            });
        }
        if scale <= 0.0 {
            warnings.push(ParseWarning::VerticalMetadataMismatch {
                label: label.to_owned(),
                detail: format!("scale {scale} is not positive"),
            });
        }
    }
    Ok((
        VerticalMetadata {
            unit,
            unit_family,
            window_min,
            window_max,
            scale,
            per_div: (window_max - window_min) / 8.0,
        },
        warnings,
    ))
}

/// Decodes the per-channel time axis from the stored range (issue
/// #105, the sole timestamp source): `delta_t = (t_right − t_left) /
/// N` in f64, `t_i = t_left + i · delta_t` in f64 cast to f32, with
/// `t = 0` at the trigger reference wherever the file puts it.
/// Non-finite edges, `t_right <= t_left`, or a zero sample count fail
/// with typed [`FvfError::InvalidTimeAxis`] — stored-only, no fallback.
pub fn decode_time_axis(
    data: &[u8],
    param_start: usize,
    samples: usize,
    record_label: &str,
) -> Result<TimestampAxis, FvfError> {
    let invalid = |detail: String| FvfError::InvalidTimeAxis {
        label: record_label.to_owned(),
        detail,
    };
    if samples == 0 {
        return Err(invalid("sample count is zero".to_owned()));
    }
    let unreachable = |_| invalid(format!("time-axis slots unreachable at {param_start}"));
    let t_left = read_f64(data, param_start + TIME_AXIS_LEFT_SLOT).map_err(unreachable)?;
    let t_right = read_f64(data, param_start + TIME_AXIS_RIGHT_SLOT).map_err(unreachable)?;
    if !t_left.is_finite() || !t_right.is_finite() {
        return Err(invalid(format!("non-finite edges [{t_left}, {t_right}]")));
    }
    if t_right <= t_left {
        return Err(invalid(format!(
            "right edge {t_right} is not above left edge {t_left}"
        )));
    }
    let delta_t = (t_right - t_left) / samples as f64;
    let times = (0..samples)
        .map(|index| (t_left + index as f64 * delta_t) as f32)
        .collect();
    Ok(TimestampAxis { delta_t, times })
}

/// Instrument saturation rails observed across the corpus (issue
/// #104): the high clamp is exactly `i32::MAX`; the low clamp is
/// exactly `i32::MIN + 2` (Scope34-A carries 123 low-rail samples
/// there; exact `i32::MIN` never occurs corpus-wide but reads NaN all
/// the same, since the instrument clamps overloads instead of
/// wrapping).
fn is_saturated_sample(raw: i32) -> bool {
    raw == i32::MAX || raw == i32::MIN || raw == i32::MIN + 2
}

/// Physical-value decode (issue #104): verbatim raw counts plus
/// `values` as `raw × S` in f64 cast to f32, with saturated rails
/// reading NaN. Returns the values vector and the low/high rail
/// counts. `payload` must hold whole 4-byte samples.
fn decode_physical_values(payload: &[u8], scale: f64) -> (Vec<i32>, Vec<f32>, usize, usize) {
    let (words, remainder) = payload.as_chunks::<4>();
    debug_assert!(remainder.is_empty(), "payload holds whole samples");
    let raw_counts: Vec<i32> = words.iter().map(|word| i32::from_le_bytes(*word)).collect();
    let mut saturated_low = 0usize;
    let mut saturated_high = 0usize;
    let values = raw_counts
        .iter()
        .map(|&raw| {
            if !is_saturated_sample(raw) {
                return (f64::from(raw) * scale) as f32;
            }
            if raw == i32::MAX {
                saturated_high += 1;
            } else {
                saturated_low += 1;
            }
            f32::NAN
        })
        .collect();
    (raw_counts, values, saturated_low, saturated_high)
}

/// Full decode: header/sector walk, physical-value payload conversion,
/// derived best-effort channels, validated timebase, capture timestamp,
/// and the reconstructed time axes, with the ADR 0007 warning
/// inventory.
pub fn decode_capture(data: &[u8]) -> Result<DecodedCapture, FvfError> {
    let table = locate_sector_table(data)?;
    let sectors = walk_sectors(data, &table)?;

    let anchor = table
        .labels
        .iter()
        .zip(&sectors)
        .find(|(label, sector)| sector.standard && !is_derived_label(label))
        .map(|(_, sector)| sector)
        .ok_or_else(|| corrupt("no standard physical record anchors the timebase"))?;
    let timebase_raw = nul_terminated_ascii(read_tag(
        data,
        anchor.param_start + TIMEBASE_SLOT,
        TIMEBASE_SLOT_LEN,
    )?);
    let validated = validate_timebase(&timebase_raw)?;
    let timestamp14 = String::from_utf8_lossy(read_tag(
        data,
        anchor.param_start + TIMESTAMP_SLOT,
        TIMESTAMP_LEN,
    )?)
    .into_owned();

    let mut warnings = validated.warnings;
    let mut channels = Vec::new();
    let mut derived_channels = Vec::new();
    for (label, sector) in table.labels.iter().zip(&sectors) {
        let mut classified = Vec::new();
        let mut sector_warnings = Vec::new();
        classify_channel(label.clone(), &mut classified, &mut sector_warnings);
        warnings.append(&mut sector_warnings);
        let Some(descriptor) = classified.first() else {
            continue; // unclassified or duplicate: warning already inventoried
        };
        let payload = &data[sector.payload_start..sector.payload_start + sector.payload_len];
        if descriptor.kind == ChannelKind::Physical {
            let samples = sector.samples.ok_or_else(|| {
                corrupt(format!(
                    "physical record {} lost its sample count",
                    sector.index
                ))
            })?;
            let axis = decode_time_axis(data, sector.param_start, samples, &sector.record_label)?;
            // The timebase string stays display-only: its numeric value
            // is a cross-check, and a span disagreement beyond ~5%
            // warns while the stored range rules (issue #105).
            let stored_span = axis.delta_t * samples as f64;
            let expected_span = 10.0 * validated.seconds_per_div;
            if (stored_span - expected_span).abs() > TIME_AXIS_SPAN_TOLERANCE * expected_span {
                warnings.push(ParseWarning::TimeAxisSpanMismatch {
                    label: sector.record_label.clone(),
                    detail: format!(
                        "stored span {stored_span} disagrees with timebase span {expected_span}"
                    ),
                });
            }
            // Physical records always decode through the standard layout:
            // decode_sector errors on a non-standard physical block instead
            // of extent-falling-back (that path is derived-only), so
            // sector.standard is invariably true here and validation
            // unconditionally applies. Passing the flag rather than `true`
            // keeps the invariant explicit at every construction site.
            let (vertical, mut meta_warnings) = decode_vertical_metadata(
                data,
                sector.param_start,
                &sector.record_label,
                sector.standard,
            )?;
            warnings.append(&mut meta_warnings);
            let (raw_counts, values, saturated_low, saturated_high) =
                decode_physical_values(payload, vertical.scale);
            if saturated_low > 0 || saturated_high > 0 {
                warnings.push(ParseWarning::SaturatedSamples {
                    label: sector.record_label.clone(),
                    low: saturated_low,
                    high: saturated_high,
                });
            }
            channels.push(ChannelData {
                label: descriptor.label.clone(),
                letter: descriptor
                    .letter
                    .expect("physical classification always carries a letter"),
                record_label: sector.record_label.clone(),
                samples,
                delta_t: axis.delta_t,
                timestamps: axis.times,
                values,
                raw_counts,
                saturated_sample_count: saturated_low + saturated_high,
                unit: vertical.unit,
                unit_family: vertical.unit_family,
                window_min: vertical.window_min,
                window_max: vertical.window_max,
                scale: vertical.scale,
                per_div: vertical.per_div,
            });
        } else if let Some(samples) = sector
            .samples
            .filter(|count| *count == sector.payload_len / 4)
        {
            // Derived records share the stored-only policy: invalid
            // slots fail the decode (no fallback), but the span
            // cross-check is validation and derived layouts skip
            // validation per ADR 0007.
            let axis = decode_time_axis(data, sector.param_start, samples, &sector.record_label)?;
            let (vertical, mut meta_warnings) =
                decode_vertical_metadata(data, sector.param_start, &sector.record_label, false)?;
            warnings.append(&mut meta_warnings);
            // Unvalidated derived layouts keep the legacy Q16.16
            // estimate verbatim (issue #108 owns the real
            // scale/offset model); the typed warning marks every
            // value it produces.
            warnings.push(ParseWarning::DerivedLegacyValues {
                label: sector.record_label.clone(),
                detail: "derived scale/offset model unvalidated; values stay raw / 65536"
                    .to_owned(),
            });
            let (words, remainder) = payload.as_chunks::<4>();
            debug_assert!(remainder.is_empty(), "payload holds whole samples");
            let raw_counts: Vec<i32> = words.iter().map(|word| i32::from_le_bytes(*word)).collect();
            derived_channels.push(DerivedChannelData {
                label: descriptor.label.clone(),
                record_label: sector.record_label.clone(),
                source_channels: math_source_letters(&sector.record_label),
                samples: Some(samples),
                delta_t: Some(axis.delta_t),
                timestamps: axis.times,
                values: fixed_point::decode_q16_16_le(payload),
                raw_counts,
                saturated_sample_count: 0,
                unit: vertical.unit,
                unit_family: vertical.unit_family,
                window_min: vertical.window_min,
                window_max: vertical.window_max,
                scale: vertical.scale,
                per_div: vertical.per_div,
            });
        } else {
            warnings.push(ParseWarning::DerivedRecordIssue {
                label: sector.record_label.clone(),
                detail: format!(
                    "payload extent of {} bytes at {} is not a whole sample count",
                    sector.payload_len, sector.payload_start
                ),
            });
            let (vertical, mut meta_warnings) =
                decode_vertical_metadata(data, sector.param_start, &sector.record_label, false)?;
            warnings.append(&mut meta_warnings);
            derived_channels.push(DerivedChannelData {
                label: descriptor.label.clone(),
                record_label: sector.record_label.clone(),
                source_channels: math_source_letters(&sector.record_label),
                samples: None,
                delta_t: None,
                timestamps: Vec::new(),
                values: Vec::new(),
                raw_counts: Vec::new(),
                saturated_sample_count: 0,
                unit: vertical.unit,
                unit_family: vertical.unit_family,
                window_min: vertical.window_min,
                window_max: vertical.window_max,
                scale: vertical.scale,
                per_div: vertical.per_div,
            });
        }
    }

    Ok(DecodedCapture {
        version: table.version,
        flavor: table.flavor,
        timebase_raw,
        seconds_per_div: validated.seconds_per_div,
        timestamp14,
        channels,
        derived_channels,
        warnings,
    })
}

fn nul_terminated_ascii(slot: &[u8]) -> String {
    let end = slot
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(slot.len());
    String::from_utf8_lossy(&slot[..end]).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::header::parse_header;
    use std::fs;
    use std::path::Path;

    fn fixture_bytes(name: &str) -> Vec<u8> {
        fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/synthetic")
                .join(name),
        )
        .unwrap_or_else(|error| panic!("committed fixture {name} is present: {error}"))
    }

    fn de_fixture() -> Vec<u8> {
        fixture_bytes("accepted-de-eingang-1ch-3000-comma-decimal.fvf.bin")
    }

    fn two_channel_fixture() -> Vec<u8> {
        fixture_bytes("accepted-en-2ch-10000-1min-div.fvf.bin")
    }

    fn derived_fixture() -> Vec<u8> {
        fixture_bytes("derived-mathematik-2ch-3000-10ms-div.fvf.bin")
    }

    #[test]
    fn envelope_constants_match_architecture() {
        assert_eq!(MIN_SAMPLES_PER_CHANNEL, 500);
        assert_eq!(MAX_SAMPLES_PER_CHANNEL, 250_000);
    }

    /// Minimal param block carrying only the stored time-axis edges.
    fn param_block_with_axis(t_left: f64, t_right: f64) -> Vec<u8> {
        let mut block = vec![0u8; PARAM_BLOCK_LEN];
        block[TIME_AXIS_LEFT_SLOT..TIME_AXIS_LEFT_SLOT + 8].copy_from_slice(&t_left.to_le_bytes());
        block[TIME_AXIS_RIGHT_SLOT..TIME_AXIS_RIGHT_SLOT + 8]
            .copy_from_slice(&t_right.to_le_bytes());
        block
    }

    #[test]
    fn stored_time_axis_decodes_edges_and_steps() {
        let block = param_block_with_axis(-0.05, 0.05);
        let axis = decode_time_axis(&block, 0, 500, "Input A").expect("valid edges decode");
        assert_eq!(axis.times.len(), 500);
        assert!((axis.delta_t - 2.0e-4).abs() < 1.0e-18);
        assert_eq!(axis.times[0], -0.05_f32);
        assert!((f64::from(axis.times[499]) - 0.0498).abs() < 1.0e-7);

        // Off-center trigger: t = 0 sits wherever the file puts it —
        // here between samples 3850 and 3851 (~40% into the window).
        let block = param_block_with_axis(-3.996, 6.004);
        let axis = decode_time_axis(&block, 0, 9_636, "Input A").expect("off-center decodes");
        assert!((axis.delta_t - 10.0 / 9_636.0).abs() < 1.0e-18);
        assert_eq!(axis.times[0], -3.996_f32);
        assert!(axis.times[3_850] < 0.0 && 0.0 < axis.times[3_851]);

        // Odd sample counts step uniformly from the left edge.
        let block = param_block_with_axis(-5.0, 5.0);
        let axis = decode_time_axis(&block, 0, 5, "Input A").expect("odd count decodes");
        assert_eq!(axis.delta_t, 2.0);
        assert_eq!(axis.times, [-5.0, -3.0, -1.0, 1.0, 3.0]);
    }

    #[test]
    fn stored_time_axis_rejects_invalid_edges_typed() {
        for (t_left, t_right, samples, hint) in [
            (0.0, 0.0, 10_000, "zeroed edges"),
            (0.05, -0.05, 10_000, "inverted edges"),
            (f64::NAN, 0.05, 10_000, "NaN left"),
            (-0.05, f64::INFINITY, 10_000, "infinite right"),
            (-0.05, 0.05, 0, "zero samples"),
        ] {
            let block = param_block_with_axis(t_left, t_right);
            let error = decode_time_axis(&block, 0, samples, "Input A").expect_err(hint);
            assert_eq!(error.code(), "invalid_time_axis", "{hint}");
        }
    }

    #[test]
    fn decode_walks_the_unaligned_de_fixture() {
        let decoded = decode_capture(&de_fixture()).expect("DE fixture decodes");
        assert_eq!(decoded.channels.len(), 1);
        assert!(decoded.derived_channels.is_empty());
        assert_eq!(decoded.channels[0].letter, b'A');
        assert_eq!(decoded.channels[0].samples, 3_000);
        assert_eq!(decoded.timebase_raw, "0,1 s/Div");
        assert!((decoded.seconds_per_div - 0.1).abs() < 1.0e-12);
        assert_eq!(decoded.timestamp14, "12000020260101");
        assert!(decoded.warnings.is_empty());
        assert_eq!(decoded.channels[0].values.len(), 3_000);
        assert_eq!(decoded.channels[0].raw_counts.len(), 3_000);
        assert_eq!(decoded.channels[0].saturated_sample_count, 0);
    }

    #[test]
    fn physical_channels_expose_vertical_metadata() {
        let decoded = decode_capture(&fixture_bytes("accepted-en-4ch-10000-10ms-div.fvf.bin"))
            .expect("4ch fixture decodes");
        assert_eq!(decoded.channels.len(), 4);
        for channel in &decoded.channels {
            assert_eq!(channel.unit, "V");
            assert_eq!(channel.unit_family, 3);
            assert_eq!((channel.window_min, channel.window_max), (-800.0, 800.0));
            assert_eq!(channel.scale, 0.0625);
            assert_eq!(channel.per_div, 200.0);
        }
        assert!(decoded.warnings.is_empty());

        let mixed = decode_capture(&fixture_bytes(
            "accepted-en-2ch-current-offcenter-1s-div.fvf.bin",
        ))
        .expect("mixed-unit fixture decodes");
        let (a, b) = (&mixed.channels[0], &mixed.channels[1]);
        assert_eq!((a.unit.as_str(), a.unit_family), ("A", 10));
        assert_eq!((a.window_min, a.window_max), (-250.0, 150.0));
        assert_eq!(a.scale, 0.015_625);
        assert_eq!(a.per_div, 50.0);
        assert_eq!((b.unit.as_str(), b.unit_family), ("mA", 10));
        assert_eq!((b.window_min, b.window_max), (-0.3, 0.5));
        assert_eq!(b.scale, 0.000_031_25);
        assert!((b.per_div - 0.1).abs() < 1.0e-12);
        assert!(mixed.warnings.is_empty());
    }

    #[test]
    fn derived_records_expose_metadata_without_validation() {
        let decoded = decode_capture(&derived_fixture()).expect("derived fixture decodes");
        let derived = &decoded.derived_channels[0];
        assert_eq!(derived.unit, "V");
        assert_eq!(derived.unit_family, 3);
        assert_eq!((derived.window_min, derived.window_max), (-800.0, 800.0));
        assert_eq!(derived.scale, 0.0625);
        assert_eq!(derived.per_div, 200.0);
        assert_eq!(derived.saturated_sample_count, 0);
        // The legacy estimate always carries its typed warning.
        assert!(matches!(
            decoded.warnings.as_slice(),
            [ParseWarning::DerivedLegacyValues { .. }]
        ));
    }

    /// Mutates one metadata slot of one record of a fixture copy
    /// and returns the resulting warnings.
    fn metadata_warnings_after(
        name: &str,
        record: usize,
        slot: usize,
        bytes: &[u8],
    ) -> Vec<ParseWarning> {
        let mut data = fixture_bytes(name);
        let table = locate_sector_table(&data).expect("table");
        let sectors = walk_sectors(&data, &table).expect("walk");
        let at = sectors[record].param_start + slot;
        data[at..at + bytes.len()].copy_from_slice(bytes);
        decode_capture(&data)
            .expect("metadata mutations never fail the decode")
            .warnings
    }

    fn mismatch_warnings(warnings: &[ParseWarning]) -> Vec<&str> {
        warnings
            .iter()
            .filter_map(|warning| match warning {
                ParseWarning::VerticalMetadataMismatch { detail, .. } => Some(detail.as_str()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn scale_duplicate_mismatch_warns_typed() {
        let warnings = metadata_warnings_after(
            "accepted-en-4ch-10000-10ms-div.fvf.bin",
            0,
            344,
            &0.0626_f64.to_le_bytes(),
        );
        assert_eq!(warnings.len(), 1, "only the dup check fires: {warnings:?}");
        assert_eq!(warnings[0].code(), "vertical_metadata_mismatch");
        assert!(
            mismatch_warnings(&warnings)[0].contains("+344"),
            "detail names the slot: {warnings:?}"
        );
    }

    #[test]
    fn unknown_and_empty_units_parse_through_verbatim_with_a_warning() {
        for (slot_bytes, want_unit) in [(*b"dB\0\0", "dB"), ([0, 0, 0, 0], "")] {
            let mut data = fixture_bytes("accepted-en-4ch-10000-10ms-div.fvf.bin");
            let table = locate_sector_table(&data).expect("table");
            let sectors = walk_sectors(&data, &table).expect("walk");
            let at = sectors[1].param_start + 312;
            data[at..at + 4].copy_from_slice(&slot_bytes);
            let decoded = decode_capture(&data).expect("decode succeeds");
            assert_eq!(decoded.channels[1].unit, want_unit);
            let unit_warnings: Vec<_> = decoded
                .warnings
                .iter()
                .filter(|warning| warning.code() == "unknown_unit")
                .collect();
            assert_eq!(unit_warnings.len(), 1, "{want_unit:?}: {decoded:?}");
            assert!(
                decoded
                    .warnings
                    .iter()
                    .all(|warning| matches!(warning, ParseWarning::UnknownUnit { .. }))
            );
        }
    }

    #[test]
    fn inverted_window_and_non_positive_scale_warn_typed() {
        // Swap the window at both the primary and duplicate slots so
        // only the inversion check fires.
        let mut data = fixture_bytes("accepted-en-4ch-10000-10ms-div.fvf.bin");
        let table = locate_sector_table(&data).expect("table");
        let sectors = walk_sectors(&data, &table).expect("walk");
        let param = sectors[0].param_start;
        for slot in [126, 366] {
            let lo = f64::from_le_bytes(data[param + slot..param + slot + 8].try_into().unwrap());
            let hi = f64::from_le_bytes(
                data[param + slot + 8..param + slot + 16]
                    .try_into()
                    .unwrap(),
            );
            data[param + slot..param + slot + 8].copy_from_slice(&hi.to_le_bytes());
            data[param + slot + 8..param + slot + 16].copy_from_slice(&lo.to_le_bytes());
        }
        let decoded = decode_capture(&data).expect("decode succeeds");
        assert_eq!(
            (
                decoded.channels[0].window_min,
                decoded.channels[0].window_max
            ),
            (800.0, -800.0),
            "verbatim values are still exposed"
        );
        assert_eq!(decoded.warnings.len(), 1, "{:?}", decoded.warnings);
        assert_eq!(decoded.warnings[0].code(), "vertical_metadata_mismatch");

        // Zero scale at +328 only: finite, but inconsistent with the
        // +344 duplicate and not positive.
        let warnings = metadata_warnings_after(
            "accepted-en-4ch-10000-10ms-div.fvf.bin",
            0,
            328,
            &0.0_f64.to_le_bytes(),
        );
        assert_eq!(
            warnings.len(),
            2,
            "dup mismatch plus non-positive: {warnings:?}"
        );
    }

    #[test]
    fn non_finite_window_warns_typed() {
        let mut data = fixture_bytes("accepted-en-4ch-10000-10ms-div.fvf.bin");
        let table = locate_sector_table(&data).expect("table");
        let sectors = walk_sectors(&data, &table).expect("walk");
        let param = sectors[2].param_start;
        for slot in [126, 366] {
            data[param + slot..param + slot + 8].copy_from_slice(&f64::NAN.to_le_bytes());
        }
        let decoded = decode_capture(&data).expect("decode succeeds");
        assert!(decoded.channels[2].window_min.is_nan());
        let details = mismatch_warnings(&decoded.warnings);
        assert_eq!(details.len(), 1, "{:?}", decoded.warnings);
        assert!(details[0].contains("non-finite"));
    }

    #[test]
    fn decode_handles_derived_records_best_effort() {
        let decoded = decode_capture(&derived_fixture()).expect("derived fixture decodes");
        assert_eq!(decoded.channels.len(), 1);
        assert_eq!(decoded.derived_channels.len(), 1);
        let derived = &decoded.derived_channels[0];
        assert_eq!(derived.record_label, "Mathematik A");
        assert_eq!(derived.source_channels, vec![b'A']);
        assert_eq!(derived.samples, Some(3_000));
        assert!(matches!(
            decoded.warnings.as_slice(),
            [ParseWarning::DerivedLegacyValues { .. }]
        ));
        // The synthesizer writes derived raw = source raw + 4096; the
        // physical record decodes as raw x S while the derived record
        // keeps the legacy raw / 65536 estimate, so the relationship is
        // checked in the raw domain. Both conversions are exact at
        // these magnitudes.
        let physical = &decoded.channels[0];
        assert_eq!(derived.raw_counts.len(), 3_000);
        for (index, value) in derived.values.iter().enumerate() {
            let raw = physical.raw_counts[index].wrapping_add(4_096);
            assert_eq!(*value, raw as f32 / 65_536.0, "sample {index}");
            assert_eq!(derived.raw_counts[index], raw, "sample {index}");
        }
        // Physical values prove the new model: raw x S in f64, cast.
        for (value, raw) in physical.values.iter().zip(&physical.raw_counts) {
            assert_eq!(*value, (f64::from(*raw) * physical.scale) as f32);
        }
    }

    #[test]
    fn derived_extent_fallback_survives_a_destroyed_sample_count() {
        let mut bytes = derived_fixture();
        let table = locate_sector_table(&bytes).expect("table");
        let sectors = walk_sectors(&bytes, &table).expect("walk");
        assert!(sectors[1].standard);
        // Corrupt the derived record's sample-count slot: the standard
        // decode must fail and the extent fallback must recover 3,000
        // samples from the marker/trailer extent.
        let slot = sectors[1].param_start + SAMPLE_COUNT_SLOT;
        bytes[slot..slot + 4].copy_from_slice(&0xdead_beef_u32.to_le_bytes());
        let decoded = decode_capture(&bytes).expect("extent decode still succeeds");
        assert_eq!(
            decoded.derived_channels[0].samples,
            Some(3_000),
            "extent fallback recovers the payload"
        );
    }

    /// Pokes three payload words of a fixture copy onto the saturation
    /// rails and returns the re-decoded channel.
    fn channel_with_poked_rails(name: &str, pokes: &[(usize, i32)]) -> DecodedCapture {
        let mut bytes = fixture_bytes(name);
        let table = locate_sector_table(&bytes).expect("table");
        let sectors = walk_sectors(&bytes, &table).expect("walk");
        for (sample, rail) in pokes {
            let at = sectors[0].payload_start + 4 * sample;
            bytes[at..at + 4].copy_from_slice(&rail.to_le_bytes());
        }
        decode_capture(&bytes).expect("rail pokes never fail the decode")
    }

    #[test]
    fn saturated_rails_read_nan_with_a_typed_warning() {
        let decoded = channel_with_poked_rails(
            "accepted-de-eingang-1ch-3000-comma-decimal.fvf.bin",
            &[(7, i32::MAX), (11, i32::MIN), (13, i32::MIN + 2)],
        );
        let channel = &decoded.channels[0];
        assert_eq!(channel.samples, 3_000);
        assert_eq!(channel.raw_counts.len(), 3_000);
        // Verbatim rail counts survive in the raw lane ...
        assert_eq!(channel.raw_counts[7], i32::MAX);
        assert_eq!(channel.raw_counts[11], i32::MIN);
        assert_eq!(channel.raw_counts[13], i32::MIN + 2);
        // ... while the values lane reads NaN at exactly those sites.
        assert!(channel.values[7].is_nan());
        assert!(channel.values[11].is_nan());
        assert!(channel.values[13].is_nan());
        assert_eq!(channel.saturated_sample_count, 3);
        let announcements: Vec<_> = decoded
            .warnings
            .iter()
            .filter(|warning| warning.code() == "saturated_samples")
            .collect();
        assert_eq!(announcements.len(), 1, "{:?}", decoded.warnings);
        let ParseWarning::SaturatedSamples { label, low, high } = announcements[0] else {
            panic!("typed warning shape: {:?}", decoded.warnings);
        };
        assert_eq!(*low, 2);
        assert_eq!(*high, 1);
        assert_eq!(label, "Eingang A");
        // Neighbors still decode as raw x S in f64, cast to f32.
        assert_eq!(
            channel.values[8],
            (f64::from(channel.raw_counts[8]) * channel.scale) as f32
        );
    }

    #[test]
    fn near_rail_counts_still_decode_as_values() {
        // i32::MAX - 1 and i32::MIN + 3 are ordinary counts, not rails.
        let decoded = channel_with_poked_rails(
            "accepted-de-eingang-1ch-3000-comma-decimal.fvf.bin",
            &[(5, i32::MAX - 1), (9, i32::MIN + 3)],
        );
        let channel = &decoded.channels[0];
        assert!(!channel.values[5].is_nan());
        assert!(!channel.values[9].is_nan());
        assert_eq!(
            channel.values[5],
            (f64::from(i32::MAX - 1) * channel.scale) as f32
        );
        assert_eq!(channel.saturated_sample_count, 0);
        assert!(decoded.warnings.is_empty());
    }

    #[test]
    fn corrupt_record_two_trailer_fails_typed() {
        let mut bytes = two_channel_fixture();
        let table = locate_sector_table(&bytes).expect("table");
        let sectors = walk_sectors(&bytes, &table).expect("walk");
        let trailer = sectors[1].trailer_start;
        bytes[trailer + 30..trailer + 39].copy_from_slice(b"XXXXXXXXX");
        let error = decode_capture(&bytes).expect_err("broken trailer must fail");
        assert_eq!(error.code(), "corrupt_sector_table");
    }

    #[test]
    fn missing_plot_tag_breaks_the_synthetic_record_walk() {
        let mut bytes = de_fixture();
        let table = locate_sector_table(&bytes).expect("table");
        let tag = bytes[table.labels_end..]
            .windows(PLOT_FORMAT_TAG.len())
            .position(|window| window == PLOT_FORMAT_TAG)
            .map(|offset| table.labels_end + offset)
            .expect("plot tag present");
        bytes[tag..tag + PLOT_FORMAT_TAG.len()].fill(0);
        let error = decode_capture(&bytes).expect_err("record 1 becomes unlocatable");
        assert_eq!(error.code(), "corrupt_sector_table");
    }

    /// Mutates record 1's stored time-axis slots of a fixture copy and
    /// returns the decode result.
    fn decode_with_axis_mutation(
        name: &str,
        slot: usize,
        bytes: &[u8],
    ) -> Result<DecodedCapture, FvfError> {
        let mut data = fixture_bytes(name);
        let table = locate_sector_table(&data).expect("table");
        let sectors = walk_sectors(&data, &table).expect("walk");
        let at = sectors[0].param_start + slot;
        data[at..at + bytes.len()].copy_from_slice(bytes);
        decode_capture(&data)
    }

    #[test]
    fn invalid_time_axis_fires_typed_on_synthetic_mutations() {
        let name = "accepted-en-4ch-10000-10ms-div.fvf.bin";
        // Zeroed edges: t_right == t_left == 0.
        let mut zeroed = fixture_bytes(name);
        {
            let table = locate_sector_table(&zeroed).expect("table");
            let sectors = walk_sectors(&zeroed, &table).expect("walk");
            let param = sectors[0].param_start;
            zeroed[param + 20..param + 28].copy_from_slice(&[0u8; 8]);
            zeroed[param + 44..param + 52].copy_from_slice(&[0u8; 8]);
        }
        let error = decode_capture(&zeroed).expect_err("zeroed edges must fail");
        assert_eq!(error.code(), "invalid_time_axis");
        // Inverted edges.
        let mut inverted = fixture_bytes(name);
        {
            let table = locate_sector_table(&inverted).expect("table");
            let sectors = walk_sectors(&inverted, &table).expect("walk");
            let param = sectors[0].param_start;
            let left = f64::from_le_bytes(inverted[param + 20..param + 28].try_into().unwrap());
            let right = f64::from_le_bytes(inverted[param + 44..param + 52].try_into().unwrap());
            inverted[param + 20..param + 28].copy_from_slice(&right.to_le_bytes());
            inverted[param + 44..param + 52].copy_from_slice(&left.to_le_bytes());
        }
        let error = decode_capture(&inverted).expect_err("inverted edges must fail");
        assert_eq!(error.code(), "invalid_time_axis");
        // NaN edge.
        let error = decode_with_axis_mutation(name, 20, &f64::NAN.to_le_bytes())
            .expect_err("NaN edge must fail");
        assert_eq!(error.code(), "invalid_time_axis");
        // The untouched fixture still decodes with no axis warnings.
        let decoded = decode_capture(&fixture_bytes(name)).expect("fixture decodes");
        assert!(decoded.warnings.is_empty());
    }

    #[test]
    fn timebase_span_disagreement_warns_typed_not_hard() {
        // Stretch the stored span to twice the timebase-implied span:
        // decode succeeds, values still convert, one typed warning fires.
        let name = "accepted-en-4ch-10000-10ms-div.fvf.bin";
        let mut data = fixture_bytes(name);
        let table = locate_sector_table(&data).expect("table");
        let sectors = walk_sectors(&data, &table).expect("walk");
        let param = sectors[0].param_start;
        let left = f64::from_le_bytes(data[param + 20..param + 28].try_into().unwrap());
        data[param + 44..param + 52].copy_from_slice(&(left + 0.2).to_le_bytes());
        let decoded = decode_capture(&data).expect("span mismatch never fails");
        assert_eq!(decoded.channels[0].values.len(), 10_000);
        let span_warnings: Vec<_> = decoded
            .warnings
            .iter()
            .filter(|warning| warning.code() == "time_axis_span_mismatch")
            .collect();
        assert_eq!(span_warnings.len(), 1, "{:?}", decoded.warnings);
        let ParseWarning::TimeAxisSpanMismatch { label, detail } = span_warnings[0] else {
            panic!("typed warning shape: {:?}", decoded.warnings);
        };
        assert_eq!(label, "Input A");
        assert!(
            detail.contains("stored span") && detail.contains("timebase span"),
            "detail quotes both spans: {detail}"
        );
    }

    #[test]
    fn axis_slot_mutations_never_panic_and_stay_typed() {
        // Every single-byte mutation of record 1's axis slots across
        // the full byte range either decodes or fails typed — the
        // stored-only policy introduces no panic path.
        let name = "extreme-envelope-4ch-500-10ms-div.fvf.bin";
        let bytes = fixture_bytes(name);
        assert!(decode_capture(&bytes).is_ok());
        let table = locate_sector_table(&bytes).expect("table");
        let sectors = walk_sectors(&bytes, &table).expect("walk");
        let param = sectors[0].param_start;
        for slot in [
            20, 21, 22, 23, 24, 25, 26, 27, 44, 45, 46, 47, 48, 49, 50, 51,
        ] {
            for value in 0..=255u8 {
                let mut mutated = bytes.clone();
                mutated[param + slot] = value;
                // Only the axis slots move, so a failure is always the
                // stored-axis error — anything else is a real finding.
                match decode_capture(&mutated) {
                    Ok(_) => {}
                    Err(error) => assert_eq!(
                        error.code(),
                        "invalid_time_axis",
                        "slot {slot} value {value}: typed {error:?}"
                    ),
                }
            }
        }
    }

    #[test]
    fn truncation_never_panics_and_always_reports_typed_errors() {
        let bytes = de_fixture();
        assert!(decode_capture(&bytes).is_ok());
        for length in 0..bytes.len() {
            let error = decode_capture(&bytes[..length])
                .err()
                .unwrap_or_else(|| panic!("truncation at {length} must not parse"));
            assert_eq!(
                error.code(),
                "truncated_capture",
                "at length {length}: {error}"
            );
        }
    }

    #[test]
    fn walk_agrees_with_header_channel_counts() {
        for name in [
            "accepted-en-4ch-10000-10ms-div.fvf.bin",
            "nonsequential-abd-3ch-10000-20ms-div.fvf.bin",
            "extreme-envelope-4ch-500-10ms-div.fvf.bin",
            "extreme-envelope-1ch-250000-10ms-div.fvf.bin",
            "accepted-en-2ch-10000-1min-div.fvf.bin",
        ] {
            let bytes = fixture_bytes(name);
            let header = parse_header(&bytes).expect("header parses");
            let decoded = decode_capture(&bytes).expect("decode");
            assert_eq!(
                decoded.channels.len() + decoded.derived_channels.len(),
                header.channels.len(),
                "{name}"
            );
            assert_eq!(decoded.version, header.version, "{name}");
            assert_eq!(decoded.flavor, header.flavor, "{name}");
        }
    }
}
