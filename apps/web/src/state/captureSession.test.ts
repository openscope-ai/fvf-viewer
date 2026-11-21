import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedCapture } from "../types/capture";
import { useBadgePopoverStore } from "../components/toolbar/badgeConfig/anchoredPopover";
import { useCaptureStore } from "./captureStore";
import { useChannelDisplayStore } from "./channelDisplayStore";
import { useChannelNamesStore } from "./channelNamesStore";
import { computeDefaultSampleIndices, useCursorStore } from "./cursorStore";
import { useLaneLayoutStore } from "./laneLayoutStore";
import { useReferenceStore } from "./referenceStore";
import { useViewportStore } from "./viewportStore";
import { useZoomHistoryStore } from "./zoomHistoryStore";
import {
  beginPrimaryIngestion,
  CaptureSession,
  clearReference,
  clearSolo,
  ingestPrimary,
  ingestReference,
  resetSession,
  resetView,
  returnToLanding,
  toggleSolo,
} from "./captureSession";

const parseCaptureBuffer = vi.hoisted(() => vi.fn());
const resampleToGrid = vi.hoisted(() => vi.fn());

vi.mock("../workers/workerClient", () => ({
  ParseWorkerError: class ParseWorkerError extends Error {
    code: string;
    details: string;
    constructor(code: string, message: string, details = "") {
      super(message);
      this.code = code;
      this.details = details;
    }
  },
  parseCaptureBuffer,
  resampleToGrid,
}));

function stubStorage(): Map<string, string> {
  const backing = new Map<string, string>();
  (
    globalThis as unknown as {
      window: {
        localStorage: {
          getItem: (key: string) => string | null;
          setItem: (key: string, value: string) => void;
          removeItem: (key: string) => void;
        };
      };
    }
  ).window = {
    localStorage: {
      getItem: (key) => backing.get(key) ?? null,
      setItem: (key, value) => void backing.set(key, value),
      removeItem: (key) => void backing.delete(key),
    },
  };
  return backing;
}

function makeCapture(
  names: string[],
  samples: number,
  timestamp14 = "20260101120000",
): ParsedCapture {
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
      timestamp14,
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
    warnings: [],
    timestamps: Float32Array.from({ length: samples }, (_, i) => i * 1e-3),
  };
}

describe("CaptureSession coordinator (issue #357)", () => {
  beforeEach(() => {
    stubStorage();
    parseCaptureBuffer.mockReset();
    resampleToGrid.mockReset();
    resetSession();
  });

  it("exposes all lifecycle transitions on CaptureSession", () => {
    expect(CaptureSession.ingestPrimary).toBe(ingestPrimary);
    expect(CaptureSession.ingestReference).toBe(ingestReference);
    expect(CaptureSession.clearReference).toBe(clearReference);
    expect(CaptureSession.resetView).toBe(resetView);
    expect(CaptureSession.returnToLanding).toBe(returnToLanding);
    expect(CaptureSession.resetSession).toBe(resetSession);
    expect(CaptureSession.toggleSolo).toBe(toggleSolo);
    expect(CaptureSession.clearSolo).toBe(clearSolo);
  });

  it("ingestPrimary updates per-file keys, initializes cursors/selection, resets zoom history, and drops prior comparison & solo", async () => {
    const primary1 = makeCapture(["A", "B"], 100, "20260101120000");
    const ref1 = makeCapture(["A"], 100, "20260101130000");
    const primary2 = makeCapture(["C", "D"], 200, "20260102120000");

    parseCaptureBuffer.mockResolvedValueOnce(primary1);
    await ingestPrimary(new ArrayBuffer(8), "file1.fvf");

    expect(useCaptureStore.getState().capture).toBe(primary1);
    expect(useChannelNamesStore.getState().fileKey).toBe(
      "file1.fvf::20260101120000",
    );
    expect(useLaneLayoutStore.getState().fileKey).toBe(
      "file1.fvf::20260101120000",
    );
    expect(useChannelDisplayStore.getState().fileKey).toBe(
      "file1.fvf::20260101120000",
    );
    expect(useViewportStore.getState().selectedChannel).toBe("A");
    expect(useCursorStore.getState().c1SampleIndex).toBe(
      computeDefaultSampleIndices(100).c1Index,
    );
    expect(useCursorStore.getState().c2SampleIndex).toBe(
      computeDefaultSampleIndices(100).c2Index,
    );

    // Load a reference capture, push zoom history, solo A, and add ref lane weight.
    parseCaptureBuffer.mockResolvedValueOnce(ref1);
    resampleToGrid.mockResolvedValueOnce(new Float32Array(100));
    await ingestReference(new ArrayBuffer(8), "ref1.fvf");
    useLaneLayoutStore.getState().setWeights({ A: 1.5, "Ref-A": 2.0 });
    useZoomHistoryStore.getState().push({ x: { min: 0, max: 0.05 }, y: {} });
    useZoomHistoryStore.getState().push({ x: { min: 0.01, max: 0.03 }, y: {} });
    toggleSolo("A");
    expect(useViewportStore.getState().activeChannels).toEqual(["A"]);
    expect(useReferenceStore.getState().capture).toBe(ref1);
    expect(useZoomHistoryStore.getState().canGoBack).toBe(true);

    // Replacing File 1 atomically clears reference, solo, zoom history, and updates keys + selection.
    parseCaptureBuffer.mockResolvedValueOnce(primary2);
    await ingestPrimary(new ArrayBuffer(8), "file2.fvf");

    expect(useCaptureStore.getState().capture).toBe(primary2);
    expect(useReferenceStore.getState().capture).toBeNull();
    expect(useChannelNamesStore.getState().refFileKey).toBeNull();
    expect(useChannelDisplayStore.getState().solo).toBeNull();
    expect(useViewportStore.getState().activeChannels).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(useViewportStore.getState().selectedChannel).toBe("C");
    expect(useCursorStore.getState().c1SampleIndex).toBe(
      computeDefaultSampleIndices(200).c1Index,
    );
    expect(useCursorStore.getState().c2SampleIndex).toBe(
      computeDefaultSampleIndices(200).c2Index,
    );
    expect(useZoomHistoryStore.getState().canGoBack).toBe(false);
    expect(useChannelNamesStore.getState().fileKey).toBe(
      "file2.fvf::20260102120000",
    );
    expect(useLaneLayoutStore.getState().fileKey).toBe(
      "file2.fvf::20260102120000",
    );
    expect(useChannelDisplayStore.getState().fileKey).toBe(
      "file2.fvf::20260102120000",
    );
  });

  it("ingestReference sets refFileKey and clears stale Ref-* display transforms", async () => {
    const primary = makeCapture(["A", "B"], 50);
    const ref = makeCapture(["A", "B"], 50, "20260105090000");

    parseCaptureBuffer.mockResolvedValueOnce(primary);
    await ingestPrimary(new ArrayBuffer(8), "primary.fvf");

    useChannelDisplayStore.getState().setYScale("A", 150);
    useChannelDisplayStore.getState().setYScale("Ref-A", 200);

    parseCaptureBuffer.mockResolvedValueOnce(ref);
    resampleToGrid.mockResolvedValue(new Float32Array(50));
    await ingestReference(new ArrayBuffer(8), "compare.fvf");

    expect(useReferenceStore.getState().capture).toBe(ref);
    expect(useChannelNamesStore.getState().refFileKey).toBe(
      "compare.fvf::20260105090000",
    );
    expect(useChannelDisplayStore.getState().keyConfigs.A?.yScalePercent).toBe(
      150,
    );
    expect(
      useChannelDisplayStore.getState().keyConfigs["Ref-A"],
    ).toBeUndefined();
  });

  it("clearReference closes open Ref-* popover, clears ref store/transforms/key, and drops Ref-* lane weights", async () => {
    const primary = makeCapture(["A", "B"], 50);
    const ref = makeCapture(["A"], 50, "20260105090000");

    parseCaptureBuffer.mockResolvedValueOnce(primary);
    await ingestPrimary(new ArrayBuffer(8), "primary.fvf");
    parseCaptureBuffer.mockResolvedValueOnce(ref);
    resampleToGrid.mockResolvedValueOnce(new Float32Array(50));
    await ingestReference(new ArrayBuffer(8), "compare.fvf");

    useBadgePopoverStore.getState().setOpen("channel:Ref-A");
    useChannelDisplayStore.getState().setYScale("A", 150);
    useChannelDisplayStore.getState().setYScale("Ref-A", 200);
    useLaneLayoutStore.getState().setWeights({ A: 1.5, "Ref-A": 2.0 });

    clearReference();

    expect(useBadgePopoverStore.getState().openKey).toBeNull();
    expect(useReferenceStore.getState().capture).toBeNull();
    expect(useChannelNamesStore.getState().refFileKey).toBeNull();
    expect(
      useChannelDisplayStore.getState().keyConfigs["Ref-A"],
    ).toBeUndefined();
    expect(useChannelDisplayStore.getState().keyConfigs.A?.yScalePercent).toBe(
      150,
    );
    expect(useLaneLayoutStore.getState().weights).toEqual({ A: 1.5 });
  });

  it("toggleSolo and clearSolo coordinate both primary and reference visibility", async () => {
    const primary = makeCapture(["A", "B"], 50);
    const ref = makeCapture(["A", "B"], 50, "20260105090000");

    parseCaptureBuffer.mockResolvedValueOnce(primary);
    await ingestPrimary(new ArrayBuffer(8), "primary.fvf");
    parseCaptureBuffer.mockResolvedValueOnce(ref);
    resampleToGrid.mockResolvedValue(new Float32Array(50));
    await ingestReference(new ArrayBuffer(8), "compare.fvf");

    toggleSolo("Ref-B");
    expect(useReferenceStore.getState().refActiveChannels).toEqual(["Ref-B"]);
    expect(useChannelDisplayStore.getState().solo).toEqual({
      key: "Ref-B",
      savedActive: ["Ref-A", "Ref-B"],
    });

    clearSolo();
    expect(useReferenceStore.getState().refActiveChannels).toEqual([
      "Ref-A",
      "Ref-B",
    ]);
    expect(useChannelDisplayStore.getState().solo).toBeNull();
  });

  it("resetView restores transforms, solo, channels, time slip, stack weights, and requests fit", async () => {
    const primary = makeCapture(["A", "B"], 50);
    const ref = makeCapture(["A", "B"], 50, "20260105090000");

    parseCaptureBuffer.mockResolvedValueOnce(primary);
    await ingestPrimary(new ArrayBuffer(8), "primary.fvf");
    parseCaptureBuffer.mockResolvedValueOnce(ref);
    resampleToGrid.mockResolvedValue(new Float32Array(50));
    await ingestReference(new ArrayBuffer(8), "compare.fvf");

    useChannelDisplayStore.getState().setYScale("A", 200);
    useChannelDisplayStore.getState().setStackMode(true);
    useLaneLayoutStore.getState().setWeights({ A: 2.0, B: 0.5 });
    useReferenceStore.getState().setTimeSlip(12);
    useReferenceStore.getState().setRefActiveChannels(["Ref-A"]);
    toggleSolo("A");
    const fitBefore = useViewportStore.getState().fitRequest;

    resetView();

    expect(useChannelDisplayStore.getState().keyConfigs).toEqual({});
    expect(useChannelDisplayStore.getState().solo).toBeNull();
    expect(useChannelDisplayStore.getState().stackMode).toBe(true);
    expect(useViewportStore.getState().activeChannels).toEqual(["A", "B"]);
    expect(useReferenceStore.getState().timeSlipSamples).toBe(0);
    expect(useReferenceStore.getState().refActiveChannels).toEqual([
      "Ref-A",
      "Ref-B",
    ]);
    expect(useLaneLayoutStore.getState().weights).toEqual({});
    expect(useViewportStore.getState().fitRequest).toBe(fitBefore + 1);
  });

  it("returnToLanding clears capture, comparison, viewport, cursors, zoom history, solo, and per-file keys", async () => {
    const primary = makeCapture(["A", "B"], 50);
    const ref = makeCapture(["A"], 50, "20260105090000");

    parseCaptureBuffer.mockResolvedValueOnce(primary);
    await ingestPrimary(new ArrayBuffer(8), "primary.fvf");
    parseCaptureBuffer.mockResolvedValueOnce(ref);
    resampleToGrid.mockResolvedValueOnce(new Float32Array(50));
    await ingestReference(new ArrayBuffer(8), "compare.fvf");

    useCursorStore.getState().toggleCursor("C1", 10);
    useZoomHistoryStore.getState().push({ x: { min: 0, max: 0.02 }, y: {} });
    useZoomHistoryStore
      .getState()
      .push({ x: { min: 0.005, max: 0.015 }, y: {} });
    toggleSolo("A");

    returnToLanding();

    expect(useCaptureStore.getState().capture).toBeNull();
    expect(useReferenceStore.getState().capture).toBeNull();
    expect(useCursorStore.getState().c1Active).toBe(false);
    expect(useZoomHistoryStore.getState().canGoBack).toBe(false);
    expect(useChannelDisplayStore.getState().solo).toBeNull();
    expect(useChannelNamesStore.getState().fileKey).toBeNull();
    expect(useLaneLayoutStore.getState().fileKey).toBeNull();
    expect(useChannelDisplayStore.getState().fileKey).toBeNull();
  });

  it("resetSession resets all session stores to clean defaults", async () => {
    const primary = makeCapture(["A", "B"], 50);
    parseCaptureBuffer.mockResolvedValueOnce(primary);
    await ingestPrimary(new ArrayBuffer(8), "primary.fvf");

    useChannelDisplayStore.getState().setYScale("A", 180);
    useChannelDisplayStore.getState().setStackMode(true);
    useBadgePopoverStore.getState().setOpen("channel:A");
    useCursorStore.getState().toggleCursor("C1", 5);

    resetSession();

    expect(useCaptureStore.getState().capture).toBeNull();
    expect(useReferenceStore.getState().capture).toBeNull();
    expect(useViewportStore.getState().activeChannels).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(useCursorStore.getState().c1Active).toBe(false);
    expect(useZoomHistoryStore.getState().canGoBack).toBe(false);
    expect(useChannelDisplayStore.getState().keyConfigs).toEqual({});
    expect(useChannelDisplayStore.getState().stackMode).toBe(false);
    expect(useChannelDisplayStore.getState().solo).toBeNull();
    expect(useChannelNamesStore.getState().fileKey).toBeNull();
    expect(useLaneLayoutStore.getState().fileKey).toBeNull();
    expect(useBadgePopoverStore.getState().openKey).toBeNull();
  });

  it("failed ingestPrimary clears prior reference, solo, Ref transforms/weights, and per-file keys", async () => {
    const primary = makeCapture(["A", "B"], 50, "20260101120000");
    const ref = makeCapture(["A"], 50, "20260101130000");

    parseCaptureBuffer.mockResolvedValueOnce(primary);
    await ingestPrimary(new ArrayBuffer(8), "file1.fvf");
    parseCaptureBuffer.mockResolvedValueOnce(ref);
    resampleToGrid.mockResolvedValueOnce(new Float32Array(50));
    await ingestReference(new ArrayBuffer(8), "ref1.fvf");

    useChannelDisplayStore.getState().setYScale("Ref-A", 200);
    useLaneLayoutStore.getState().setWeights({ A: 1.5, "Ref-A": 2.0 });
    toggleSolo("A");

    parseCaptureBuffer.mockRejectedValueOnce(new Error("corrupt file"));
    await ingestPrimary(new ArrayBuffer(8), "broken.fvf");

    expect(useCaptureStore.getState().parseState).toBe("error");
    expect(useCaptureStore.getState().capture).toBeNull();
    expect(useReferenceStore.getState().capture).toBeNull();
    expect(useChannelNamesStore.getState().fileKey).toBeNull();
    expect(useChannelNamesStore.getState().refFileKey).toBeNull();
    expect(useLaneLayoutStore.getState().fileKey).toBeNull();
    expect(useLaneLayoutStore.getState().weights).toEqual({});
    expect(useChannelDisplayStore.getState().fileKey).toBeNull();
    expect(useChannelDisplayStore.getState().solo).toBeNull();
    expect(
      useChannelDisplayStore.getState().keyConfigs["Ref-A"],
    ).toBeUndefined();
    expect(useViewportStore.getState().activeChannels).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  it("stale ticket in ingestPrimary does not clobber a newer primary load", async () => {
    const primaryNew = makeCapture(["C", "D"], 80, "20260109100000");

    const staleTicket = beginPrimaryIngestion("slow.fvf");
    const freshTicket = beginPrimaryIngestion("fast.fvf");

    parseCaptureBuffer.mockResolvedValueOnce(primaryNew);
    await ingestPrimary(new ArrayBuffer(8), "fast.fvf", freshTicket);

    // Late arrival for staleTicket must be ignored completely.
    await ingestPrimary(new ArrayBuffer(8), "slow.fvf", staleTicket);

    expect(useCaptureStore.getState().capture).toBe(primaryNew);
    expect(useChannelNamesStore.getState().fileKey).toBe(
      "fast.fvf::20260109100000",
    );
  });

  it("failed ingestReference leaves primary capture intact and records reference error", async () => {
    const primary = makeCapture(["A", "B"], 50, "20260101120000");
    parseCaptureBuffer.mockResolvedValueOnce(primary);
    await ingestPrimary(new ArrayBuffer(8), "file1.fvf");

    parseCaptureBuffer.mockRejectedValueOnce(new Error("bad compare"));
    await ingestReference(new ArrayBuffer(8), "bad-ref.fvf");

    expect(useCaptureStore.getState().capture).toBe(primary);
    expect(useReferenceStore.getState().parseState).toBe("error");
    expect(useReferenceStore.getState().capture).toBeNull();
    expect(useChannelNamesStore.getState().refFileKey).toBeNull();
  });
});
