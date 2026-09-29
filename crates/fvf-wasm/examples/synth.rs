#[cfg(not(test))]
use std::env;
#[cfg(not(test))]
use std::fs;
#[cfg(not(test))]
use std::path::PathBuf;
#[cfg(not(test))]
use std::process::ExitCode;

#[cfg(not(test))]
use sha2::{Digest, Sha256};

const PARAM_BLOCK_LEN: usize = 388;
const TRAILER_BASE_LEN: usize = 60;
const DESC_TABLE_POS: usize = 0xA0;
const DESC_ENTRY_LEN: usize = 14;
const DESC_TAIL_LEN: usize = 14;
const LABEL_SLOT_LEN: usize = 18;
const POST_FORMAT_LEN: usize = 68;
const PLOT_FORMAT_LEN: usize = 10;
const N_SLOT: usize = 224;
const TIMEBASE_SLOT: usize = 232;
const TIMESTAMP_SLOT: usize = 164;
const DERIVED_SAMPLE_OFFSET: i32 = 4096;
const FLUKEVIEW_MAGIC: &[u8; 6] = b"FV.FVF";
const SECTOR_NAME: &[u8; 9] = b"FlukeView";
const FORMAT_TAG: &[u8; 4] = b"CUR_";
const PLOT_FORMAT: &[u8; 10] = b"%w  %d  %t";
const SETTINGS_TAG: &[u8; 6] = b"FV.FVS";

const F32_DISPLAY_ALT: f32 = f32::from_bits(0x3F40_C0C1);
const F64_SCALE_A: f64 = f64::from_bits(0xBFAE_B851_EB85_1EB8);
const F64_SCALE_B: f64 = 0.08;
const F64_CURSOR_SPAN: f64 = f64::from_bits(0xC415_AF1D_78B5_8C40);
const F64_RANGE_LOW: f64 = -800.0;
const F64_RANGE_HIGH: f64 = 800.0;
const F64_PHASE: f64 = std::f64::consts::FRAC_PI_4;
const F64_Q1_16: f64 = 0.0625;

/// Payload generator for one record (issue #193): corpus fixtures keep the
/// legacy deterministic LCG noise (byte-frozen by the `synth_repro` gate),
/// while the shipped demo sample uses structured showcase waveforms.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WaveShape {
    /// Legacy corpus dialect: seeded LCG noise, byte-identical to the
    /// committed fixture corpus.
    Noise,
    /// 230 V RMS 50 Hz mains with 5th/7th harmonics (dense cycle detail
    /// for zooming; a stable period for cursors).
    Mains,
    /// 50 Hz motor current under a 0.6 s soft-start ramp with a decaying
    /// overshoot (trend at full view, cycles when zoomed).
    SoftStart,
    /// 2 kHz gate train whose duty sweeps 20%→80% while the drive runs.
    Pwm,
    /// Two-level run/fault/restart/stop state signal with crisp edges.
    DriveState,
}

pub struct RecordSpec {
    pub label: &'static str,
    pub samples: u32,
    pub source: Option<usize>,
    /// Verbatim channel unit written to param+312 (`"V"`, `"A"`, `"mA"`).
    pub unit: &'static str,
    /// Unit-family code written verbatim to param+324 (3 = voltage,
    /// 10 = current observed; exact table open per the research issue).
    pub unit_family: u32,
    /// Scale factor S written to param+328 (duplicated at +344):
    /// physical value = raw_i32 * S in `unit`.
    pub scale: f64,
    /// Vertical window written to param+126/+134 (duplicated at +366/+374).
    pub window_min: f64,
    pub window_max: f64,
    /// Stored time-axis left edge in seconds (param+20); `None` centers the
    /// trigger (`-span/2`, the pre-#105 display-center behavior).
    pub t_left: Option<f64>,
    /// Payload generator for this record (noise for corpus fixtures).
    pub shape: WaveShape,
}

pub struct FixtureSpec {
    pub name: &'static str,
    pub timebase: &'static str,
    pub payload_start: usize,
    pub timestamp: &'static str,
    pub records: &'static [RecordSpec],
}

pub const FIXTURES: &[FixtureSpec] = &[
    FixtureSpec {
        name: "accepted-en-4ch-10000-10ms-div.fvf.bin",
        timebase: "10 ms/Div",
        payload_start: 827,
        timestamp: "12000020260101",
        records: &[
            RecordSpec {
                label: "Input A",
                samples: 10_000,
                source: None,
                shape: WaveShape::Noise,
                unit: "V",
                unit_family: 3,
                scale: F64_Q1_16,
                window_min: F64_RANGE_LOW,
                window_max: F64_RANGE_HIGH,
                t_left: None,
            },
            RecordSpec {
                label: "Input B",
                samples: 10_000,
                source: None,
                shape: WaveShape::Noise,
                unit: "V",
                unit_family: 3,
                scale: F64_Q1_16,
                window_min: F64_RANGE_LOW,
                window_max: F64_RANGE_HIGH,
                t_left: None,
            },
            RecordSpec {
                label: "Input C",
                samples: 10_000,
                source: None,
                shape: WaveShape::Noise,
                unit: "V",
                unit_family: 3,
                scale: F64_Q1_16,
                window_min: F64_RANGE_LOW,
                window_max: F64_RANGE_HIGH,
                t_left: None,
            },
            RecordSpec {
                label: "Input D",
                samples: 10_000,
                source: None,
                shape: WaveShape::Noise,
                unit: "V",
                unit_family: 3,
                scale: F64_Q1_16,
                window_min: F64_RANGE_LOW,
                window_max: F64_RANGE_HIGH,
                t_left: None,
            },
        ],
    },
    FixtureSpec {
        name: "accepted-de-eingang-1ch-3000-comma-decimal.fvf.bin",
        timebase: "0,1 s/Div",
        payload_start: 830,
        timestamp: "12000020260101",
        records: &[RecordSpec {
            label: "Eingang A",
            samples: 3_000,
            source: None,
            shape: WaveShape::Noise,
            unit: "V",
            unit_family: 3,
            scale: F64_Q1_16,
            window_min: F64_RANGE_LOW,
            window_max: F64_RANGE_HIGH,
            t_left: None,
        }],
    },
    FixtureSpec {
        name: "accepted-en-2ch-10000-1min-div.fvf.bin",
        timebase: "1 min/Div",
        payload_start: 749,
        timestamp: "12000020260101",
        records: &[
            RecordSpec {
                label: "Input A",
                samples: 10_000,
                source: None,
                shape: WaveShape::Noise,
                unit: "V",
                unit_family: 3,
                scale: F64_Q1_16,
                window_min: F64_RANGE_LOW,
                window_max: F64_RANGE_HIGH,
                t_left: None,
            },
            RecordSpec {
                label: "Input B",
                samples: 10_000,
                source: None,
                shape: WaveShape::Noise,
                unit: "V",
                unit_family: 3,
                scale: F64_Q1_16,
                window_min: F64_RANGE_LOW,
                window_max: F64_RANGE_HIGH,
                t_left: None,
            },
        ],
    },
    FixtureSpec {
        name: "rejected-invalid-magic-1ch-1000.fvf.bin",
        timebase: "10 ms/Div",
        payload_start: 830,
        timestamp: "12000020260101",
        records: &[RecordSpec {
            label: "Input A",
            samples: 1_000,
            source: None,
            shape: WaveShape::Noise,
            unit: "V",
            unit_family: 3,
            scale: F64_Q1_16,
            window_min: F64_RANGE_LOW,
            window_max: F64_RANGE_HIGH,
            t_left: None,
        }],
    },
    FixtureSpec {
        name: "rejected-timebase-format-1ch-1000.fvf.bin",
        timebase: "abc us/div",
        payload_start: 830,
        timestamp: "12000020260101",
        records: &[RecordSpec {
            label: "Input A",
            samples: 1_000,
            source: None,
            shape: WaveShape::Noise,
            unit: "V",
            unit_family: 3,
            scale: F64_Q1_16,
            window_min: F64_RANGE_LOW,
            window_max: F64_RANGE_HIGH,
            t_left: None,
        }],
    },
    FixtureSpec {
        name: "rejected-timebase-range-1ch-1000.fvf.bin",
        timebase: "500 min/div",
        payload_start: 830,
        timestamp: "12000020260101",
        records: &[RecordSpec {
            label: "Input A",
            samples: 1_000,
            source: None,
            shape: WaveShape::Noise,
            unit: "V",
            unit_family: 3,
            scale: F64_Q1_16,
            window_min: F64_RANGE_LOW,
            window_max: F64_RANGE_HIGH,
            t_left: None,
        }],
    },
    FixtureSpec {
        name: "nonsequential-abd-3ch-10000-20ms-div.fvf.bin",
        timebase: "20 ms/Div",
        payload_start: 827,
        timestamp: "12000020260101",
        records: &[
            RecordSpec {
                label: "Input A",
                samples: 10_000,
                source: None,
                shape: WaveShape::Noise,
                unit: "V",
                unit_family: 3,
                scale: F64_Q1_16,
                window_min: F64_RANGE_LOW,
                window_max: F64_RANGE_HIGH,
                t_left: None,
            },
            RecordSpec {
                label: "Input B",
                samples: 10_000,
                source: None,
                shape: WaveShape::Noise,
                unit: "V",
                unit_family: 3,
                scale: F64_Q1_16,
                window_min: F64_RANGE_LOW,
                window_max: F64_RANGE_HIGH,
                t_left: None,
            },
            RecordSpec {
                label: "Input D",
                samples: 10_000,
                source: None,
                shape: WaveShape::Noise,
                unit: "V",
                unit_family: 3,
                scale: F64_Q1_16,
                window_min: F64_RANGE_LOW,
                window_max: F64_RANGE_HIGH,
                t_left: None,
            },
        ],
    },
    FixtureSpec {
        name: "derived-mathematik-2ch-3000-10ms-div.fvf.bin",
        timebase: "10 ms/Div",
        payload_start: 749,
        timestamp: "12000020260101",
        records: &[
            RecordSpec {
                label: "Input A",
                samples: 3_000,
                source: None,
                shape: WaveShape::Noise,
                unit: "V",
                unit_family: 3,
                scale: F64_Q1_16,
                window_min: F64_RANGE_LOW,
                window_max: F64_RANGE_HIGH,
                t_left: None,
            },
            RecordSpec {
                label: "Mathematik A",
                samples: 3_000,
                source: Some(0),
                shape: WaveShape::Noise,
                unit: "V",
                unit_family: 3,
                scale: F64_Q1_16,
                window_min: F64_RANGE_LOW,
                window_max: F64_RANGE_HIGH,
                t_left: None,
            },
        ],
    },
    FixtureSpec {
        name: "extreme-envelope-4ch-500-10ms-div.fvf.bin",
        timebase: "10 ms/Div",
        payload_start: 827,
        timestamp: "12000020260101",
        records: &[
            RecordSpec {
                label: "Input A",
                samples: 500,
                source: None,
                shape: WaveShape::Noise,
                unit: "V",
                unit_family: 3,
                scale: F64_Q1_16,
                window_min: F64_RANGE_LOW,
                window_max: F64_RANGE_HIGH,
                t_left: None,
            },
            RecordSpec {
                label: "Input B",
                samples: 500,
                source: None,
                shape: WaveShape::Noise,
                unit: "V",
                unit_family: 3,
                scale: F64_Q1_16,
                window_min: F64_RANGE_LOW,
                window_max: F64_RANGE_HIGH,
                t_left: None,
            },
            RecordSpec {
                label: "Input C",
                samples: 500,
                source: None,
                shape: WaveShape::Noise,
                unit: "V",
                unit_family: 3,
                scale: F64_Q1_16,
                window_min: F64_RANGE_LOW,
                window_max: F64_RANGE_HIGH,
                t_left: None,
            },
            RecordSpec {
                label: "Input D",
                samples: 500,
                source: None,
                shape: WaveShape::Noise,
                unit: "V",
                unit_family: 3,
                scale: F64_Q1_16,
                window_min: F64_RANGE_LOW,
                window_max: F64_RANGE_HIGH,
                t_left: None,
            },
        ],
    },
    FixtureSpec {
        name: "extreme-envelope-1ch-250000-10ms-div.fvf.bin",
        timebase: "10 ms/Div",
        payload_start: 830,
        timestamp: "12000020260101",
        records: &[RecordSpec {
            label: "Input A",
            samples: 250_000,
            source: None,
            shape: WaveShape::Noise,
            unit: "V",
            unit_family: 3,
            scale: F64_Q1_16,
            window_min: F64_RANGE_LOW,
            window_max: F64_RANGE_HIGH,
            t_left: None,
        }],
    },
    FixtureSpec {
        name: "accepted-en-2ch-current-offcenter-1s-div.fvf.bin",
        timebase: "1 s/Div",
        payload_start: 749,
        timestamp: "12000020260101",
        records: &[
            RecordSpec {
                label: "Input A",
                samples: 9_636,
                source: None,
                shape: WaveShape::Noise,
                unit: "A",
                unit_family: 10,
                scale: 0.015_625,
                window_min: -250.0,
                window_max: 150.0,
                t_left: Some(-3.996),
            },
            RecordSpec {
                label: "Input B",
                samples: 9_636,
                source: None,
                shape: WaveShape::Noise,
                unit: "mA",
                unit_family: 10,
                scale: 0.000_031_25,
                window_min: -0.3,
                window_max: 0.5,
                t_left: Some(-3.996),
            },
        ],
    },
];

/// Shipped demo sample (issue #193): the user-facing capture behind the
/// homepage "Try a sample capture" action. Four channels over a 1 s span
/// ("100 ms/Div", 100,000 samples per channel, dt = 10 µs) chosen to
/// showcase instant zooming (dense 50 Hz cycles at full view, individual
/// cycles mid-zoom, 2 kHz PWM edges deep-zoomed), different y-axis scales
/// (±450 V mains vs ±12 A current vs 0–5 V logic), cursor measurability
/// (mains period, soft-start ramp time, state edges, PWM duty), and fast
/// loading (~1.6 MB total). Committed byte-exactly at
/// `apps/web/public/samples/fvf-sample.fvf.bin`; the `sample_asset` test
/// fails on any drift.
pub const SAMPLE_NAME: &str = "fvf-sample.fvf.bin";

pub const SAMPLE: &FixtureSpec = &FixtureSpec {
    name: SAMPLE_NAME,
    timebase: "100 ms/Div",
    payload_start: 827,
    timestamp: "12000020260101",
    records: &[
        RecordSpec {
            label: "Input A",
            samples: 100_000,
            source: None,
            shape: WaveShape::Mains,
            unit: "V",
            unit_family: 3,
            scale: 0.000_1,
            window_min: -450.0,
            window_max: 450.0,
            t_left: None,
        },
        RecordSpec {
            label: "Input B",
            samples: 100_000,
            source: None,
            shape: WaveShape::SoftStart,
            unit: "A",
            unit_family: 10,
            scale: 0.000_2,
            window_min: -12.0,
            window_max: 12.0,
            t_left: None,
        },
        RecordSpec {
            label: "Input C",
            samples: 100_000,
            source: None,
            shape: WaveShape::Pwm,
            unit: "V",
            unit_family: 3,
            scale: 0.000_1,
            window_min: -1.0,
            window_max: 6.0,
            t_left: None,
        },
        RecordSpec {
            label: "Input D",
            samples: 100_000,
            source: None,
            shape: WaveShape::DriveState,
            unit: "V",
            unit_family: 3,
            scale: 0.000_1,
            window_min: -1.0,
            window_max: 6.0,
            t_left: None,
        },
    ],
};

pub const OVERSIZED: &FixtureSpec = &FixtureSpec {
    name: "extreme-envelope-4ch-250000-10ms-div.fvf.bin",
    timebase: "10 ms/Div",
    payload_start: 827,
    timestamp: "12000020260101",
    records: &[
        RecordSpec {
            label: "Input A",
            samples: 250_000,
            source: None,
            shape: WaveShape::Noise,
            unit: "V",
            unit_family: 3,
            scale: F64_Q1_16,
            window_min: F64_RANGE_LOW,
            window_max: F64_RANGE_HIGH,
            t_left: None,
        },
        RecordSpec {
            label: "Input B",
            samples: 250_000,
            source: None,
            shape: WaveShape::Noise,
            unit: "V",
            unit_family: 3,
            scale: F64_Q1_16,
            window_min: F64_RANGE_LOW,
            window_max: F64_RANGE_HIGH,
            t_left: None,
        },
        RecordSpec {
            label: "Input C",
            samples: 250_000,
            source: None,
            shape: WaveShape::Noise,
            unit: "V",
            unit_family: 3,
            scale: F64_Q1_16,
            window_min: F64_RANGE_LOW,
            window_max: F64_RANGE_HIGH,
            t_left: None,
        },
        RecordSpec {
            label: "Input D",
            samples: 250_000,
            source: None,
            shape: WaveShape::Noise,
            unit: "V",
            unit_family: 3,
            scale: F64_Q1_16,
            window_min: F64_RANGE_LOW,
            window_max: F64_RANGE_HIGH,
            t_left: None,
        },
    ],
};

pub const UNSUPPORTED_VARIANT_NAME: &str = "unsupported-variant-settings.fvf.bin";

const BAD_MAGIC_FIXTURE: &str = "rejected-invalid-magic-1ch-1000.fvf.bin";
const BAD_MAGIC: &[u8; 6] = b"XX.XVF";

fn fnv1a(text: &str) -> u32 {
    let mut hash: u32 = 0x811C_9DC5;
    for byte in text.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

fn channel_seed(fixture: &str, channel: usize) -> u32 {
    fnv1a(fixture) ^ 0x9E37_79B9_u32.wrapping_mul(channel as u32 + 1)
}

fn payload_samples(seed: u32, count: u32) -> impl Iterator<Item = i32> {
    let mut state = seed;
    (0..count).map(move |_| {
        state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        (((state >> 8) & 0xFFFF) as i32) - 32_768
    })
}

/// Time span of the demo sample's stored axis (10 divisions at 100 ms).
const SAMPLE_SPAN_SECONDS: f64 = 1.0;

/// Soft-start timeline shared by the demo waveforms: ramp 0→1 over
/// 0.6 s starting at t = -0.45 s, then a decaying 8% overshoot.
fn soft_start_envelope(t: f64) -> f64 {
    let ramp = ((t + 0.45) / 0.6).clamp(0.0, 1.0);
    let overshoot = if t > 0.15 {
        0.08 * (-(t - 0.15) / 0.08).exp()
    } else {
        0.0
    };
    ramp * (1.0 + overshoot)
}

/// Drive-run windows for the demo logic channels: run [-0.45, 0.15),
/// fault trip [0.15, 0.25), restart [0.25, 0.35), stopped afterwards.
fn drive_running(t: f64) -> bool {
    (-0.45..0.15).contains(&t) || (0.25..0.35).contains(&t)
}

/// Structured showcase payload for one demo record (issue #193): physical
/// value at trigger-relative time t, quantized to raw counts via the
/// record's scale. Deterministic (seeded LCG noise, no clocks/entropy);
/// amplitudes stay far from the i32 rails so no sample reads as saturated.
fn shaped_samples(record: &RecordSpec, samples: u32) -> impl Iterator<Item = i32> + '_ {
    let dt = SAMPLE_SPAN_SECONDS / f64::from(samples);
    let mut noise_state = 0x5EED_0001_u32;
    (0..samples).map(move |index| {
        let t = -SAMPLE_SPAN_SECONDS / 2.0 + f64::from(index) * dt;
        noise_state = noise_state
            .wrapping_mul(1_664_525)
            .wrapping_add(1_013_904_223);
        let noise = (((noise_state >> 8) & 0xFFFF) as f64 / 32_768.0) - 1.0;
        let mains_omega = 2.0 * std::f64::consts::PI * 50.0;
        let value = match record.shape {
            WaveShape::Mains => {
                325.269_119_345_811_9
                    * ((mains_omega * t).sin()
                        + 0.03 * (5.0 * mains_omega * t + 0.7).sin()
                        + 0.01 * (7.0 * mains_omega * t + 1.9).sin())
                    + 0.4 * noise
            }
            WaveShape::SoftStart => {
                8.0 * soft_start_envelope(t) * (mains_omega * t + std::f64::consts::FRAC_PI_3).sin()
                    + 0.2 * soft_start_envelope(t)
                    + 0.15 * noise
            }
            WaveShape::Pwm => {
                let duty = 0.2 + 0.6 * (((t + 0.4) / 0.7).clamp(0.0, 1.0));
                let phase = ((t * 2000.0) % 1.0 + 1.0) % 1.0;
                let level = if drive_running(t) && phase < duty {
                    5.0
                } else {
                    0.0
                };
                level + 0.05 * noise
            }
            WaveShape::DriveState => {
                let level = if drive_running(t) { 5.0 } else { 0.0 };
                level + 0.05 * noise
            }
            WaveShape::Noise => unreachable!("noise records use payload_samples"),
        };
        let raw = (value / record.scale).round();
        raw.clamp(-100_000_000.0, 100_000_000.0) as i32
    })
}

fn push_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_f32(out: &mut Vec<u8>, value: f32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_f64(out: &mut Vec<u8>, value: f64) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_ascii(out: &mut Vec<u8>, text: &str, slot: usize) {
    let bytes = text.as_bytes();
    assert!(
        bytes.len() <= slot,
        "ascii literal {text:?} exceeds slot {slot}"
    );
    out.extend_from_slice(bytes);
    out.extend(std::iter::repeat_n(0, slot - bytes.len()));
}

fn record_span(record: &RecordSpec, param_start: usize) -> (usize, usize) {
    let payload_start = param_start + PARAM_BLOCK_LEN;
    let trailer_start = payload_start + 4 * record.samples as usize;
    (payload_start, trailer_start)
}

fn format_pos(payload_start: usize) -> usize {
    payload_start - PARAM_BLOCK_LEN - POST_FORMAT_LEN - PLOT_FORMAT_LEN
}

fn build_header(spec: &FixtureSpec, trailer1_start: usize, file_len: usize) -> Vec<u8> {
    let nch = spec.records.len();
    let header_len = spec.payload_start - PARAM_BLOCK_LEN;
    let labels_pos = DESC_TABLE_POS + DESC_ENTRY_LEN * nch + DESC_TAIL_LEN;
    let format = format_pos(spec.payload_start);
    let mut out = Vec::with_capacity(header_len);

    out.extend_from_slice(FLUKEVIEW_MAGIC);
    push_u16(&mut out, 26);
    push_u32(&mut out, 1);
    push_u32(&mut out, 0);
    push_u32(&mut out, 0);
    push_u16(&mut out, 0);
    push_u16(&mut out, 1);
    push_u32(&mut out, 0);
    push_u32(&mut out, 44);
    push_u32(&mut out, (file_len - 44) as u32);
    push_u32(&mut out, 1);
    push_u32(&mut out, 0);
    out.extend_from_slice(FORMAT_TAG);
    push_f64(&mut out, 10.0);
    push_f64(&mut out, 9.0);
    push_u32(&mut out, DESC_TABLE_POS as u32);
    push_u32(&mut out, 0);
    push_u32(&mut out, 44);
    push_u32(&mut out, 47);
    push_u32(&mut out, 114);
    push_u32(&mut out, 122);
    push_u16(&mut out, 1);
    out.push(1);
    out.push(1);
    push_u32(&mut out, 52);
    push_u16(&mut out, 4);
    push_f32(&mut out, 1.0);
    push_f32(&mut out, 1.0);
    push_f32(&mut out, 1.0);
    push_f32(&mut out, F32_DISPLAY_ALT);
    push_f32(&mut out, F32_DISPLAY_ALT);
    push_f32(&mut out, F32_DISPLAY_ALT);
    out.extend(std::iter::repeat_n(0, 0x9A - out.len()));
    push_f32(&mut out, 1.0);
    push_u16(&mut out, 1);
    assert_eq!(out.len(), DESC_TABLE_POS);

    for index in 0..spec.records.len() {
        push_u16(&mut out, index as u16 + 1);
        push_u32(&mut out, (labels_pos + LABEL_SLOT_LEN * index) as u32);
        push_u16(&mut out, 2);
        push_u32(&mut out, 1);
        push_u16(&mut out, 0);
    }
    push_u16(&mut out, 0);
    push_u16(&mut out, 2);
    push_u32(&mut out, (trailer1_start + 23) as u32);
    push_u16(&mut out, 1);
    push_u16(&mut out, 2);
    push_u16(&mut out, 2);
    assert_eq!(out.len(), labels_pos);

    for record in spec.records {
        push_ascii(&mut out, record.label, LABEL_SLOT_LEN);
    }
    out.extend(std::iter::repeat_n(0, format - out.len()));
    out.extend_from_slice(PLOT_FORMAT);

    let post_format: [u8; POST_FORMAT_LEN] = [
        0x02, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0xFF, 0x00, 0x00, 0x00, 0x08, 0x01, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x0A, 0x00, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x01,
        0x00, 0x00, 0x00, 0xFF, 0x1A, 0x00, 0x00, 0x00, 0x1A, 0x00, 0x00, 0x00, 0x16, 0x05, 0x00,
        0x00, 0xE6, 0x01, 0x00, 0x00, 0x06, 0x05, 0x00, 0x00, 0xBF, 0x01, 0x00, 0x00, 0x06, 0x05,
        0x00, 0x00, 0xBF, 0x01, 0x00, 0x00, 0x00, 0x00,
    ];
    out.extend_from_slice(&post_format);
    assert_eq!(out.len(), header_len);
    out
}

/// Time-axis span (10 divisions) in seconds for the fixture timebases.
/// Explicit match: a new timebase fails loudly instead of silently
/// deriving a wrong stored axis. The two deliberately invalid timebases
/// yield `None`: those fixtures are rejected before timestamp
/// reconstruction, so their +20/+44 slots keep legacy bytes.
fn span_seconds(timebase: &str) -> Option<f64> {
    let seconds_per_div = match timebase {
        "10 ms/Div" => 0.01,
        "0,1 s/Div" => 0.1,
        "1 min/Div" => 60.0,
        "20 ms/Div" => 0.02,
        "100 ms/Div" => 0.1,
        "1 s/Div" => 1.0,
        "abc us/div" | "500 min/div" => return None,
        other => panic!("synth has no span for timebase {other:?}; extend span_seconds"),
    };
    Some(10.0 * seconds_per_div)
}

fn build_param_block(
    spec: &FixtureSpec,
    record: &RecordSpec,
    payload_start: usize,
    trailer_start: usize,
) -> Vec<u8> {
    let format = format_pos(payload_start);
    let mut out = Vec::with_capacity(PARAM_BLOCK_LEN);
    push_u16(&mut out, 2);
    push_u32(&mut out, (format + 44) as u32);
    push_u32(&mut out, (format + 134) as u32);
    push_u32(&mut out, 1);
    push_u32(&mut out, 0);
    push_f64(&mut out, F64_SCALE_A);
    push_f64(&mut out, 0.0);
    push_f64(&mut out, F64_SCALE_A);
    push_f64(&mut out, F64_SCALE_B);
    out.push(1);
    out.push(1);
    push_u32(&mut out, (format + 92) as u32);
    push_u16(&mut out, 2);
    push_u32(&mut out, (format + 102) as u32);
    push_u32(&mut out, (format + 118) as u32);
    push_u32(&mut out, 255);
    push_f64(&mut out, F64_CURSOR_SPAN);
    push_u32(&mut out, 0);
    push_u32(&mut out, 255);
    push_f64(&mut out, F64_CURSOR_SPAN);
    push_u32(&mut out, 0);
    push_u32(&mut out, 2);
    out.extend(std::iter::repeat_n(0, 116 - out.len()));
    push_u32(&mut out, (TRAILER_BASE_LEN + 7) as u32);
    out.extend(std::iter::repeat_n(0, 126 - out.len()));
    push_f64(&mut out, record.window_min);
    push_f64(&mut out, record.window_max);
    out.push(1);
    out.push(1);
    push_u32(&mut out, 0);
    push_u16(&mut out, 3);
    push_u32(&mut out, 1);
    push_u16(&mut out, 0);
    push_u32(&mut out, 1);
    push_u32(&mut out, (trailer_start - 44) as u32);
    push_ascii(&mut out, spec.timestamp, 14);
    assert_eq!(out.len(), TIMESTAMP_SLOT + 14);
    push_u32(&mut out, 0);
    push_u32(&mut out, (trailer_start - 42) as u32);
    push_u32(&mut out, 1);
    push_u32(&mut out, 0);
    push_f64(&mut out, 1.0);
    push_u32(&mut out, (format + 248) as u32);
    push_u32(&mut out, 0);
    push_u32(&mut out, 0);
    push_u32(&mut out, 1);
    push_u32(&mut out, 0);
    push_u16(&mut out, 2);
    assert_eq!(out.len(), N_SLOT);
    push_u32(&mut out, spec.records.first().map_or(0, |r| r.samples));
    push_u32(&mut out, 0);
    assert_eq!(out.len(), TIMEBASE_SLOT);
    push_ascii(&mut out, spec.timebase, 12);
    push_u32(&mut out, 1);
    push_f64(&mut out, F64_PHASE);
    push_f64(&mut out, F64_SCALE_A);
    push_f64(&mut out, 1.0);
    push_f64(&mut out, 0.0);
    push_u16(&mut out, 0xFFFA_u16);
    push_u16(&mut out, 12);
    push_u16(&mut out, 1);
    push_f64(&mut out, F64_SCALE_A);
    push_f64(&mut out, F64_SCALE_B);
    push_u32(&mut out, 1);
    push_u16(&mut out, 1);
    push_u32(&mut out, (payload_start - 48) as u32);
    push_ascii(&mut out, record.unit, 4);
    let truncated = &spec.timebase[..spec.timebase.len().min(8)];
    push_ascii(&mut out, truncated, 8);
    push_u32(&mut out, record.unit_family);
    push_f64(&mut out, record.scale);
    push_u32(&mut out, 0);
    // +340..344 is an opaque zero word in the synthesized dialect. The
    // the OCR-verified captures carry 0x80000000 here in every record
    // (older captures carry zero); the semantics are unmodeled and no
    // test asserts these bytes — see the fixtures README.
    push_u32(&mut out, 0);
    push_f64(&mut out, record.scale);
    out.extend(std::iter::repeat_n(0, 360 - out.len()));
    push_u16(&mut out, 0xFFFC_u16);
    push_u16(&mut out, 8);
    push_u16(&mut out, 1);
    push_f64(&mut out, record.window_min);
    push_f64(&mut out, record.window_max);
    push_u16(&mut out, 2);
    push_u16(&mut out, 1);
    push_u16(&mut out, 4);
    assert_eq!(out.len(), PARAM_BLOCK_LEN);
    // Stored time axis (issue #105's sole timestamp source): only the
    // +20/+44 ranges are authoritative. Their overwrite partially
    // clobbers the neighboring legacy pushes at +18/+26/+42 (those writes
    // are unchanged; the resulting bytes at the overlap are the axis).
    // `None` centers the trigger at -span/2. Fixtures with deliberately
    // invalid timebases keep legacy bytes.
    if let Some(span) = span_seconds(spec.timebase) {
        let t_left = record.t_left.unwrap_or(-span / 2.0);
        out[20..28].copy_from_slice(&t_left.to_le_bytes());
        out[44..52].copy_from_slice(&(t_left + span).to_le_bytes());
    }
    out
}

fn build_trailer(label: &str, payload_start: usize, payload_len: usize) -> Vec<u8> {
    let payload_end = payload_start + payload_len;
    let mut out = Vec::with_capacity(TRAILER_BASE_LEN + label.len());
    out.extend(std::iter::repeat_n(0, 12));
    push_u32(&mut out, (payload_end - 24) as u32);
    push_u32(&mut out, 0);
    push_u32(&mut out, (payload_end - 16) as u32);
    push_u32(&mut out, 0);
    push_u16(&mut out, 1);
    out.extend_from_slice(SECTOR_NAME);
    out.extend(std::iter::repeat_n(0, 7));
    push_u32(&mut out, (payload_end + 6) as u32);
    push_u16(&mut out, (8 + label.len()) as u16);
    push_u32(&mut out, (payload_end + 12) as u32);
    push_u16(&mut out, label.len() as u16);
    out.extend_from_slice(label.as_bytes());
    out.extend_from_slice(&[0, 0]);
    assert_eq!(out.len(), TRAILER_BASE_LEN + label.len());
    out
}

pub fn build_fixture(spec: &FixtureSpec) -> Vec<u8> {
    let header_len = spec.payload_start - PARAM_BLOCK_LEN;
    let mut cursor = header_len;
    let mut spans = Vec::with_capacity(spec.records.len());
    for record in spec.records {
        let span = record_span(record, cursor);
        cursor = span.1 + TRAILER_BASE_LEN + record.label.len();
        spans.push(span);
    }
    let file_len = cursor;
    let mut out = build_header(spec, spans[0].1, file_len);
    assert_eq!(out.len(), header_len);

    for (index, record) in spec.records.iter().enumerate() {
        let (payload_start, trailer_start) = spans[index];
        out.extend(build_param_block(
            spec,
            record,
            payload_start,
            trailer_start,
        ));
        let derived = record.source.is_some();
        let seed_channel = record.source.unwrap_or(index);
        // Corpus fixtures keep the byte-frozen LCG noise payload; the demo
        // sample records generate structured showcase waveforms instead.
        let samples_iter: Box<dyn Iterator<Item = i32>> = if record.shape == WaveShape::Noise {
            Box::new(
                payload_samples(channel_seed(spec.name, seed_channel), record.samples).map(
                    move |value| {
                        if derived {
                            value.wrapping_add(DERIVED_SAMPLE_OFFSET)
                        } else {
                            value
                        }
                    },
                ),
            )
        } else {
            Box::new(shaped_samples(record, record.samples))
        };
        for sample in samples_iter {
            push_u32(&mut out, sample as u32);
        }
        out.extend(build_trailer(
            record.label,
            payload_start,
            4 * record.samples as usize,
        ));
        assert_eq!(
            out.len(),
            trailer_start + TRAILER_BASE_LEN + record.label.len()
        );
    }
    if spec.name == BAD_MAGIC_FIXTURE {
        out[..6].copy_from_slice(BAD_MAGIC);
    }
    assert_eq!(out.len(), file_len);
    out
}

pub fn build_unsupported_variant() -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(FLUKEVIEW_MAGIC);
    push_u16(&mut out, 26);
    push_u32(&mut out, 1);
    push_u32(&mut out, 0);
    push_u32(&mut out, 0);
    push_u16(&mut out, 0);
    push_u16(&mut out, 1);
    push_u32(&mut out, 0);
    push_u32(&mut out, 44);
    out.extend(std::iter::repeat_n(0, 0x24 - out.len()));
    push_u32(&mut out, 2);
    push_u32(&mut out, 0);
    out.extend_from_slice(SETTINGS_TAG);
    push_u16(&mut out, 26);
    push_u16(&mut out, 2);
    push_u16(&mut out, 4);
    out.extend(std::iter::repeat_n(0, 4096 - out.len()));
    let tail = (out.len() - 44) as u32;
    out[0x20..0x24].copy_from_slice(&tail.to_le_bytes());
    out
}

pub fn build_all() -> Vec<(&'static str, Vec<u8>)> {
    let mut out: Vec<(&'static str, Vec<u8>)> = FIXTURES
        .iter()
        .map(|spec| (spec.name, build_fixture(spec)))
        .collect();
    out.push((UNSUPPORTED_VARIANT_NAME, build_unsupported_variant()));
    out
}

/// Regenerates the shipped demo sample asset (issue #193).
pub fn build_sample() -> Vec<u8> {
    build_fixture(SAMPLE)
}

pub fn build_oversized() -> (&'static str, Vec<u8>) {
    (OVERSIZED.name, build_fixture(OVERSIZED))
}

#[cfg(not(test))]
fn default_out_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/synthetic")
}

#[cfg(not(test))]
fn default_sample_out_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/web/public/samples")
}

#[cfg(not(test))]
fn write_all(out_dir: &std::path::Path, pairs: &[(&'static str, Vec<u8>)]) -> std::io::Result<()> {
    fs::create_dir_all(out_dir)?;
    for (name, bytes) in pairs {
        fs::write(out_dir.join(name), bytes)?;
    }
    Ok(())
}

#[cfg(not(test))]
fn hex_digest(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(not(test))]
fn main() -> ExitCode {
    let mut out_dir: Option<PathBuf> = None;
    let mut oversized = false;
    let mut hashes = false;
    let mut sample = false;
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--out" => match args.next() {
                Some(path) => out_dir = Some(PathBuf::from(path)),
                None => {
                    eprintln!("--out requires a directory argument");
                    return ExitCode::FAILURE;
                }
            },
            "--oversized" => oversized = true,
            "--hashes" => hashes = true,
            "--sample" => sample = true,
            other => {
                eprintln!(
                    "unknown argument {other}; usage: synth [--out DIR] [--oversized] [--hashes] [--sample]"
                );
                return ExitCode::FAILURE;
            }
        }
    }
    // --sample regenerates only the shipped demo asset (issue #193); it
    // defaults to the web app's public samples directory, while corpus
    // regeneration keeps the committed fixture directory.
    if sample {
        let out_dir = out_dir.unwrap_or_else(default_sample_out_dir);
        let pairs = [(SAMPLE_NAME, build_sample())];
        if let Err(error) = write_all(&out_dir, &pairs) {
            eprintln!("writing sample to {} failed: {error}", out_dir.display());
            return ExitCode::FAILURE;
        }
        if hashes {
            for (name, bytes) in &pairs {
                println!("{name} {} {}", bytes.len(), hex_digest(bytes));
            }
        }
        println!("wrote {} sample to {}", pairs.len(), out_dir.display());
        return ExitCode::SUCCESS;
    }
    let out_dir = out_dir.unwrap_or_else(default_out_dir);
    let mut pairs = build_all();
    if oversized {
        let (name, bytes) = build_oversized();
        pairs.push((name, bytes));
    }
    if let Err(error) = write_all(&out_dir, &pairs) {
        eprintln!("writing fixtures to {} failed: {error}", out_dir.display());
        return ExitCode::FAILURE;
    }
    if hashes {
        for (name, bytes) in &pairs {
            println!("{name} {} {}", bytes.len(), hex_digest(bytes));
        }
    }
    println!("wrote {} fixtures to {}", pairs.len(), out_dir.display());
    ExitCode::SUCCESS
}
