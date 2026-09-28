import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import init, { engine_version } from "@fvf/fvf-wasm";

const wasmBytes = new Uint8Array(
  readFileSync(
    fileURLToPath(
      new URL("../../../crates/fvf-wasm/pkg/fvf_wasm_bg.wasm", import.meta.url),
    ),
  ),
);

describe("fvf-wasm engine module", () => {
  it("initialises from the wasm-pack ES module and reports its version", async () => {
    await init(wasmBytes);

    const version = engine_version();

    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
  });
});
