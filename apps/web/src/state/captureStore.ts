/**
 * Zustand capture slices (issue #9): the parsed capture payload, the
 * parse lifecycle state, and the typed error surface, all driven by the
 * worker-client round-trip. Sample data lands here as standalone
 * `Float32Array`s — never JSON — per architecture.md 3.2.
 */

import { create } from "zustand";
import { ParseWorkerError, parseCaptureBuffer } from "../workers/workerClient";
import type {
  ParseState,
  ParsedCapture,
  StoreErrorCode,
} from "../types/capture";

export interface CaptureError {
  code: StoreErrorCode;
  message: string;
  details: string;
}

export interface CaptureStoreState {
  capture: ParsedCapture | null;
  parseState: ParseState;
  error: CaptureError | null;
  fileName: string | null;
  /** Current monotonic ticket sequence. */
  currentTicket: () => number;
  /** Allocates a new monotonic ticket, immediately invalidating any in-flight reads & parses and transitioning store to parsing. */
  allocateTicket: (fileName?: string) => number;
  /** Transitions store to error if the ticket is still current. */
  failIngestion: (ticket: number, error: unknown, fileName?: string) => void;
  /** Parses `buffer` through the worker; if ticket is provided, enforces that ticket across read and parse. */
  parseBuffer: (
    buffer: ArrayBuffer,
    fileName?: string,
    ticket?: number,
  ) => Promise<void>;
  reset: () => void;
}

/** Monotonic ticket so a stale round-trip never clobbers a newer drop. */
let parseSequence = 0;

export const useCaptureStore = create<CaptureStoreState>((set) => ({
  capture: null,
  parseState: "idle",
  error: null,
  fileName: null,
  currentTicket: () => parseSequence,
  allocateTicket: (fileName?: string) => {
    parseSequence += 1;
    set({
      parseState: "parsing",
      fileName: fileName ?? null,
      error: null,
      capture: null,
    });
    return parseSequence;
  },
  failIngestion: (ticket: number, error: unknown, fileName?: string) => {
    if (ticket !== parseSequence) {
      return;
    }
    const failure: CaptureError =
      error instanceof ParseWorkerError
        ? { code: error.code, message: error.message, details: error.details }
        : {
            code: "worker_error",
            message: error instanceof Error ? error.message : String(error),
            details: "",
          };
    set({
      capture: null,
      parseState: "error",
      error: failure,
      fileName: fileName ?? null,
    });
  },
  parseBuffer: async (buffer, fileName, ticket) => {
    if (ticket === undefined) {
      parseSequence += 1;
      ticket = parseSequence;
      set({
        parseState: "parsing",
        error: null,
        fileName: fileName ?? null,
        capture: null,
      });
    } else if (ticket !== parseSequence) {
      return;
    }
    try {
      const capture = await parseCaptureBuffer(buffer);
      if (ticket !== parseSequence) {
        return;
      }
      set({ capture, parseState: "success", error: null });
    } catch (error) {
      if (ticket !== parseSequence) {
        return;
      }
      const failure: CaptureError =
        error instanceof ParseWorkerError
          ? { code: error.code, message: error.message, details: error.details }
          : {
              code: "worker_error",
              message: error instanceof Error ? error.message : String(error),
              details: "",
            };
      set({ capture: null, parseState: "error", error: failure });
    }
  },
  reset: () => {
    parseSequence += 1;
    set({ capture: null, parseState: "idle", error: null, fileName: null });
  },
}));
