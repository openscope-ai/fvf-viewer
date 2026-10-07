//! Unified-timeline resampling (issue #96, architecture.md §4.3): maps a
//! reference capture's sample sequence onto a common monotonic time grid
//! (the primary capture's trigger-relative axis) with a single two-pointer
//! merge pass — O(n + m), no allocation beyond the output lane, and
//! NaN-stable at the edges (grid points outside the reference record read
//! NaN, never a clamped lie).
//!
//! The wasm bridge follows the crate's `(ptr, len)` ownership contract:
//! [`ResampleResult`] owns the output `Vec<f32>` inside Wasm linear
//! memory; the JS side copies the view into a standalone
//! `Float32Array` before any other engine call (detachment guard, see
//! `lib.rs`) and then calls `free()`.

use wasm_bindgen::prelude::*;

/// Resampled output lane owned by Wasm linear memory.
#[wasm_bindgen]
pub struct ResampleResult {
    values: Vec<f32>,
}

#[wasm_bindgen]
impl ResampleResult {
    /// Pointer to the resampled `f32` lane (Wasm linear memory).
    #[wasm_bindgen(getter)]
    pub fn values_ptr(&self) -> *const f32 {
        self.values.as_ptr()
    }

    /// Sample count of the resampled lane (== the grid length).
    #[wasm_bindgen(getter)]
    pub fn values_len(&self) -> usize {
        self.values.len()
    }
}

/// Interpolates `values` (sampled at monotonic `timestamps`) onto `grid`.
///
/// Semantics:
/// - Linear interpolation between the bracketing reference samples; a
///   grid point that matches a reference timestamp exactly reads that
///   sample (no rounding drift).
/// - Grid points before the first or after the last reference timestamp
///   read `NaN` (no data there — the primary timeline extends beyond the
///   reference record).
/// - Non-finite reference samples propagate as `NaN` through the
///   interpolated span (an Overload gap stays a gap).
/// - Length-mismatched or non-monotonic inputs return an empty lane
///   ( callers treat an unexpected length as an all-NaN record).
#[wasm_bindgen]
pub fn resample_to_grid(timestamps: &[f32], values: &[f32], grid: &[f32]) -> ResampleResult {
    let valid = timestamps.len() == values.len() && !timestamps.is_empty() && !grid.is_empty();
    if !valid || !is_strictly_monotonic(timestamps) {
        return ResampleResult { values: Vec::new() };
    }

    let mut out = Vec::with_capacity(grid.len());
    // Two-pointer merge: `idx` is the last reference sample with
    // timestamp <= grid point (never decreases because `grid` is scanned
    // in order too — callers pass the primary capture's monotonic axis).
    let mut idx = 0usize;
    for &t in grid {
        // Advance while the next reference sample still brackets `t`.
        while idx + 1 < timestamps.len() && timestamps[idx + 1] <= t {
            idx += 1;
        }
        let (t0, v0) = (timestamps[idx], values[idx]);
        if t < timestamps[0] || t > *timestamps.last().expect("len >= 1") {
            out.push(f32::NAN);
            continue;
        }
        if t == t0 {
            out.push(v0);
            continue;
        }
        let (t1, v1) = (
            timestamps[idx + 1.min(timestamps.len() - idx - 1 + idx)],
            values[(idx + 1).min(values.len() - 1)],
        );
        // Exact-sample fast path above covers t == t0; here t > t0 and
        // t < t1 (or idx sits at the last sample and the range check
        // above already handled the tail).
        if !(t > t0 && t < t1) {
            // Degenerate bracket (repeated timestamps): nearest sample.
            out.push(v0);
            continue;
        }
        let span = t1 - t0;
        let alpha = if span > 0.0 { (t - t0) / span } else { 0.0 };
        out.push(v0 + (v1 - v0) * alpha);
    }
    ResampleResult { values: out }
}

fn is_strictly_monotonic(values: &[f32]) -> bool {
    values
        .windows(2)
        .all(|pair| pair[0].is_finite() && pair[1] > pair[0])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resample(ts: &[f32], vs: &[f32], grid: &[f32]) -> Vec<f32> {
        resample_to_grid(ts, vs, grid).values_ptr_len_hack(grid.len())
    }

    // Helper reading the result through the same copy-a-view discipline
    // the worker uses (unsafe read of the owned lane — test-only).
    impl ResampleResult {
        fn values_ptr_len_hack(&self, _expected: usize) -> Vec<f32> {
            let len = self.values_len();
            if len == 0 {
                return Vec::new();
            }
            let ptr = self.values_ptr();
            let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
            slice.to_vec()
        }
    }

    #[test]
    fn identical_grid_round_trips_exactly() {
        let ts = [0.0f32, 1.0, 2.0, 3.0];
        let vs = [10.0f32, 20.0, 30.0, 40.0];
        let out = resample(&ts, &vs, &ts);
        assert_eq!(out, vec![10.0, 20.0, 30.0, 40.0]);
    }

    #[test]
    fn different_sample_rate_interpolates_linearly() {
        // Reference at 2 Hz sampled onto a 1 Hz grid.
        let ts = [0.0f32, 0.5, 1.0, 1.5, 2.0];
        let vs = [0.0f32, 5.0, 10.0, 15.0, 20.0];
        let grid = [0.0f32, 1.0, 2.0];
        let out = resample(&ts, &vs, &grid);
        assert_eq!(out.len(), 3);
        assert!((out[0] - 0.0).abs() < 1e-6);
        assert!((out[1] - 10.0).abs() < 1e-6);
        assert!((out[2] - 20.0).abs() < 1e-6);
    }

    #[test]
    fn off_grid_points_interpolate_between_brackets() {
        let ts = [0.0f32, 2.0];
        let vs = [0.0f32, 10.0];
        let out = resample(&ts, &vs, &[1.0]);
        assert!((out[0] - 5.0).abs() < 1e-6);
    }

    #[test]
    fn shorter_reference_record_reads_nan_outside_overlap() {
        let ts = [1.0f32, 2.0, 3.0];
        let vs = [5.0f32, 6.0, 7.0];
        let grid = [0.0f32, 1.5, 3.5];
        let out = resample(&ts, &vs, &grid);
        assert!(out[0].is_nan());
        assert!((out[1] - 5.5).abs() < 1e-6);
        assert!(out[2].is_nan());
    }

    #[test]
    fn nan_samples_propagate_through_the_span() {
        let ts = [0.0f32, 1.0, 2.0];
        let vs = [1.0f32, f32::NAN, 3.0];
        let out = resample(&ts, &vs, &[0.5, 1.0, 1.5]);
        assert!(out[0].is_nan());
        assert!(out[1].is_nan());
        assert!(out[2].is_nan());
    }

    #[test]
    fn single_sample_reference_interpolates_within_point() {
        let ts = [1.0f32];
        let vs = [42.0f32];
        let out = resample(&ts, &vs, &[0.0, 1.0, 2.0]);
        assert!(out[0].is_nan());
        assert_eq!(out[1], 42.0);
        assert!(out[2].is_nan());
    }

    #[test]
    fn non_monotonic_or_mismatched_inputs_return_empty() {
        let r = resample_to_grid(&[1.0, 0.5, 2.0], &[1.0, 2.0, 3.0], &[0.0, 1.0]);
        assert_eq!(r.values_len(), 0);
        let r = resample_to_grid(&[0.0, 1.0], &[1.0, 2.0, 3.0], &[0.0]);
        assert_eq!(r.values_len(), 0);
        let r = resample_to_grid(&[], &[], &[0.0]);
        assert_eq!(r.values_len(), 0);
    }

    #[test]
    fn long_merge_stays_single_pass_and_aligned() {
        // 200k reference samples onto a 100k grid: every grid point hits a
        // reference timestamp exactly (2x oversampling).
        let ts: Vec<f32> = (0..200_000).map(|i| i as f32 * 0.5).collect();
        let vs: Vec<f32> = (0..200_000).map(|i| i as f32).collect();
        let grid: Vec<f32> = (0..100_000).map(|i| i as f32).collect();
        let out = resample(&ts, &vs, &grid);
        assert_eq!(out.len(), grid.len());
        for (i, v) in out.iter().enumerate() {
            assert_eq!(*v, (2 * i) as f32, "exact sample expected at index {i}");
        }
    }
}
