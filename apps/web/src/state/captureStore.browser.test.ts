/**
 * Store-slice tests (issue #9, chromium via Playwright): the Zustand
 * capture/parseState/error slices driven by a real worker round-trip —
 * the store holds transferred Float32Arrays (never JSON), and typed
 * parse failures land with the taxonomy error code.
 */

import { beforeEach, describe, expect, it } from "vitest";
import badMagicUrl from "../../../../crates/fvf-wasm/tests/fixtures/synthetic/rejected-invalid-magic-1ch-1000.fvf.bin?url";
import fourChUrl from "../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import { useCaptureStore } from "./captureStore";

async function fixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching ${url}`).toBeTruthy();
  return response.arrayBuffer();
}

describe("capture store slices (real worker round-trip)", () => {
  beforeEach(() => {
    useCaptureStore.getState().reset();
  });

  it("typed parse failures land in error with the taxonomy code", async () => {
    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(badMagicUrl), "bad.fvf");

    const state = useCaptureStore.getState();
    expect(state.parseState).toBe("error");
    expect(state.error?.code).toBe("invalid_signature");
    expect(state.error?.message.length).toBeGreaterThan(0);
    expect(state.capture).toBeNull();
    expect(state.fileName).toBe("bad.fvf");
  });

  it("successful parses populate the store without JSON serialization", async () => {
    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(fourChUrl), "four.fvf");

    const state = useCaptureStore.getState();
    expect(state.parseState).toBe("success");
    expect(state.error).toBeNull();
    expect(state.capture?.channels.length).toBe(4);
    expect(state.capture?.channels[0]?.data).toBeInstanceOf(Float32Array);
    expect(state.capture?.timestamps).toBeInstanceOf(Float32Array);
    expect(state.capture?.metadata.samples).toBe(10_000);
    expect(state.capture?.metadata.timebaseRaw).toBe("10 ms/Div");
  });
});
