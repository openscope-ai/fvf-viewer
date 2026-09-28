/**
 * Real-Worker IPC tests (issue #9, chromium via Playwright): wire-level
 * transfer assertions on PARSE_SUCCESS payloads, successive-parse
 * survival in one worker session (no detached-ArrayBuffer fallout),
 * typed errors end-to-end, and the 250,000-point main-thread budget
 * (median-of-5 `performance.now()` round-trips; escape hatch
 * `VITE_TEST_TIMING_BUDGET_MS`, controller-only and explicit).
 */

import { describe, expect, it } from "vitest";
import fourChUrl from "../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import deUrl from "../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-de-eingang-1ch-3000-comma-decimal.fvf.bin?url";
import deepUrl from "../../../../crates/fvf-wasm/tests/fixtures/synthetic/extreme-envelope-1ch-250000-10ms-div.fvf.bin?url";
import badMagicUrl from "../../../../crates/fvf-wasm/tests/fixtures/synthetic/rejected-invalid-magic-1ch-1000.fvf.bin?url";
import { PARSE_FVF, PARSE_SUCCESS } from "./protocol";
import type { ParseFvfResponse } from "./protocol";
import {
  ParseWorkerError,
  createParseWorker,
  parseCaptureBuffer,
} from "./workerClient";
import type { ParsedCapture } from "../types/capture";

async function fixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching ${url}`).toBeTruthy();
  return response.arrayBuffer();
}

function postAndAwait(
  worker: Worker,
  buffer: ArrayBuffer,
): Promise<ParseFvfResponse> {
  return new Promise((resolve, reject) => {
    worker.addEventListener(
      "message",
      (event: MessageEvent<ParseFvfResponse>) => resolve(event.data),
      { once: true },
    );
    worker.addEventListener(
      "error",
      (event: ErrorEvent) =>
        reject(new Error(event.message || "worker failed to boot")),
      { once: true },
    );
    worker.postMessage({ type: PARSE_FVF, id: 1, buffer }, [buffer]);
  });
}

describe("parse worker IPC (chromium)", () => {
  it("delivers PARSE_SUCCESS as standalone Float32Arrays", async () => {
    const worker = createParseWorker();
    try {
      const message = await postAndAwait(worker, await fixture(fourChUrl));

      expect(message.type).toBe(PARSE_SUCCESS);
      if (message.type !== PARSE_SUCCESS) {
        return;
      }
      expect(message.transferCount).toBeGreaterThan(0);

      const capture = message.capture;
      expect(capture.timestamps).toBeInstanceOf(Float32Array);
      expect(capture.timestamps.length).toBe(10_000);
      expect(capture.channels.length).toBe(4);
      for (const channel of capture.channels) {
        expect(channel.data).toBeInstanceOf(Float32Array);
        expect(channel.data.length).toBe(10_000);
        // A detached buffer reports byteLength 0 — these must stay live.
        expect(channel.data.byteLength).toBe(40_000);
      }
    } finally {
      worker.terminate();
    }
  });

  it("survives three successive parses in one worker session", async () => {
    const buffers = await Promise.all([
      fixture(fourChUrl),
      fixture(deUrl),
      fixture(deepUrl),
    ]);
    const captures: ParsedCapture[] = [];
    for (const buffer of buffers) {
      captures.push(await parseCaptureBuffer(buffer));
      // The input hop transferred (and detached) every request buffer.
      expect(buffer.byteLength).toBe(0);
    }

    expect(captures.map((capture) => capture.channels.length)).toEqual([
      4, 1, 1,
    ]);
    expect(captures[1]?.metadata.timebaseRaw).toBe("0,1 s/Div");
    expect(captures[2]?.metadata.samples).toBe(250_000);
    // The worker's Wasm instance is still healthy after three transfers.
    expect(captures[2]?.channels[0]?.data.length).toBe(250_000);
    expect(captures[2]?.timestamps.length).toBe(250_000);
  });

  it("surfaces typed parser errors end-to-end (worker -> client)", async () => {
    let observed: unknown;
    try {
      await parseCaptureBuffer(await fixture(badMagicUrl));
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(ParseWorkerError);
    const typed = observed as ParseWorkerError;
    expect(typed.code).toBe("invalid_signature");
    expect(typed.message.length).toBeGreaterThan(0);
    expect(typed.details).toContain("58");
  });

  it("keeps the 250k-point round-trip inside the main-thread budget", async () => {
    const budget = Number(import.meta.env.VITE_TEST_TIMING_BUDGET_MS ?? 16);
    const template = await fixture(deepUrl);

    // Warm-up (worker boot + JIT) is excluded from the measurement.
    await parseCaptureBuffer(template.slice(0));
    const samples: number[] = [];
    for (let round = 0; round < 5; round += 1) {
      const buffer = template.slice(0); // fresh transferable each round
      const start = performance.now();
      await parseCaptureBuffer(buffer);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const median = samples[2] ?? Number.POSITIVE_INFINITY;
    expect(
      median,
      `round-trip medians [${samples.join(", ")}] ms vs budget ${budget} ms`,
    ).toBeLessThan(budget);
  });
});
