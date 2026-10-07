/**
 * Wire protocol between the main thread and the dedicated parse worker
 * (architecture.md 3.2): `{ PARSE_FVF } -> { PARSE_SUCCESS | PARSE_ERROR }`
 * with Transferable ArrayBuffers on both hops. The input buffer is
 * transferred main -> worker; the reply carries the worker's standalone
 * sample copies through its transfer list.
 */

import type {
  ParseErrorPayload,
  ParsedCapture,
  StoreErrorCode,
} from "../types/capture";
import { isParseErrorCode } from "../types/capture";

export const PARSE_FVF = "PARSE_FVF";
export const PARSE_SUCCESS = "PARSE_SUCCESS";
export const PARSE_ERROR = "PARSE_ERROR";

export interface ParseFvfRequest {
  type: typeof PARSE_FVF;
  /** Correlation id owned by the main-thread client. */
  id: number;
  /** Raw capture bytes; transferred (detached on the sender side). */
  buffer: ArrayBuffer;
}

export interface ParseSuccessResponse {
  type: typeof PARSE_SUCCESS;
  id: number;
  capture: ParsedCapture;
  /** Number of ArrayBuffers moved through this message's transfer list. */
  transferCount: number;
}

/** Failure body shared by parser rejections and worker infrastructure. */
export interface WorkerErrorResponsePayload {
  code: StoreErrorCode;
  message: string;
  details: string;
}

export type ParseErrorResponse = {
  type: typeof PARSE_ERROR;
  id: number;
} & WorkerErrorResponsePayload;

export type ParseFvfResponse = ParseSuccessResponse | ParseErrorResponse;

// ---------------------------------------------------------------------------
// Unified-timeline resampling (issue #96): a reference capture's sample
// sequence maps onto the primary capture's monotonic time grid inside the
// worker's Wasm engine — never on the main thread.
// ---------------------------------------------------------------------------

export const RESAMPLE_TO_GRID = "RESAMPLE_TO_GRID";
export const RESAMPLE_SUCCESS = "RESAMPLE_SUCCESS";
export const RESAMPLE_ERROR = "RESAMPLE_ERROR";

export interface ResampleToGridRequest {
  type: typeof RESAMPLE_TO_GRID;
  /** Correlation id owned by the main-thread client. */
  id: number;
  /** Reference record's monotonic timestamps (trigger-relative seconds). */
  timestamps: Float32Array;
  /** Reference record's sample values, index-aligned with `timestamps`. */
  values: Float32Array;
  /** Primary capture's monotonic time grid to interpolate onto. */
  grid: Float32Array;
}

export interface ResampleSuccessResponse {
  type: typeof RESAMPLE_SUCCESS;
  id: number;
  /** Resampled lane, index-aligned with the requested grid. */
  values: Float32Array;
  transferCount: number;
}

export type ResampleErrorResponse = {
  type: typeof RESAMPLE_ERROR;
  id: number;
} & WorkerErrorResponsePayload;

export type ResampleResponse = ResampleSuccessResponse | ResampleErrorResponse;

export type WorkerRequest = ParseFvfRequest | ResampleToGridRequest;
export type WorkerResponse = ParseFvfResponse | ResampleResponse;

export function isParseErrorPayload(
  value: unknown,
): value is ParseErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    "details" in value &&
    isParseErrorCode((value as { code: unknown }).code) &&
    typeof (value as { message: unknown }).message === "string" &&
    typeof (value as { details: unknown }).details === "string"
  );
}
