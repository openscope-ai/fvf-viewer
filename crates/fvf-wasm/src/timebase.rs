//! Timebase token grammar and decidable validation (issue #7).
//!
//! Implements architecture.md §3.1: the case-insensitive token grammar
//! `^([0-9]+([.,][0-9]{1,6})?)\s*(ns|us|µs|ms|s|min)\s*/\s*div$` (hand-rolled,
//! no regex dependency), comma-to-dot decimal normalization, unit scaling to
//! seconds per division, the physical range gate (1 ns/div .. 120 s/div), and
//! the known-step-sequence check. Values in range but off both hardware step
//! sets parse successfully with a
//! [`ParseWarning::NonStandardTimebase`](crate::error::ParseWarning::NonStandardTimebase)
//! flag (documented tolerance ±0.01 on the sub-second mantissa); only grammar
//! and range violations are hard errors.
//!
//! Timestamp reconstruction from the capture header stays out of scope
//! (issue #8).

use crate::error::{FvfError, ParseWarning};

/// Inclusive physical range floor: 1 ns/div.
pub const PHYSICAL_RANGE_MIN_SECONDS_PER_DIV: f64 = 1.0e-9;
/// Inclusive physical range ceiling: 120 s/div (2 min/div).
pub const PHYSICAL_RANGE_MAX_SECONDS_PER_DIV: f64 = 120.0;
/// Documented tolerance for the sub-second standard-step mantissa check.
pub const STANDARD_STEP_TOLERANCE: f64 = 0.01;
/// Standard sub-second/second step multipliers (architecture.md §3.1).
pub const SUB_SECOND_STEPS: [f64; 8] = [1.0, 1.25, 1.333, 2.0, 2.5, 4.0, 5.0, 6.667];
/// Standard minute roll-mode nominal values (architecture.md §3.1).
pub const MINUTE_ROLL_VALUES: [f64; 4] = [1.0, 2.0, 4.0, 5.0];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Unit {
    Nanos,
    Micros,
    Millis,
    Seconds,
    Minutes,
}

impl Unit {
    fn multiplier(self) -> f64 {
        match self {
            Unit::Nanos => 1.0e-9,
            Unit::Micros => 1.0e-6,
            Unit::Millis => 1.0e-3,
            Unit::Seconds => 1.0,
            Unit::Minutes => 60.0,
        }
    }
}

/// Units ordered so the two-byte units are tried before the bare `s`;
/// the two micro spellings cover U+00B5 and U+03BC.
const UNITS: [(&str, Unit); 7] = [
    ("\u{b5}s", Unit::Micros),
    ("\u{3bc}s", Unit::Micros),
    ("ns", Unit::Nanos),
    ("us", Unit::Micros),
    ("ms", Unit::Millis),
    ("min", Unit::Minutes),
    ("s", Unit::Seconds),
];

/// Result of the timebase validation pipeline: the normalized seconds-per-div
/// value plus the (possibly empty) warning inventory.
#[derive(Debug, Clone, PartialEq)]
pub struct ValidatedTimebase {
    pub seconds_per_div: f64,
    pub warnings: Vec<ParseWarning>,
}

impl ValidatedTimebase {
    /// True when the token sits on a verified hardware step sequence, i.e.
    /// no [`ParseWarning::NonStandardTimebase`](crate::error::ParseWarning::NonStandardTimebase)
    /// was raised.
    pub fn is_standard_step(&self) -> bool {
        self.warnings.is_empty()
    }
}

/// Validates one timebase token end to end: grammar, decimal normalization,
/// unit scaling, physical range gate, and step-sequence classification.
pub fn validate_timebase(token: &str) -> Result<ValidatedTimebase, FvfError> {
    let (value, unit) = parse_components(token)?;
    let seconds_per_div = value * unit.multiplier();
    if !(PHYSICAL_RANGE_MIN_SECONDS_PER_DIV..=PHYSICAL_RANGE_MAX_SECONDS_PER_DIV)
        .contains(&seconds_per_div)
    {
        return Err(FvfError::InvalidTimebaseRange { seconds_per_div });
    }
    let mut warnings = Vec::new();
    if !is_standard_step(seconds_per_div, value, unit) {
        warnings.push(ParseWarning::NonStandardTimebase {
            token: token.to_string(),
            seconds_per_div,
        });
    }
    Ok(ValidatedTimebase {
        seconds_per_div,
        warnings,
    })
}

fn is_standard_step(seconds_per_div: f64, value: f64, unit: Unit) -> bool {
    if unit == Unit::Minutes {
        MINUTE_ROLL_VALUES.contains(&value)
    } else {
        let mantissa = decadic_mantissa(seconds_per_div);
        SUB_SECOND_STEPS
            .iter()
            .any(|step| (mantissa - step).abs() <= STANDARD_STEP_TOLERANCE)
    }
}

/// Mantissa of the decadic normalization `value / 10^floor(log10(value))`,
/// clamped back into `[1, 10)` against float drift at exact powers of ten.
fn decadic_mantissa(value: f64) -> f64 {
    let exponent = value.log10().floor() as i32;
    let mut mantissa = value / 10f64.powi(exponent);
    if mantissa >= 10.0 {
        mantissa /= 10.0;
    } else if mantissa < 1.0 {
        mantissa *= 10.0;
    }
    mantissa
}

fn invalid_format(token: &str) -> FvfError {
    FvfError::InvalidTimebaseFormat {
        token: token.to_string(),
    }
}

/// Hand-rolled grammar match (deterministic, no regex dependency): numeric
/// part with optional `.`/`,` fraction of 1..=6 digits, optional whitespace,
/// unit, optional whitespace around the division slash, lowercase `div`, and
/// no leading or trailing whitespace (the grammar is fully anchored).
fn parse_components(token: &str) -> Result<(f64, Unit), FvfError> {
    let lower = token.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut end = 0;
    while end < bytes.len() && bytes[end].is_ascii_digit() {
        end += 1;
    }
    if end == 0 {
        return Err(invalid_format(token));
    }
    let mut numeric = lower[..end].to_string();
    if end < bytes.len() && (bytes[end] == b'.' || bytes[end] == b',') {
        let fraction_start = end + 1;
        let mut fraction_end = fraction_start;
        while fraction_end < bytes.len()
            && bytes[fraction_end].is_ascii_digit()
            && fraction_end - fraction_start < 6
        {
            fraction_end += 1;
        }
        let digits = fraction_end - fraction_start;
        if digits == 0 || (fraction_end < bytes.len() && bytes[fraction_end].is_ascii_digit()) {
            return Err(invalid_format(token));
        }
        numeric.push('.');
        numeric.push_str(&lower[fraction_start..fraction_end]);
        end = fraction_end;
    }
    let value: f64 = numeric.parse().map_err(|_| invalid_format(token))?;
    let rest = lower[end..].trim_start();
    let Some((prefix, unit)) = UNITS.iter().find(|(name, _)| rest.starts_with(name)) else {
        return Err(invalid_format(token));
    };
    let unit = *unit;
    let rest = rest[prefix.len()..].trim_start();
    let rest = rest
        .strip_prefix('/')
        .ok_or_else(|| invalid_format(token))?;
    let rest = rest.trim_start();
    if rest != "div" {
        return Err(invalid_format(token));
    }
    Ok((value, unit))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn physical_range_bounds_are_inclusive() {
        assert_eq!(
            validate_timebase("1 ns/Div")
                .expect("1 ns/div is the range floor")
                .seconds_per_div,
            1.0e-9
        );
        assert_eq!(
            validate_timebase("2 min/Div")
                .expect("2 min/div is the range ceiling")
                .seconds_per_div,
            120.0
        );
        assert_eq!(
            validate_timebase("0,999 ns/div"),
            Err(FvfError::InvalidTimebaseRange {
                seconds_per_div: 0.999e-9
            })
        );
        assert!(matches!(
            validate_timebase("2,001 min/div"),
            Err(FvfError::InvalidTimebaseRange { .. })
        ));
        assert_eq!(
            validate_timebase("0 s/div"),
            Err(FvfError::InvalidTimebaseRange {
                seconds_per_div: 0.0
            })
        );
        assert_eq!(
            validate_timebase("999999999999999999999999 s/div")
                .expect_err("infinite value")
                .code(),
            "invalid_timebase_range",
            "a mantissa beyond f64 range still rejects typed, never panics"
        );
    }

    #[test]
    fn zero_is_a_range_rejection_not_a_format_rejection() {
        let error = validate_timebase("0 ms/Div").expect_err("zero is out of range");
        assert_eq!(error.code(), "invalid_timebase_range");
    }

    #[test]
    fn comma_and_dot_decimals_normalize_identically() {
        let comma = validate_timebase("1,333 us/Div").expect("comma decimal");
        let dot = validate_timebase("1.333 us/Div").expect("dot decimal");
        assert_eq!(comma.seconds_per_div, dot.seconds_per_div);
        assert_eq!(comma.seconds_per_div, 1.333e-6);
        assert!(comma.is_standard_step());
    }

    #[test]
    fn micro_sign_variants_are_accepted() {
        for token in ["4 us/Div", "4 µs/Div", "4 \u{3bc}s/div", "4 US/DIV"] {
            let validated = validate_timebase(token).expect(token);
            assert_eq!(validated.seconds_per_div, 4.0e-6, "{token}");
            assert!(validated.is_standard_step(), "{token}");
        }
    }

    #[test]
    fn case_and_whitespace_variants_are_accepted() {
        for token in ["10 ms/div", "10 MS/DIV", "10ms/div", "10 ms\t/  div"] {
            let validated = validate_timebase(token).expect(token);
            assert_eq!(validated.seconds_per_div, 0.01, "{token}");
        }
        let spaced = validate_timebase("20 ms / div").expect("20 ms / div");
        assert_eq!(spaced.seconds_per_div, 0.02);
        assert!(spaced.is_standard_step());
    }

    #[test]
    fn anchored_grammar_rejects_leading_and_trailing_whitespace() {
        assert_eq!(
            validate_timebase(" 10 ms/div")
                .expect_err("leading space")
                .code(),
            "invalid_timebase_format"
        );
        assert_eq!(
            validate_timebase("10 ms/div ")
                .expect_err("trailing space")
                .code(),
            "invalid_timebase_format"
        );
        assert_eq!(
            validate_timebase("").expect_err("empty token").code(),
            "invalid_timebase_format"
        );
    }

    #[test]
    fn fraction_digits_beyond_six_reject() {
        assert_eq!(
            validate_timebase("1,1234567 us/Div")
                .expect_err("seven fraction digits")
                .code(),
            "invalid_timebase_format"
        );
        let six = validate_timebase("1,123456 us/Div").expect("six fraction digits");
        assert_eq!(six.seconds_per_div, 1.123456e-6);
        assert!(!six.is_standard_step(), "1.123456 is off the step set");
        assert_eq!(
            validate_timebase("1. us/Div")
                .expect_err("bare separator")
                .code(),
            "invalid_timebase_format"
        );
    }

    #[test]
    fn multiple_separators_reject() {
        for token in ["10,000,000 us/Div", "10.0.0 ms/div"] {
            assert_eq!(
                validate_timebase(token).expect_err(token).code(),
                "invalid_timebase_format",
                "{token}"
            );
        }
    }

    #[test]
    fn missing_division_token_rejects() {
        assert_eq!(
            validate_timebase("10 ms").expect_err("no /div").code(),
            "invalid_timebase_format"
        );
        assert_eq!(
            validate_timebase("abc us/div")
                .expect_err("non-numeric mantissa")
                .code(),
            "invalid_timebase_format"
        );
    }

    #[test]
    fn non_standard_in_range_parses_with_warning_flag() {
        let validated = validate_timebase("3 us/Div").expect("in range");
        assert_eq!(validated.seconds_per_div, 3.0e-6);
        assert!(!validated.is_standard_step());
        assert_eq!(
            validated.warnings,
            vec![ParseWarning::NonStandardTimebase {
                token: "3 us/Div".to_string(),
                seconds_per_div: 3.0e-6,
            }]
        );
        assert_eq!(validated.warnings[0].code(), "non_standard_timebase");
    }

    #[test]
    fn second_domain_mantissas_classify_through_decadic_scaling() {
        assert!(
            validate_timebase("0,1 s/Div")
                .expect("0,1 s")
                .is_standard_step()
        );
        assert!(
            validate_timebase("10 s/div")
                .expect("10 s")
                .is_standard_step()
        );
        assert!(
            validate_timebase("2,5 ms/Div")
                .expect("2,5 ms")
                .is_standard_step()
        );
        assert!(
            validate_timebase("120 s/div")
                .expect("120 s is the range ceiling")
                .warnings
                .iter()
                .any(|warning| warning.code() == "non_standard_timebase"),
            "mantissa 1.2 is off the step set"
        );
    }

    #[test]
    fn minute_domain_uses_roll_mode_nominals() {
        assert!(
            validate_timebase("1 min/Div")
                .expect("1 min")
                .is_standard_step()
        );
        assert!(
            validate_timebase("5 min/div").is_err(),
            "5 min exceeds the 120 s ceiling"
        );
        let error = validate_timebase("500 min/div").expect_err("far out of range");
        assert_eq!(
            error,
            FvfError::InvalidTimebaseRange {
                seconds_per_div: 30_000.0
            }
        );
        assert_eq!(error.code(), "invalid_timebase_range");
    }

    #[test]
    fn tolerance_boundary_is_inclusive() {
        let on_edge = 6.667 - STANDARD_STEP_TOLERANCE;
        let token = format!("{on_edge:.6} ns/Div");
        assert!(
            validate_timebase(&token)
                .expect("at tolerance edge")
                .is_standard_step(),
            "{token} sits exactly 0.01 from 6.667"
        );
        let beyond = 6.667 - STANDARD_STEP_TOLERANCE - 1.0e-6;
        let token = format!("{beyond:.6} ns/Div");
        assert!(
            !validate_timebase(&token)
                .expect("beyond tolerance")
                .is_standard_step(),
            "{token} sits more than 0.01 from every step"
        );
    }

    fn lcg32_next(state: &mut u32) -> u32 {
        *state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        *state
    }

    fn mantissa_bits(word: u32) -> u32 {
        (word >> 8) & 0xFFFF
    }

    /// Seeds and iteration count are pinned by timebase-tokens.json
    /// `propertyTest`; the JSON-driven test asserts the table still agrees.
    const LCG_SEEDS: [u32; 4] = [1, 24_301, 3_735_928_559, u32::MAX];
    const LCG_ITERATIONS: usize = 512;

    fn lcg_words(seed: u32) -> Vec<u32> {
        let mut state = seed;
        (0..LCG_ITERATIONS)
            .map(|_| lcg32_next(&mut state))
            .collect()
    }

    #[test]
    fn property_random_sub_second_mantissas_classify_deterministically() {
        let mut first_pass = Vec::new();
        for seed in LCG_SEEDS {
            for word in lcg_words(seed) {
                let mantissa = 1.0 + f64::from(mantissa_bits(word)) * 9.0 / 65535.0;
                let token = format!("{mantissa:.6} us/Div");
                let validated = validate_timebase(&token)
                    .unwrap_or_else(|error| panic!("{token} must parse: {error}"));
                let on_step_set = SUB_SECOND_STEPS
                    .iter()
                    .any(|step| (mantissa - step).abs() <= STANDARD_STEP_TOLERANCE);
                assert_eq!(validated.is_standard_step(), on_step_set, "{token}");
                assert_eq!(
                    validated.warnings.len(),
                    usize::from(!on_step_set),
                    "{token}"
                );
                let literal: f64 = token
                    .split_whitespace()
                    .next()
                    .expect("mantissa literal")
                    .parse()
                    .expect("mantissa literal parses");
                let expected = literal * 1.0e-6;
                assert!(
                    (validated.seconds_per_div - expected).abs() <= expected * 1.0e-9,
                    "{token}: {} vs {expected}",
                    validated.seconds_per_div
                );
                assert!(
                    (PHYSICAL_RANGE_MIN_SECONDS_PER_DIV..=PHYSICAL_RANGE_MAX_SECONDS_PER_DIV)
                        .contains(&validated.seconds_per_div),
                    "{token}"
                );
                first_pass.push(validated.is_standard_step());
            }
        }
        let mut second_pass = Vec::new();
        for seed in LCG_SEEDS {
            for word in lcg_words(seed) {
                let mantissa = 1.0 + f64::from(mantissa_bits(word)) * 9.0 / 65535.0;
                let token = format!("{mantissa:.6} us/Div");
                second_pass.push(validate_timebase(&token).expect(&token).is_standard_step());
            }
        }
        assert_eq!(
            first_pass, second_pass,
            "classification over the seeded matrix is reproducible"
        );
        let standards = first_pass.iter().filter(|standard| **standard).count();
        let non_standards = first_pass.iter().filter(|standard| !**standard).count();
        assert!(
            standards > 10,
            "the step set must be exercised on a meaningful subset, got {standards}"
        );
        assert!(
            non_standards > 1000,
            "the non-standard warning path must be exercised broadly, got {non_standards}"
        );
    }

    #[test]
    fn property_random_minute_nominals_classify_deterministically() {
        for seed in LCG_SEEDS {
            for word in lcg_words(seed) {
                let nominal = 1 + mantissa_bits(word) % 15;
                let token = format!("{nominal} min/Div");
                let on_roll_mode = MINUTE_ROLL_VALUES.contains(&f64::from(nominal));
                match validate_timebase(&token) {
                    Ok(validated) => {
                        assert!(on_roll_mode, "{token}: only 1 and 2 min fit the range");
                        assert!(validated.is_standard_step(), "{token}");
                        assert_eq!(validated.seconds_per_div, f64::from(nominal) * 60.0);
                    }
                    Err(FvfError::InvalidTimebaseRange { seconds_per_div }) => {
                        assert!(nominal >= 3, "{token}: 1 and 2 min must parse");
                        assert_eq!(seconds_per_div, f64::from(nominal) * 60.0);
                    }
                    Err(error) => panic!("{token}: unexpected {error}"),
                }
            }
        }
    }

    #[test]
    fn property_random_malformed_tokens_reject_as_format_errors() {
        for seed in LCG_SEEDS {
            for word in lcg_words(seed) {
                let digit = mantissa_bits(word) % 9 + 1;
                let token = match word % 3 {
                    0 => format!("{digit}.{digit}.{digit} ms/div"),
                    1 => format!("{digit} ms"),
                    _ => format!("a{digit}b us/div"),
                };
                let error = validate_timebase(&token)
                    .expect_err(&format!("{token} must be a format rejection"));
                assert_eq!(error.code(), "invalid_timebase_format", "{token}");
                assert!(matches!(error, FvfError::InvalidTimebaseFormat { .. }));
            }
        }
    }
}
