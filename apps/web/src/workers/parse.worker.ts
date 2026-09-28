/// <reference lib="webworker" />

/**
 * Dedicated parse worker (architecture.md 3.2): runs the Wasm engine off
 * the main thread, copies decoded sample vectors out of Wasm linear
 * memory (`assembleCapture`), and posts the standalone buffers back
 * through the transfer list. A Wasm-heap-aliasing ArrayBuffer never
 * enters a transfer list — transferring it would detach the entire Wasm
 * memory and kill every subsequent parse in this worker.
 */

import init, { parse_capture } from "@fvf/fvf-wasm";
import wasmUrl from "@fvf/fvf-wasm/fvf_wasm_bg.wasm?url";
import { assembleCapture } from "./capturePayload";
import {
  PARSE_ERROR,
  PARSE_FVF,
  PARSE_SUCCESS,
  isParseErrorPayload,
} from "./protocol";
import type { ParseFvfRequest, WorkerErrorResponsePayload } from "./protocol";
import type { ParseErrorPayload } from "../types/capture";

let engine: Promise<WebAssembly.Memory> | null = null;

function ensureEngine(): Promise<WebAssembly.Memory> {
  engine ??= fetch(wasmUrl)
    .then((response) => response.arrayBuffer())
    .then((bytes) => init(new Uint8Array(bytes)))
    .then((output) => output.memory);
  return engine;
}

function post(message: unknown, transfer?: Transferable[]): void {
  (self as unknown as Worker).postMessage(message, transfer ?? []);
}

/**
 * Decodes the JSON-string error the Wasm boundary throws back into a
 * typed payload; non-parser failures (engine boot, fetch) collapse into
 * the `worker_error` infrastructure code.
 */
function toErrorPayload(
  error: unknown,
): ParseErrorPayload | WorkerErrorResponsePayload {
  if (typeof error === "string") {
    try {
      const parsed: unknown = JSON.parse(error);
      if (isParseErrorPayload(parsed)) {
        return parsed;
      }
    } catch {
      // Not a parser payload — fall through to the opaque report.
    }
  }
  return {
    code: "worker_error",
    message: error instanceof Error ? error.message : String(error),
    details: "",
  };
}

self.addEventListener("message", (event: MessageEvent<ParseFvfRequest>) => {
  const message = event.data;
  if (!message || message.type !== PARSE_FVF) {
    return;
  }

  ensureEngine()
    .then((memory) => {
      const { capture, transfer } = assembleCapture(
        memory,
        parse_capture(new Uint8Array(message.buffer)),
      );
      post(
        {
          type: PARSE_SUCCESS,
          id: message.id,
          capture,
          transferCount: transfer.length,
        },
        transfer,
      );
    })
    .catch((error: unknown) => {
      post({ type: PARSE_ERROR, id: message.id, ...toErrorPayload(error) });
    });
});
