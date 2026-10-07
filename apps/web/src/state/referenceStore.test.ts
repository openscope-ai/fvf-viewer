import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedCapture } from "../types/capture";
import type { ParseState } from "../types/capture";

/**
 * Issue #96: the File 2 comparison slot — parse + Wasm resample onto
 * File 1's grid (worker mocked), Ref-A naming, independent visibility,
 * error landing, ticket supersession, and clear semantics.
 */

const parseCaptureBuffer = vi.hoisted(() => vi.fn());
const resampleToGrid = vi.hoisted(() => vi.fn());

vi.mock("../workers/workerClient", () => ({
  parseCaptureBuffer: parseCaptureBuffer,
  resampleToGrid: resampleToGrid,
}));

function makeCapture(names: string[], samples: number): ParsedCapture {
  const channels = names.map((name) => ({
    name,
    label: `Input ${name}`,
    derived: false,
    data: Float32Array.from({ length: samples }, (_, i) => i),
  }));
  return {
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "1 ms/Div",
      secondsPerDiv: 1e-3,
      timestamp14: "20260101120000",
      samples,
      deltaT: 1e-3,
      channels: channels.map((c) => ({
        name: c.name,
        label: c.label,
        derived: false,
        samples,
        deltaT: 1e-3,
        unit: "V",
      })),
    },
    channels,
    derivedChannels: [],
    timestamps: Float32Array.from({ length: samples }, (_, i) => i * 1e-3),
    warnings: [],
  };
}

async function importStores() {
  const reference = await import("./referenceStore");
  const capture = await import("./captureStore");
  return { reference, capture };
}

describe("referenceStore (issue #96)", () => {
  beforeEach(() => {
    vi.resetModules();
    parseCaptureBuffer.mockReset();
    resampleToGrid.mockReset();
  });

  it("parses File 2, resamples onto File 1's grid, and names channels Ref-*", async () => {
    const { reference, capture } = await importStores();
    const primary = makeCapture(["A", "B"], 100);
    capture.useCaptureStore.setState({ capture: primary });

    const fileTwo = makeCapture(["A", "B"], 50);
    parseCaptureBuffer.mockResolvedValue(fileTwo);
    resampleToGrid.mockImplementation(
      async (_ts: Float32Array, values: Float32Array, grid: Float32Array) => {
        expect(grid).toBe(primary.timestamps);
        return new Float32Array(grid.length).fill(1);
      },
    );

    await reference.useReferenceStore
      .getState()
      .parseReferenceBuffer(new ArrayBuffer(8), "file2.fvf");

    const state = reference.useReferenceStore.getState();
    expect(state.parseState).toBe("success" as ParseState);
    expect(state.fileName).toBe("file2.fvf");
    expect(state.capture).toBe(fileTwo);
    expect(state.lanes).toHaveLength(2);
    expect(state.refActiveChannels).toEqual(["Ref-A", "Ref-B"]);

    // File 1 untouched.
    expect(capture.useCaptureStore.getState().capture).toBe(primary);
    expect(capture.useCaptureStore.getState().parseState).toBe("idle");
  });

  it("lands typed errors without touching a loaded reference", async () => {
    const { reference } = await importStores();
    parseCaptureBuffer.mockRejectedValue(new Error("bad signature"));
    await reference.useReferenceStore
      .getState()
      .parseReferenceBuffer(new ArrayBuffer(8), "broken.fvf");
    const state = reference.useReferenceStore.getState();
    expect(state.parseState).toBe("error");
    expect(state.error?.message).toContain("bad signature");
    expect(state.capture).toBeNull();
  });

  it("requires an active primary capture", async () => {
    const { reference, capture } = await importStores();
    capture.useCaptureStore.setState({ capture: null });
    parseCaptureBuffer.mockResolvedValue(makeCapture(["A"], 10));
    await reference.useReferenceStore
      .getState()
      .parseReferenceBuffer(new ArrayBuffer(8), "orphan.fvf");
    expect(reference.useReferenceStore.getState().error?.message).toContain(
      "No active capture",
    );
  });

  it("superseded loads never land (ticket guard)", async () => {
    const { reference, capture } = await importStores();
    capture.useCaptureStore.setState({ capture: makeCapture(["A"], 10) });
    let releaseSlow: (value: ParsedCapture) => void = () => {};
    const slow = new Promise<ParsedCapture>((resolve) => {
      releaseSlow = resolve;
    });
    parseCaptureBuffer.mockReturnValueOnce(slow);
    parseCaptureBuffer.mockResolvedValueOnce(makeCapture(["A"], 5));

    const first = reference.useReferenceStore
      .getState()
      .parseReferenceBuffer(new ArrayBuffer(8), "slow.fvf");
    await reference.useReferenceStore
      .getState()
      .parseReferenceBuffer(new ArrayBuffer(8), "fast.fvf");
    releaseSlow(makeCapture(["A"], 20));
    await first;

    expect(reference.useReferenceStore.getState().fileName).toBe("fast.fvf");
  });

  it("toggles independent reference visibility and clears wholesale", async () => {
    const { reference } = await importStores();
    reference.useReferenceStore.setState({
      capture: makeCapture(["A", "B"], 10),
      lanes: [new Float32Array(10), new Float32Array(10)],
      refActiveChannels: ["Ref-A", "Ref-B"],
    });
    reference.useReferenceStore.getState().toggleRefChannel("Ref-A");
    expect(reference.useReferenceStore.getState().refActiveChannels).toEqual([
      "Ref-B",
    ]);
    reference.useReferenceStore
      .getState()
      .setRefActiveChannels(["Ref-A", "Ref-B"]);
    expect(reference.useReferenceStore.getState().refActiveChannels).toEqual([
      "Ref-A",
      "Ref-B",
    ]);
    reference.useReferenceStore.getState().clear();
    expect(reference.useReferenceStore.getState().capture).toBeNull();
    expect(reference.useReferenceStore.getState().lanes).toBeNull();
    expect(reference.useReferenceStore.getState().refActiveChannels).toEqual(
      [],
    );
  });

  it("resolves display names across both slots (findChannelByName)", async () => {
    const { reference, capture } = await importStores();
    const primary = makeCapture(["A", "B"], 10);
    const fileTwo = makeCapture(["C"], 10);
    capture.useCaptureStore.setState({ capture: primary });
    reference.useReferenceStore.setState({
      capture: fileTwo,
      lanes: [new Float32Array(10)],
      refActiveChannels: ["Ref-C"],
    });

    const primaryHit = reference.findChannelByName("A");
    expect(primaryHit?.capture).toBe(primary);
    const refHit = reference.findChannelByName("Ref-C");
    expect(refHit?.capture).toBe(fileTwo);
    expect(refHit?.channel.name).toBe("C");
    expect(reference.findChannelByName("Ref-D")).toBeNull();

    // Scale keys: primary y0…, reference trails after the primary count.
    expect(reference.channelScaleKeyFor("A")).toBe("y0");
    expect(reference.channelScaleKeyFor("Ref-C")).toBe("y2");
  });
});
