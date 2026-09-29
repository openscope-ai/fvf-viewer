//! Shipped sample asset gates (issue #193): the demo capture committed at
//! `apps/web/public/samples/fvf-sample.fvf.bin` must be byte-identical to
//! `synth --sample` regeneration (no hand-edited drift), and it must decode
//! as a clean four-channel showcase capture — the properties the homepage
//! "Try a sample capture" action depends on.

// The shared example module is compiled per test crate; this one consumes
// only the sample builder, so the corpus fixture surface it also carries is
// legitimately unused here (synth_repro exercises it).
#[allow(dead_code)]
#[path = "../examples/synth.rs"]
mod synth;

use std::fs;
use std::path::PathBuf;

use fvf_wasm::records::decode_capture;
use fvf_wasm::types::DescriptorFlavor;

fn asset_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/web/public/samples/fvf-sample.fvf.bin")
}

#[test]
fn committed_sample_asset_is_byte_identical_to_regeneration() {
    let committed = fs::read(asset_path())
        .expect("committed sample asset is missing; run `cargo run -p fvf-wasm --example synth -- --sample`");
    let regenerated = synth::build_sample();
    assert_eq!(
        committed.len(),
        regenerated.len(),
        "sample asset length drift; regenerate with `synth --sample`"
    );
    assert_eq!(
        committed, regenerated,
        "sample asset bytes drifted from the synthesizer; regenerate with `synth --sample`"
    );
}

#[test]
fn sample_decodes_as_clean_showcase_capture() {
    let capture = decode_capture(&synth::build_sample()).expect("sample must decode");

    assert_eq!(capture.version, 1);
    assert_eq!(capture.flavor, DescriptorFlavor::Synthetic);
    assert_eq!(capture.timebase_raw, "100 ms/Div");
    assert!((capture.seconds_per_div - 0.1).abs() < 1e-12);
    assert_eq!(capture.timestamp14, "12000020260101");
    assert!(
        capture.warnings.is_empty(),
        "showcase sample must parse without warnings: {:?}",
        capture.warnings
    );
    assert!(capture.derived_channels.is_empty());

    let channels = &capture.channels;
    assert_eq!(channels.len(), 4);
    // Instrument-authentic "Input A".."Input D" labels keep the descriptor
    // classification (and thus the app's channel letters) warning-free.
    let expected = [
        ("Input A", "V", b'A', 0.000_1, -450.0, 450.0),
        ("Input B", "A", b'B', 0.000_2, -12.0, 12.0),
        ("Input C", "V", b'C', 0.000_1, -1.0, 6.0),
        ("Input D", "V", b'D', 0.000_1, -1.0, 6.0),
    ];
    for (channel, (label, unit, letter, scale, window_min, window_max)) in
        channels.iter().zip(expected)
    {
        assert_eq!(channel.label, label);
        assert_eq!(channel.record_label, label);
        assert_eq!(channel.letter, letter);
        assert_eq!(channel.unit, unit);
        assert!((channel.scale - scale).abs() < 1e-15);
        assert!((channel.window_min - window_min).abs() < 1e-12);
        assert!((channel.window_max - window_max).abs() < 1e-12);
        assert_eq!(channel.samples, 100_000);
        assert!((channel.delta_t - 1.0e-5).abs() < 1.0e-12);
        assert_eq!(channel.saturated_sample_count, 0);
        // Monotone trigger-relative time axis starting at -0.5 s over the
        // 1 s stored span.
        assert!((channel.timestamps.first().copied().unwrap_or(0.0) + 0.5).abs() < 1.0e-4);
        assert!(channel.timestamps.windows(2).all(|pair| pair[1] > pair[0]));
    }

    // Mains: 230 V RMS with harmonics, peak inside ±345 V.
    let mains = &channels[0].values;
    let rms = (mains.iter().map(|v| (v * v) as f64).sum::<f64>() / mains.len() as f64).sqrt();
    assert!((rms - 230.0).abs() < 5.0, "mains RMS drifted: {rms}");
    assert!(mains.iter().all(|v| v.abs() < 345.0));

    // Motor current: silent before the ramp, soft-start peak in (8, 10) A.
    let current = &channels[1].values;
    assert!(current[..4_000].iter().all(|v| v.abs() < 0.6));
    let peak = current.iter().fold(0.0_f32, |acc, v| acc.max(v.abs()));
    assert!(
        (8.0..10.0).contains(&peak),
        "soft-start peak drifted: {peak}"
    );

    // PWM gate: both logic levels present, gate off (low) after t >= 0.35 s.
    let pwm = &channels[2].values;
    assert!(pwm.iter().fold(0.0_f32, |a, v| a.max(v.abs())) < 5.5);
    assert!(pwm.iter().any(|v| *v > 4.0));
    assert!(pwm.iter().any(|v| *v < 1.0));
    assert!(pwm[85_000..].iter().all(|v| *v < 1.0));

    // Drive state: crisp two-level signal with exactly four rail crossings
    // (run, fault, restart, stop) for cursor measurements.
    let state = &channels[3].values;
    assert!(state.iter().all(|v| *v < 1.0 || *v > 4.0));
    let transitions = state
        .windows(2)
        .filter(|pair| (pair[1] - pair[0]).abs() > 3.0)
        .count();
    assert_eq!(transitions, 4, "drive-state edge count drifted");
}
