import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractFirstFile, useFileIngestion } from "./useFileIngestion";
import { useCaptureStore } from "../state/captureStore";
import { parseCaptureBuffer } from "../workers/workerClient";

vi.mock("../workers/workerClient", () => {
  return {
    parseCaptureBuffer: vi.fn(),
    ParseWorkerError: class ParseWorkerError extends Error {
      readonly code: string;
      readonly details: string;
      constructor(code: string, message: string, details: string) {
        super(message);
        this.name = "ParseWorkerError";
        this.code = code;
        this.details = details;
      }
    },
  };
});

function renderHook<T>(hook: () => T): { result: { current: T } } {
  const result = { current: undefined as unknown as T };
  function Component() {
    result.current = hook();
    return null;
  }
  renderToStaticMarkup(React.createElement(Component));
  return { result };
}

describe("useFileIngestion logic (node)", () => {
  const originalParseBuffer = useCaptureStore.getState().parseBuffer;

  beforeEach(() => {
    useCaptureStore.setState({ parseBuffer: originalParseBuffer });
    useCaptureStore.getState().reset();
  });

  describe("extractFirstFile", () => {
    it("returns null for empty or null inputs", () => {
      expect(extractFirstFile(null)).toBeNull();
      expect(extractFirstFile(undefined)).toBeNull();
      expect(extractFirstFile([])).toBeNull();
    });

    it("selects the first file when multiple files are provided", () => {
      const file1 = new File(["sample1"], "first.fvf");
      const file2 = new File(["sample2"], "second.fvf");
      const file3 = new File(["sample3"], "third.fvf");

      const selected = extractFirstFile([file1, file2, file3]);
      expect(selected).toBe(file1);
      expect(selected?.name).toBe("first.fvf");
    });
  });

  describe("ingestion and extension filter neutrality", () => {
    it("passes non-.fvf files to the parser without extension pre-filtering", async () => {
      const parseBufferSpy = vi.fn().mockResolvedValue(undefined);
      useCaptureStore.setState({ parseBuffer: parseBufferSpy });

      const { result } = renderHook(() => useFileIngestion());

      const textFile = new File(["not a fvf payload"], "notes.txt", {
        type: "text/plain",
      });

      await result.current.ingestFiles([textFile]);

      expect(parseBufferSpy).toHaveBeenCalledTimes(1);
      expect(parseBufferSpy).toHaveBeenCalledWith(
        expect.any(ArrayBuffer),
        "notes.txt",
        expect.any(Number),
      );
    });

    it("always chooses the first file from multi-file collections via ingestFiles", async () => {
      const parseBufferSpy = vi.fn().mockResolvedValue(undefined);
      useCaptureStore.setState({ parseBuffer: parseBufferSpy });

      const { result } = renderHook(() => useFileIngestion());

      const file1 = new File(["capture 1"], "capture1.fvf");
      const file2 = new File(["capture 2"], "capture2.fvf");

      await result.current.ingestFiles([file1, file2]);

      expect(parseBufferSpy).toHaveBeenCalledTimes(1);
      expect(parseBufferSpy).toHaveBeenCalledWith(
        expect.any(ArrayBuffer),
        "capture1.fvf",
        expect.any(Number),
      );
    });

    it("discards stale asynchronous file reads if a newer file ingestion begins before read finishes", async () => {
      const parseBufferSpy = vi.fn().mockResolvedValue(undefined);
      useCaptureStore.setState({ parseBuffer: parseBufferSpy });

      const { result } = renderHook(() => useFileIngestion());

      let resolveSlowFile: (buf: ArrayBuffer) => void = () => {};
      const slowPromise = new Promise<ArrayBuffer>((res) => {
        resolveSlowFile = res;
      });
      const slowFile = new File(["slow"], "slow.fvf");
      vi.spyOn(slowFile, "arrayBuffer").mockImplementation(() => slowPromise);

      const fastFile = new File(["fast"], "fast.fvf");

      const ingest1 = result.current.ingestFile(slowFile);
      const ingest2 = result.current.ingestFile(fastFile);

      await ingest2;
      expect(parseBufferSpy).toHaveBeenCalledTimes(1);
      expect(parseBufferSpy).toHaveBeenCalledWith(
        expect.any(ArrayBuffer),
        "fast.fvf",
        expect.any(Number),
      );

      resolveSlowFile(new ArrayBuffer(4));
      await ingest1;

      expect(parseBufferSpy).toHaveBeenCalledTimes(1);
    });

    it("F5: invalidates an in-flight slow parse of File A when File B starts reading, preventing File A from committing even if File B read fails", async () => {
      const mockCaptureA = {
        metadata: {
          version: 1,
          flavor: "synthetic",
          timebaseRaw: "10 ms/Div",
          secondsPerDiv: 0.01,
          timestamp14: "20260905120000",
          samples: 100,
          deltaT: 0.001,
          channels: [],
        },
        channels: [],
        derivedChannels: [],
        timestamps: new Float32Array(100),
        warnings: [],
      } as unknown as import("../types/capture").ParsedCapture;

      let resolveParseA: (capture: typeof mockCaptureA) => void = () => {};
      const pendingParsePromiseA = new Promise<typeof mockCaptureA>((res) => {
        resolveParseA = res;
      });

      let parseStartedA: () => void = () => {};
      const parseStartedAPromise = new Promise<void>((res) => {
        parseStartedA = res;
      });

      // Mock parseCaptureBuffer through captureStore
      vi.mocked(parseCaptureBuffer).mockImplementation(() => {
        parseStartedA();
        return pendingParsePromiseA;
      });

      const { result } = renderHook(() => useFileIngestion());

      const fileA = new File(["payload A"], "fileA.fvf");
      // File A starts and enters parseBuffer()
      const ingestA = result.current.ingestFile(fileA);
      // Wait until parseBuffer has actually started and entered worker parse
      await parseStartedAPromise;
      expect(useCaptureStore.getState().parseState).toBe("parsing");
      expect(useCaptureStore.getState().fileName).toBe("fileA.fvf");

      // Now File B is selected, but fails reading arrayBuffer()
      const fileB = new File(["payload B"], "fileB.fvf");
      vi.spyOn(fileB, "arrayBuffer").mockRejectedValue(
        new Error("Disk read error"),
      );
      const ingestB = result.current.ingestFile(fileB);
      await ingestB;

      // Now File A's worker parse resolves
      resolveParseA(mockCaptureA);
      await ingestA;
      // File A must NOT have committed to the store because File B invalidated it on selection.
      // Furthermore, store must reflect File B's error state, not be stuck in parsing for File A.
      expect(useCaptureStore.getState().capture).toBeNull();
      expect(useCaptureStore.getState().parseState).toBe("error");
      expect(useCaptureStore.getState().error?.message).toBe("Disk read error");
      expect(useCaptureStore.getState().fileName).toBe("fileB.fvf");
    });

    it("F6: ensures parseState, error, fileName, and capture remain consistent when read fails after earlier parse", async () => {
      const mockCapturePrior = {
        metadata: {
          version: 1,
          flavor: "synthetic",
          timebaseRaw: "10 ms/Div",
          secondsPerDiv: 0.01,
          timestamp14: "20260905120000",
          samples: 100,
          deltaT: 0.001,
          channels: [],
        },
        channels: [],
        derivedChannels: [],
        timestamps: new Float32Array(100),
        warnings: [],
      } as unknown as import("../types/capture").ParsedCapture;

      // Simulate prior active capture in store
      useCaptureStore.setState({
        capture: mockCapturePrior,
        parseState: "success",
        fileName: "prior.fvf",
        error: null,
      });

      const { result } = renderHook(() => useFileIngestion());

      const fileFail = new File(["broken"], "broken.fvf");
      vi.spyOn(fileFail, "arrayBuffer").mockRejectedValue(
        new Error("Permission denied"),
      );

      await result.current.ingestFile(fileFail);

      const state = useCaptureStore.getState();
      expect(state.parseState).toBe("error");
      expect(state.error?.message).toBe("Permission denied");
      expect(state.fileName).toBe("broken.fvf");
      expect(state.capture).toBeNull();
    });

    it("F5: File A fast read / slow parse + File B slow read commits File B when File B completes", async () => {
      const mockCaptureA = {
        metadata: {
          version: 1,
          flavor: "synthetic",
          timebaseRaw: "10 ms/Div",
          secondsPerDiv: 0.01,
          timestamp14: "20260905120000",
          samples: 100,
          deltaT: 0.001,
          channels: [],
        },
        channels: [],
        derivedChannels: [],
        timestamps: new Float32Array(100),
        warnings: [],
      } as unknown as import("../types/capture").ParsedCapture;

      const mockCaptureB = {
        metadata: {
          version: 1,
          flavor: "synthetic",
          timebaseRaw: "20 ms/Div",
          secondsPerDiv: 0.02,
          timestamp14: "20260905120001",
          samples: 200,
          deltaT: 0.002,
          channels: [],
        },
        channels: [],
        derivedChannels: [],
        timestamps: new Float32Array(200),
        warnings: [],
      } as unknown as import("../types/capture").ParsedCapture;

      let resolveParseA: (capture: typeof mockCaptureA) => void = () => {};
      const pendingParsePromiseA = new Promise<typeof mockCaptureA>((res) => {
        resolveParseA = res;
      });

      let parseStartedA: () => void = () => {};
      const parseStartedAPromise = new Promise<void>((res) => {
        parseStartedA = res;
      });

      let resolveReadB: (buf: ArrayBuffer) => void = () => {};
      const pendingReadPromiseB = new Promise<ArrayBuffer>((res) => {
        resolveReadB = res;
      });

      vi.mocked(parseCaptureBuffer).mockImplementation(async (buffer) => {
        if (buffer.byteLength === 11) {
          parseStartedA();
          return pendingParsePromiseA;
        }
        return mockCaptureB;
      });

      const { result } = renderHook(() => useFileIngestion());

      const fileA = new File(["payload A11"], "fileA.fvf"); // length 11
      const ingestA = result.current.ingestFile(fileA);
      await parseStartedAPromise;

      const fileB = new File(["payload B222"], "fileB.fvf");
      vi.spyOn(fileB, "arrayBuffer").mockImplementation(
        () => pendingReadPromiseB,
      );
      const ingestB = result.current.ingestFile(fileB);

      // File A's parse completes while B is still reading arrayBuffer
      resolveParseA(mockCaptureA);
      await ingestA;

      // File A was discarded!
      expect(useCaptureStore.getState().capture).toBeNull();

      // Now File B's read completes
      resolveReadB(new ArrayBuffer(12));
      await ingestB;

      // File B committed!
      expect(useCaptureStore.getState().capture).toBe(mockCaptureB);
      expect(useCaptureStore.getState().fileName).toBe("fileB.fvf");
    });
  });
});
