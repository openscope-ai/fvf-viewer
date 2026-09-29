//! Q16.16 fixed-point decoding (issue #8).
//!
//! Raw waveform samples are 32-bit signed little-endian Q16.16 values
//! (architecture.md §3.1). The scalar baseline converts each sample as
//! `(raw as f32) / 65536.0`: the `i32 → f32` conversion is correctly
//! rounded, and the division by the exact power of two `2^16` changes no
//! mantissa bits, so the result is deterministic and platform-independent.
//!
//! The SIMD128 batch path (wasm32 `v128` lanes, four samples per vector)
//! is bit-identical *by construction*: `f32x4_convert_i32x4` performs the
//! same correctly-rounded `i32 → f32` conversion per lane, and multiplying
//! by the exact reciprocal `2^-16` is bit-identical to dividing by `2^16`
//! (both are pure exponent adjustments). It is compiled only when the
//! crate feature `simd128` is enabled on a `wasm32` target; every other
//! configuration dispatches to the scalar baseline. The bit-identity
//! parity test therefore runs wherever v128 is executable (the wasm32
//! conformance suite, issue #9); the default build stays free of `unsafe`.
//!
//! All reads go through `byteorder::LittleEndian` over bounds-checked
//! slices — payloads frequently start at unaligned offsets (689, 827, 830
//! in the corpus) and are never dereferenced as typed pointers.

use byteorder::{ByteOrder, LittleEndian};

/// Fractional bit count of the Q16.16 sample encoding.
pub const FRACTIONAL_BITS: u32 = 16;
/// The divisor `2^16` (exact power of two, mantissa-preserving).
pub const SCALE: f32 = 65_536.0;
/// Samples converted per SIMD128 vector lane group.
pub const SIMD_LANES: usize = 4;

/// Converts one raw Q16.16 sample to normalized f32.
#[inline]
pub fn q16_16_to_f32(raw: i32) -> f32 {
    (raw as f32) / SCALE
}

/// Scalar baseline: appends the converted samples of a 4·N-byte payload.
pub fn decode_q16_16_le_scalar(payload: &[u8], out: &mut Vec<f32>) {
    out.reserve(payload.len() / 4);
    for word in payload.as_chunks::<4>().0 {
        out.push(q16_16_to_f32(LittleEndian::read_i32(word)));
    }
}

/// SIMD128 batch conversion (wasm32 + `simd128` feature only): four
/// little-endian i32 samples per vector, exact `2^-16` scaling. The tail
/// (fewer than 16 remaining bytes worth of whole samples) falls back to
/// the scalar baseline so odd sample counts stay bit-identical.
///
/// The single `unsafe` block is the `v128_load`: `chunks_exact(16)`
/// bounds-checks the slice, and wasm `v128.load` has no alignment
/// requirement, so unaligned payload offsets are safe on that target.
/// The default (non-simd128) build contains no `unsafe` code.
#[cfg(all(feature = "simd128", target_arch = "wasm32"))]
pub fn decode_q16_16_le_simd128(payload: &[u8], out: &mut Vec<f32>) {
    use core::arch::wasm32::v128_load;
    use core::arch::wasm32::{f32x4_convert_i32x4, f32x4_extract_lane, f32x4_mul, f32x4_splat};

    out.reserve(payload.len() / 4);
    let scale = f32x4_splat(1.0 / SCALE);
    for chunk in payload.chunks_exact(SIMD_LANES * 4) {
        // SAFETY: `chunk` is a bounds-checked 16-byte slice; wasm v128
        // loads tolerate unaligned addresses.
        let raw = unsafe { v128_load(chunk.as_ptr().cast()) };
        let scaled = f32x4_mul(f32x4_convert_i32x4(raw), scale);
        for lane in 0..SIMD_LANES {
            out.push(match lane {
                0 => f32x4_extract_lane::<0>(scaled),
                1 => f32x4_extract_lane::<1>(scaled),
                2 => f32x4_extract_lane::<2>(scaled),
                _ => f32x4_extract_lane::<3>(scaled),
            });
        }
    }
    decode_q16_16_le_scalar(payload.chunks_exact(SIMD_LANES * 4).remainder(), out);
}

/// Appends the converted samples using the fastest enabled path: the
/// SIMD128 lanes on `wasm32` with the `simd128` feature, the scalar
/// baseline everywhere else.
pub fn append_q16_16_le(payload: &[u8], out: &mut Vec<f32>) {
    #[cfg(all(feature = "simd128", target_arch = "wasm32"))]
    {
        decode_q16_16_le_simd128(payload, out);
    }
    #[cfg(not(all(feature = "simd128", target_arch = "wasm32")))]
    {
        decode_q16_16_le_scalar(payload, out);
    }
}

/// Converts a 4·N-byte Q16.16 payload into owned f32 samples.
pub fn decode_q16_16_le(payload: &[u8]) -> Vec<f32> {
    let mut out = Vec::with_capacity(payload.len() / 4);
    append_q16_16_le(payload, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lcg32_next(state: &mut u32) -> u32 {
        *state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        *state
    }

    #[test]
    fn known_conversions_are_exact_powers_of_two_scalings() {
        assert_eq!(q16_16_to_f32(0), 0.0);
        assert_eq!(q16_16_to_f32(65_536), 1.0);
        assert_eq!(q16_16_to_f32(-65_536), -1.0);
        assert_eq!(q16_16_to_f32(4_096), 0.0625);
        assert_eq!(q16_16_to_f32(1), 1.0 / 65_536.0);
        assert_eq!(q16_16_to_f32(i32::MAX), 32_767.99998474121);
        assert_eq!(q16_16_to_f32(i32::MIN), -32_768.0);
    }

    #[test]
    fn scalar_batch_matches_single_sample_conversions() {
        let mut state = 0xDEAD_BEEF_u32;
        let raws: Vec<i32> = (0..1_024).map(|_| lcg32_next(&mut state) as i32).collect();
        let mut payload = Vec::with_capacity(raws.len() * 4);
        for raw in &raws {
            payload.extend_from_slice(&raw.to_le_bytes());
        }
        let decoded = decode_q16_16_le(&payload);
        assert_eq!(decoded.len(), raws.len());
        for (decoded, raw) in decoded.iter().zip(&raws) {
            assert_eq!(*decoded, q16_16_to_f32(*raw));
        }
    }

    #[test]
    fn unaligned_offsets_and_short_tails_never_panic() {
        let payload: Vec<u8> = (0u8..67).map(|byte| byte.wrapping_mul(31)).collect();
        for offset in 0..4 {
            for len in (0..payload.len() - offset).step_by(3) {
                // Truncated tails are the caller's contract (payloads are
                // always whole-sample multiples); exercising them here only
                // proves byte-order reads never panic on odd lengths.
                let _ = decode_q16_16_le(&payload[offset..offset + len]);
            }
        }
    }

    #[test]
    fn division_by_scale_equals_exact_reciprocal_multiplication() {
        let mut state = 7_u32;
        for _ in 0..512 {
            let raw = lcg32_next(&mut state) as i32;
            assert_eq!(q16_16_to_f32(raw), raw as f32 * (1.0 / SCALE));
        }
    }

    /// Scalar/SIMD bit-identity, executed wherever v128 is available
    /// (wasm32 with the `simd128` feature; see the module docs — the
    /// wasm32 leg of the acceptance runs in issue #9's conformance suite).
    #[cfg(all(feature = "simd128", target_arch = "wasm32"))]
    #[test]
    fn simd128_batch_is_bit_identical_to_scalar() {
        let mut state = 0x0123_4567_u32;
        let raws: Vec<i32> = (0..1_001).map(|_| lcg32_next(&mut state) as i32).collect();
        let mut payload = Vec::with_capacity(raws.len() * 4);
        for raw in &raws {
            payload.extend_from_slice(&raw.to_le_bytes());
        }
        // Whole vectors plus an odd tail (1_001 samples = 62 vectors + 13).
        let mut scalar = Vec::new();
        decode_q16_16_le_scalar(&payload, &mut scalar);
        let mut simd = Vec::new();
        decode_q16_16_le_simd128(&payload, &mut simd);
        assert_eq!(scalar, simd);
        assert_eq!(scalar.len(), 1_001);
    }
}
