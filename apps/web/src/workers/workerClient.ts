/**
 * Main-thread client for the parse worker: request/response correlation
 * over the architecture.md 3.2 IPC protocol, transferring the input
 * ArrayBuffer to the worker on every request.
 */

import {
  PARSE_FVF,
  PARSE_SUCCESS,
  RESAMPLE_SUCCESS,
  RESAMPLE_TO_GRID,
} from "./protocol";
import type {
  ParseFvfRequest,
  ResampleResponse,
  ResampleToGridRequest,
  WorkerResponse,
} from "./protocol";
import type { ParsedCapture, StoreErrorCode } from "../types/capture";

/** Typed parse failure raised into main-thread callers. */
export class ParseWorkerError extends Error {
  readonly code: StoreErrorCode;
  readonly details: string;

  constructor(code: StoreErrorCode, message: string, details: string) {
    super(message);
    this.name = "ParseWorkerError";
    this.code = code;
    this.details = details;
  }
}

/** Spawns a fresh parse worker (Vite resolves the module URL). */
export function createParseWorker(): Worker {
  return new Worker(new URL("./parse.worker.ts", import.meta.url), {
    type: "module",
  });
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  {
    resolve: (value: ParsedCapture | Float32Array) => void;
    reject: (error: unknown) => void;
  }
>();

function rejectEntry(id: number, error: unknown): void {
  const entry = pending.get(id);
  if (!entry) {
    return;
  }
  pending.delete(id);
  entry.reject(error);
}

function ensureWorker(): Worker {
  if (worker) {
    return worker;
  }
  const instance = createParseWorker();

  instance.addEventListener(
    "message",
    (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (!message) {
        return;
      }
      if (message.type === PARSE_SUCCESS || message.type === "PARSE_ERROR") {
        const entry = pending.get(message.id);
        if (!entry) {
          return;
        }
        pending.delete(message.id);
        if (message.type === PARSE_SUCCESS) {
          entry.resolve(message.capture);
        } else {
          entry.reject(
            new ParseWorkerError(
              message.code,
              message.message,
              message.details,
            ),
          );
        }
        return;
      }
      const resample = message as ResampleResponse;
      if (
        resample.type === RESAMPLE_SUCCESS ||
        resample.type === "RESAMPLE_ERROR"
      ) {
        const entry = pending.get(resample.id);
        if (!entry) {
          return;
        }
        pending.delete(resample.id);
        if (resample.type === RESAMPLE_SUCCESS) {
          entry.resolve(resample.values);
        } else {
          entry.reject(
            new ParseWorkerError(
              resample.code,
              resample.message,
              resample.details,
            ),
          );
        }
      }
    },
  );

  const failAll = (reason: string): void => {
    const failure = new ParseWorkerError("worker_error", reason, "");
    for (const id of [...pending.keys()]) {
      rejectEntry(id, failure);
    }
  };
  instance.addEventListener("error", (event: ErrorEvent) => {
    event.preventDefault();
    failAll(event.message || "parse worker crashed");
  });
  instance.addEventListener("messageerror", () => {
    failAll("parse worker received an unserializable message");
  });

  worker = instance;
  return instance;
}

/**
 * Parses one capture off the main thread. `buffer` (and anything else in
 * `transfer`) is transferred to the worker and therefore detached once
 * the request is posted.
 */
export function parseCaptureBuffer(
  buffer: ArrayBuffer,
  transfer: Transferable[] = [buffer],
): Promise<ParsedCapture> {
  const target = ensureWorker();
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve: resolve as (value: ParsedCapture | Float32Array) => void,
      reject,
    });
    target.postMessage(
      { type: PARSE_FVF, id, buffer } satisfies ParseFvfRequest,
      transfer,
    );
  });
}

/**
 * Issue #96: resamples one reference lane onto the primary capture's
 * time grid inside the worker's Wasm engine. The input arrays are
 * structured-cloned (small) or transferred when the caller passes a
 * transfer list; the returned lane is a standalone Float32Array
 * index-aligned with `grid`.
 */
export function resampleToGrid(
  timestamps: Float32Array,
  values: Float32Array,
  grid: Float32Array,
  transfer: Transferable[] = [],
): Promise<Float32Array> {
  const target = ensureWorker();
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve: resolve as (value: ParsedCapture | Float32Array) => void,
      reject,
    });
    target.postMessage(
      {
        type: RESAMPLE_TO_GRID,
        id,
        timestamps,
        values,
        grid,
      } satisfies ResampleToGridRequest,
      transfer,
    );
  });
}
