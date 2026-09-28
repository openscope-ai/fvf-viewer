/**
 * Main-thread client for the parse worker: request/response correlation
 * over the architecture.md 3.2 IPC protocol, transferring the input
 * ArrayBuffer to the worker on every request.
 */

import { PARSE_FVF, PARSE_SUCCESS } from "./protocol";
import type { ParseFvfRequest, ParseFvfResponse } from "./protocol";
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
    resolve: (capture: ParsedCapture) => void;
    reject: (error: unknown) => void;
  }
>();

function ensureWorker(): Worker {
  if (worker) {
    return worker;
  }
  const instance = createParseWorker();

  instance.addEventListener(
    "message",
    (event: MessageEvent<ParseFvfResponse>) => {
      const message = event.data;
      if (!message) {
        return;
      }
      const entry = pending.get(message.id);
      if (!entry) {
        return;
      }
      pending.delete(message.id);
      if (message.type === PARSE_SUCCESS) {
        entry.resolve(message.capture);
      } else {
        entry.reject(
          new ParseWorkerError(message.code, message.message, message.details),
        );
      }
    },
  );

  const failAll = (reason: string): void => {
    const failure = new ParseWorkerError("worker_error", reason, "");
    for (const entry of pending.values()) {
      entry.reject(failure);
    }
    pending.clear();
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
    pending.set(id, { resolve, reject });
    target.postMessage(
      { type: PARSE_FVF, id, buffer } satisfies ParseFvfRequest,
      transfer,
    );
  });
}
