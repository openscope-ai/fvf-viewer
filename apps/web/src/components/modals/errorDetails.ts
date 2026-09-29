/**
 * Error detail parser and taxonomy mapping (issue #11): maps error codes
 * to human-readable titles and safely extracts structured diagnostic details
 * from engine error JSON strings without throwing.
 */

import type { StoreErrorCode } from "../../types/capture";

export const ERROR_TITLES: Record<StoreErrorCode, string> = {
  invalid_signature: "Invalid File Signature",
  unsupported_capture_version: "Unsupported Capture Version",
  invalid_timebase_format: "Invalid Timebase Format",
  invalid_timebase_range: "Invalid Timebase Range",
  unsupported_capture_variant: "Unsupported Capture Variant",
  truncated_capture: "Truncated Capture",
  opaque_header: "Unrecognized Header Structure",
  corrupt_sector_table: "Corrupt Sector Table",
  invalid_time_axis: "Invalid Stored Time Axis",
  worker_error: "Parse Worker Error",
};

export interface ErrorDetails {
  detectedHex?: string;
  detectedAscii?: string;
  detectedTagHex?: string;
  detectedTag?: string;
  version?: number;
  token?: string;
  secondsPerDiv?: number;
  needed?: number;
  available?: number;
  detail?: string;
}

export function getErrorTitle(code: StoreErrorCode | string): string {
  if (code in ERROR_TITLES) {
    return ERROR_TITLES[code as StoreErrorCode];
  }
  return "Parse Error";
}

export function parseErrorDetails(
  detailsString?: string | null,
): ErrorDetails | null {
  if (!detailsString || typeof detailsString !== "string") {
    return null;
  }
  const trimmed = detailsString.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const result: ErrorDetails = {};
    if (typeof parsed.detectedHex === "string") {
      result.detectedHex = parsed.detectedHex;
    }
    if (typeof parsed.detectedAscii === "string") {
      result.detectedAscii = parsed.detectedAscii;
    }
    if (typeof parsed.detectedTagHex === "string") {
      result.detectedTagHex = parsed.detectedTagHex;
    }
    if (typeof parsed.detectedTag === "string") {
      result.detectedTag = parsed.detectedTag;
    }
    if (typeof parsed.version === "number") {
      result.version = parsed.version;
    }
    if (typeof parsed.token === "string") {
      result.token = parsed.token;
    }
    if (typeof parsed.secondsPerDiv === "number") {
      result.secondsPerDiv = parsed.secondsPerDiv;
    }
    if (typeof parsed.needed === "number") {
      result.needed = parsed.needed;
    }
    if (typeof parsed.available === "number") {
      result.available = parsed.available;
    }
    if (typeof parsed.detail === "string") {
      result.detail = parsed.detail;
    }
    return result;
  } catch {
    return null;
  }
}
