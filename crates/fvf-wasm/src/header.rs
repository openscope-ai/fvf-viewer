//! Capture header parsing: signature verification, version check, variant
//! detection, and descriptor-table walk (issue #6).
//!
//! Dialect notes (reconciled empirically against the local corpus —
//! see `tests/fixtures/README.md`, "Sector table reconciliation"):
//!
//! - The prologue is the full 8-byte magic `FV.FVF\x1a\x00`; `u16` version
//!   word at offset 8 (v1 supported).
//! - `u32` at `0x1C` is the root pointer; it targets the variant tag
//!   (`CUR_` waveform, `FV.FVS` settings). Firmware flavors shift the
//!   reserved regions by ±12 bytes, so all structure location goes through
//!   pointers and validated grammar scans, never fixed absolute offsets.
//! - `u32` at `0x40` anchors the descriptor ("sector table") region. Two
//!   layouts are accepted, both validated in full before use:
//!   **empirical** — `(N-1)` 16-byte entries `[u16 1][u16 k][u32 1]
//!   [u16 0][u16 2][u32 trailer_k+23]`, a `[u16 1][u16 N][u16 N]`
//!   terminal marker, then N 18-byte label slots
//!   `[12-byte label][u16 k][u32 ptr]`;
//!   **synthetic mirror (ADR 0006)** — 14-byte entries
//!   `[u16 k][u32 label_pos][u16 2][u32 1][u16 0]`, a 14-byte tail block
//!   starting with `u16 0`, and zero-padded 18-byte label slots.
//!
//! Every read is bounds-checked (`TruncatedCapture`); there is no `unsafe`
//! and no unaligned dereferencing — all multi-byte reads go through
//! `byteorder::LittleEndian`.

use byteorder::{ByteOrder, LittleEndian};

use crate::error::{FvfError, ParseWarning};
use crate::types::{ChannelDescriptor, ChannelKind, DescriptorFlavor, ParsedHeader};

/// The complete 8-byte prologue: ASCII `FV.FVF` + `u16 26` (0x1A 0x00).
pub const SIGNATURE: [u8; 8] = *b"FV.FVF\x1a\x00";

const CUR_FORMAT_TAG: [u8; 4] = *b"CUR_";
const DERIVED_PREFIX: &[u8] = b"Math";
const PHYSICAL_PREFIXES: [&[u8]; 2] = [b"Input ", b"Eingang "];
const ROOT_POINTER_OFFSET: usize = 0x1C;
const DESCRIPTOR_POINTER_OFFSET: usize = 0x40;
/// Physical channels are A..D; the corpus derived-math capture adds one derived record (5 total).
const MAX_DESCRIPTORS: usize = 8;
const LABEL_FIELD_LEN: usize = 12;
const LABEL_SLOT_LEN: usize = 18;
const EMPIRICAL_ENTRY_LEN: usize = 16;
const LEGACY_ENTRY_LEN: usize = 14;
const DESC_TAIL_LEN: usize = 14;
const TERMINAL_MARKER_LEN: usize = 6;
/// Largest observed descriptor-anchor → label-block distance is 42 bytes;
/// the scan window stays small and fully validated.
const EMPIRICAL_SCAN_LIMIT: usize = 48;

fn need(data: &[u8], end: usize) -> Result<(), FvfError> {
    if end > data.len() {
        return Err(FvfError::TruncatedCapture {
            needed: end,
            available: data.len(),
        });
    }
    Ok(())
}

/// Bounds-checked little-endian readers shared with `records.rs`.
pub(crate) fn read_u16(data: &[u8], at: usize) -> Result<u16, FvfError> {
    need(data, at + 2)?;
    Ok(LittleEndian::read_u16(&data[at..at + 2]))
}

pub(crate) fn read_u32(data: &[u8], at: usize) -> Result<u32, FvfError> {
    need(data, at + 4)?;
    Ok(LittleEndian::read_u32(&data[at..at + 4]))
}

pub(crate) fn read_f64(data: &[u8], at: usize) -> Result<f64, FvfError> {
    need(data, at + 8)?;
    Ok(LittleEndian::read_f64(&data[at..at + 8]))
}

pub(crate) fn read_tag(data: &[u8], at: usize, len: usize) -> Result<&[u8], FvfError> {
    need(data, at + len)?;
    Ok(&data[at..at + len])
}

/// Label bytes are printable ASCII including the space between a tag
/// prefix and its channel letter.
fn is_label_byte(byte: u8) -> bool {
    byte.is_ascii_graphic() || byte == b' '
}

/// Verifies the complete 8-byte prologue. Fewer than 8 bytes is a
/// `TruncatedCapture` (the detected-magic payload needs all 8 bytes);
/// any mismatch reports all 8 detected bytes.
pub fn verify_signature(data: &[u8]) -> Result<(), FvfError> {
    need(data, 8)?;
    let mut detected = [0u8; 8];
    detected.copy_from_slice(&data[..8]);
    if detected != SIGNATURE {
        return Err(FvfError::InvalidSignature { detected });
    }
    Ok(())
}

/// The walked sector table plus the per-record locating pointers the
/// record decoder (issue #8) chains from: raw table labels in sector
/// order, the dialect that matched, the empirical label-slot pointers,
/// and (synthetic dialect) the end of the label-slot block.
#[derive(Debug, Clone, PartialEq)]
pub struct SectorTable {
    pub version: u16,
    pub flavor: DescriptorFlavor,
    pub labels: Vec<String>,
    /// Empirical dialect: one in-bounds pointer per label slot; record
    /// k's parameter block starts at `slot_pointers[k-1] - 112` (verified
    /// across the corpus; derived records deviate by +4, which the
    /// extent-based derived decode tolerates).
    pub slot_pointers: Vec<usize>,
    /// Synthetic dialect: first byte past the last label slot; the
    /// plot-format tag scan for record 1 starts there. `0` otherwise.
    pub labels_end: usize,
}

/// Prologue + descriptor walk: signature, version, variant tag, and the
/// fully validated sector table with its raw labels and pointers.
pub fn locate_sector_table(data: &[u8]) -> Result<SectorTable, FvfError> {
    verify_signature(data)?;
    let version = read_u16(data, 8)?;
    if version != 1 {
        return Err(FvfError::UnsupportedCaptureVersion { version });
    }
    let root = read_u32(data, ROOT_POINTER_OFFSET)? as usize;
    let tag = read_tag(data, root, 6)?;
    if tag[..4] != CUR_FORMAT_TAG {
        let mut detected_tag = [0u8; 6];
        detected_tag.copy_from_slice(tag);
        return Err(FvfError::UnsupportedCaptureVariant { detected_tag });
    }
    let anchor = read_u32(data, DESCRIPTOR_POINTER_OFFSET)? as usize;
    let (labels, flavor, slot_pointers, labels_end) = walk_descriptors(data, anchor)?;
    Ok(SectorTable {
        version,
        flavor,
        labels,
        slot_pointers,
        labels_end,
    })
}

/// Parses the capture header: signature, version, variant tag, descriptor
/// walk, and ADR 0007 tag classification. Channel letters always come from
/// the descriptor labels, never from table index order.
pub fn parse_header(data: &[u8]) -> Result<ParsedHeader, FvfError> {
    let table = locate_sector_table(data)?;
    let mut warnings = Vec::new();
    let mut channels = Vec::new();
    for label in table.labels {
        classify_channel(label, &mut channels, &mut warnings);
    }
    Ok(ParsedHeader {
        version: table.version,
        flavor: table.flavor,
        channels,
        warnings,
    })
}

type WalkedDescriptors = (Vec<String>, DescriptorFlavor, Vec<usize>, usize);

fn walk_descriptors(data: &[u8], anchor: usize) -> Result<WalkedDescriptors, FvfError> {
    if let Some((labels, pointers)) = scan_empirical(data, anchor) {
        return Ok((labels, DescriptorFlavor::Empirical, pointers, 0));
    }
    let (labels, labels_end) = walk_legacy(data, anchor)?;
    Ok((labels, DescriptorFlavor::Synthetic, Vec::new(), labels_end))
}

/// Validated grammar scan for the empirical descriptor layout. Returns
/// `None` (never errors) when a candidate position fails validation so the
/// scan can advance; out-of-bounds candidate reads also count as failures.
/// The per-label slot pointers are returned alongside the labels for the
/// record walk (issue #8).
fn scan_empirical(data: &[u8], anchor: usize) -> Option<(Vec<String>, Vec<usize>)> {
    for offset in 0..=EMPIRICAL_SCAN_LIMIT {
        if let Some(walked) = try_empirical_at(data, anchor + offset) {
            return Some(walked);
        }
    }
    None
}

fn try_empirical_at(data: &[u8], terminal: usize) -> Option<(Vec<String>, Vec<usize>)> {
    if read_u16(data, terminal).ok()? != 1 {
        return None;
    }
    let count = read_u16(data, terminal + 2).ok()?;
    if read_u16(data, terminal + 4).ok()? != count {
        return None;
    }
    if count == 0 || count as usize > MAX_DESCRIPTORS {
        return None;
    }
    let count = count as usize;
    for index in 1..count {
        let entry = terminal.checked_sub((count - index) * EMPIRICAL_ENTRY_LEN)?;
        if read_u16(data, entry).ok()? != 1
            || read_u16(data, entry + 2).ok()? != index as u16
            || read_u32(data, entry + 4).ok()? != 1
            || read_u16(data, entry + 8).ok()? != 0
            || read_u16(data, entry + 10).ok()? != 2
        {
            return None;
        }
        let pointer = read_u32(data, entry + 12).ok()? as usize;
        if pointer >= data.len() {
            return None;
        }
    }
    let mut labels = Vec::with_capacity(count);
    let mut pointers = Vec::with_capacity(count);
    let base = terminal + TERMINAL_MARKER_LEN;
    for index in 1..=count {
        let slot = base + (index - 1) * LABEL_SLOT_LEN;
        let field = read_tag(data, slot, LABEL_FIELD_LEN).ok()?;
        if !field.iter().all(|byte| *byte == 0 || is_label_byte(*byte)) || field[0] == 0 {
            return None;
        }
        if read_u16(data, slot + LABEL_FIELD_LEN).ok()? != index as u16 {
            return None;
        }
        let pointer = read_u32(data, slot + LABEL_FIELD_LEN + 2).ok()? as usize;
        if pointer >= data.len() {
            return None;
        }
        let end = field
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(LABEL_FIELD_LEN);
        labels.push(String::from_utf8_lossy(&field[..end]).into_owned());
        pointers.push(pointer);
    }
    Some((labels, pointers))
}

/// Synthetic-mirror descriptor layout (ADR 0006): 14-byte entries with
/// explicit label pointers, a zero-slotted tail block, and zero-padded
/// 18-byte label slots. Returns the labels plus the first byte past the
/// label-slot block (the record-1 scan anchor for issue #8).
fn walk_legacy(data: &[u8], anchor: usize) -> Result<(Vec<String>, usize), FvfError> {
    let mut labels = Vec::new();
    let mut cursor = anchor;
    while labels.len() < MAX_DESCRIPTORS {
        let slot = read_u16(data, cursor)?;
        if slot as usize != labels.len() + 1 {
            break;
        }
        let label_pos = read_u32(data, cursor + 2)? as usize;
        if read_u16(data, cursor + 6)? != 2 || read_u32(data, cursor + 8)? != 1 {
            return Err(FvfError::OpaqueHeader);
        }
        labels.push(read_legacy_label(data, label_pos)?);
        cursor += LEGACY_ENTRY_LEN;
    }
    if labels.is_empty() || read_u16(data, cursor)? != 0 {
        return Err(FvfError::OpaqueHeader);
    }
    let labels_end = cursor + DESC_TAIL_LEN + LABEL_SLOT_LEN * labels.len();
    need(data, labels_end)?;
    Ok((labels, labels_end))
}

fn read_legacy_label(data: &[u8], at: usize) -> Result<String, FvfError> {
    let slot = read_tag(data, at, LABEL_SLOT_LEN)?;
    let end = slot
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(LABEL_SLOT_LEN);
    if end == 0 || !slot[..end].iter().all(|byte| is_label_byte(*byte)) {
        return Err(FvfError::OpaqueHeader);
    }
    Ok(String::from_utf8_lossy(&slot[..end]).into_owned())
}

/// ADR 0007 total tag classification:
/// known physical prefixes → physical A–D (label preserved); known derived
/// prefixes → derived channel; unknown prefix ending in ` [A-D]` → physical
/// with a typed warning; anything else → inventoried and skipped; duplicate
/// letters → first occurrence wins with a warning. Shared by `parse_header`
/// and the record decoder (issue #8); each call pushes at most one
/// descriptor into `channels`.
pub(crate) fn classify_channel(
    label: String,
    channels: &mut Vec<ChannelDescriptor>,
    warnings: &mut Vec<ParseWarning>,
) {
    let bytes = label.as_bytes();
    if bytes.starts_with(DERIVED_PREFIX) {
        channels.push(ChannelDescriptor {
            label,
            letter: None,
            kind: ChannelKind::Derived,
        });
        return;
    }
    if let Some(letter) = physical_letter(bytes) {
        push_channel(
            label,
            Some(letter),
            ChannelKind::Physical,
            channels,
            warnings,
        );
        return;
    }
    if let Some(letter) = bracketed_letter(bytes) {
        warnings.push(ParseWarning::UnknownTagPrefix {
            label: label.clone(),
            letter,
        });
        push_channel(
            label,
            Some(letter),
            ChannelKind::Physical,
            channels,
            warnings,
        );
        return;
    }
    warnings.push(ParseWarning::UnclassifiedTag { label });
}

fn physical_letter(bytes: &[u8]) -> Option<u8> {
    for prefix in PHYSICAL_PREFIXES {
        if bytes.len() == prefix.len() + 1 && bytes.starts_with(prefix) {
            let letter = bytes[bytes.len() - 1];
            if (b'A'..=b'D').contains(&letter) {
                return Some(letter);
            }
        }
    }
    None
}

fn bracketed_letter(bytes: &[u8]) -> Option<u8> {
    if bytes.len() < 5 {
        return None;
    }
    let suffix = &bytes[bytes.len() - 4..];
    if suffix[0] == b' '
        && suffix[1] == b'['
        && suffix[3] == b']'
        && (b'A'..=b'D').contains(&suffix[2])
    {
        Some(suffix[2])
    } else {
        None
    }
}

fn push_channel(
    label: String,
    letter: Option<u8>,
    kind: ChannelKind,
    channels: &mut Vec<ChannelDescriptor>,
    warnings: &mut Vec<ParseWarning>,
) {
    if let Some(letter) = letter
        && channels
            .iter()
            .any(|channel| channel.kind == ChannelKind::Physical && channel.letter == Some(letter))
    {
        warnings.push(ParseWarning::DuplicateChannel {
            letter,
            ignored_label: label,
        });
        return;
    }
    channels.push(ChannelDescriptor {
        label,
        letter,
        kind,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    fn smallest_accepted_fixture() -> Vec<u8> {
        fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR")).join(
                "tests/fixtures/synthetic/accepted-de-eingang-1ch-3000-comma-decimal.fvf.bin",
            ),
        )
        .expect("committed synthetic fixture is present")
    }

    #[test]
    fn signature_accepts_exact_prologue() {
        assert_eq!(verify_signature(&SIGNATURE), Ok(()));
    }

    #[test]
    fn signature_reports_all_eight_detected_bytes() {
        let mut bytes = SIGNATURE;
        bytes[..6].copy_from_slice(b"XX.XVF");
        assert_eq!(
            verify_signature(&bytes),
            Err(FvfError::InvalidSignature {
                detected: *b"XX.XVF\x1a\x00"
            })
        );
        assert_eq!(
            FvfError::InvalidSignature { detected: bytes }.code(),
            "invalid_signature"
        );
    }

    #[test]
    fn short_inputs_report_truncation_not_panics() {
        for length in 0..8 {
            assert_eq!(
                verify_signature(&SIGNATURE[..length]),
                Err(FvfError::TruncatedCapture {
                    needed: 8,
                    available: length
                })
            );
        }
    }

    #[test]
    fn version_two_is_typed_rejection() {
        let mut bytes = SIGNATURE.to_vec();
        bytes.extend_from_slice(&2u16.to_le_bytes());
        assert_eq!(
            parse_header(&bytes),
            Err(FvfError::UnsupportedCaptureVersion { version: 2 })
        );
    }

    #[test]
    fn truncated_descriptors_fail_typed_without_panicking() {
        let fixture = smallest_accepted_fixture();
        assert!(parse_header(&fixture).is_ok());
        for length in 0..206 {
            let error =
                parse_header(&fixture[..length]).expect_err("truncated input must not parse");
            assert_eq!(error.code(), "truncated_capture", "at length {length}");
        }
        assert!(parse_header(&fixture[..206]).is_ok());
    }
}
