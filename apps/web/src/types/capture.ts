/**
 * TypeScript contracts for parsed captures crossing the worker boundary
 * (architecture.md 3.2).
 *
 * The error/warning code unions mirror the Rust taxonomy in
 * `crates/fvf-wasm/src/error.rs`; the wasm32 conformance suite asserts
 * exact agreement through the committed mirror
 * `crates/fvf-wasm/tests/fixtures/error-taxonomy.json`.
 */

export const PARSE_ERROR_CODES = [
  "invalid_signature",
  "unsupported_capture_version",
  "invalid_timebase_format",
  "invalid_timebase_range",
  "unsupported_capture_variant",
  "truncated_capture",
  "opaque_header",
  "corrupt_sector_table",
  "invalid_time_axis",
] as const;

export type ParseErrorCode = (typeof PARSE_ERROR_CODES)[number];

export const PARSE_WARNING_CODES = [
  "unknown_tag_prefix",
  "derived_record_issue",
  "unknown_record",
  "non_standard_timebase",
  "unclassified_tag",
  "duplicate_channel",
  "vertical_metadata_mismatch",
  "unknown_unit",
  "saturated_samples",
  "derived_legacy_values",
  "time_axis_span_mismatch",
] as const;

export type ParseWarningCode = (typeof PARSE_WARNING_CODES)[number];

export function isParseErrorCode(value: unknown): value is ParseErrorCode {
  return (
    typeof value === "string" &&
    (PARSE_ERROR_CODES as readonly unknown[]).includes(value)
  );
}

/** Descriptor dialect observed in the header (Rust `DescriptorFlavor`). */
export type DescriptorFlavor = "empirical" | "synthetic";

/** Non-fatal parse observation carried next to a successful decode. */
export interface ParseWarningPayload {
  code: ParseWarningCode;
  /** Structured detail (JSON serialization of the Rust warning). */
  message: string;
}

/** One waveform series as delivered to the main thread. */
export interface WaveformChannel {
  /** Physical input letter `A`..`D`; derived channels use their label. */
  name: string;
  /** Descriptor-table label. */
  label: string;
  derived: boolean;
  /**
   * Physical sample values (`raw × S` in channel units, `NaN` at
   * instrument saturation rails) in a standalone (non-Wasm) buffer.
   */
  data: Float32Array;
  /**
   * Verbatim raw sample counts (`i32`) in a standalone buffer. Always
   * present on worker-assembled payloads; optional so hand-built test
   * fixtures stay lean (same convention as `ChannelInfo.unit`).
   */
  rawCounts?: Int32Array;
}

/** Derived (math) channel view with best-effort extent metadata. */
export interface DerivedChannelView {
  /** Descriptor-table label (e.g. `Mathematik A`). */
  label: string;
  /** Full record-trailer label (e.g. `Mathematik A-B`). */
  recordLabel: string;
  /** Physical source letters parsed from the record label. */
  sourceChannels: string[];
  /** Sample count; undefined when the extent was not recoverable. */
  samples: number | undefined;
  /** Sampling interval (s); undefined when the extent was not recoverable. */
  deltaT: number | undefined;
  /** Legacy Q16.16-estimated values (verbatim, no saturation rule). */
  data: Float32Array;
  /**
   * Verbatim raw sample counts (empty when the extent was not
   * recovered). Same optionality convention as the physical channel.
   */
  rawCounts?: Int32Array;
}

/** Scalar per-channel summary carried in {@link ParsedCapture.metadata}. */
export interface ChannelInfo {
  name: string;
  label: string;
  derived: boolean;
  samples: number;
  deltaT: number;
  /** Verbatim channel unit from the record param block (issue #103). */
  unit?: string;
  /** Per-division value in channel units (issue #103). */
  perDiv?: number;
  /** Stored vertical window edges in base-SI channel units (issue #106). */
  windowMin?: number;
  windowMax?: number;
  /** Count of saturated (`NaN`-reading) samples (issue #104). */
  saturatedSamples?: number;
}

export interface CaptureMetadata {
  version: number;
  flavor: DescriptorFlavor;
  timebaseRaw: string;
  secondsPerDiv: number;
  /** 14-digit capture timestamp `HHMMSSYYYYMMDD` (empty when absent). */
  timestamp14: string;
  /** Samples of the first physical channel (0 for derived-only captures). */
  samples: number;
  /** Sampling interval of the first physical channel (s). */
  deltaT: number;
  channels: ChannelInfo[];
}

/**
 * Full parse payload posted by the worker: every buffer is a standalone
 * JS-allocated copy (the Wasm-heap detachment guard of architecture.md
 * 3.2 — no buffer here aliases Wasm linear memory).
 */
export interface ParsedCapture {
  /** Stored time-axis samples of the first physical channel (trigger-relative). */
  timestamps: Float32Array;
  channels: WaveformChannel[];
  derivedChannels: DerivedChannelView[];
  warnings: ParseWarningPayload[];
  metadata: CaptureMetadata;
}

/** Typed parse failure payload (Rust `FvfError` projection). */
export interface ParseErrorPayload {
  code: ParseErrorCode;
  message: string;
  /** Structured JSON detail for the rejection UI. */
  details: string;
}

/** Store-level error code: parser taxonomy plus worker infrastructure. */
export type StoreErrorCode = ParseErrorCode | "worker_error";

export type ParseState = "idle" | "parsing" | "success" | "error";
