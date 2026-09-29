import { describe, expect, it, vi } from "vitest";
import {
  isCanvasReadbackAllowed,
  verifyCanvasReadback,
} from "./canvasPermission";

describe("canvasPermission canary detector (issue #84)", () => {
  it("returns true when canvas readback exactly matches authored pixels", () => {
    const mockCanvas = document.createElement("canvas");
    expect(isCanvasReadbackAllowed(mockCanvas)).toBe(true);
  });

  it("returns false when alpha is spoofed / semi-transparent (RFP noise)", () => {
    const mockCanvas = document.createElement("canvas");
    const fakeCtx = {
      fillStyle: "",
      fillRect: vi.fn(),
      getImageData: vi.fn().mockReturnValue({
        data: new Uint8ClampedArray([
          18,
          52,
          86,
          128, // spoofed alpha
          18,
          52,
          86,
          128,
          18,
          52,
          86,
          128,
          18,
          52,
          86,
          128,
        ]),
      }),
    };
    vi.spyOn(mockCanvas, "getContext").mockReturnValue(
      fakeCtx as unknown as CanvasRenderingContext2D,
    );

    expect(isCanvasReadbackAllowed(mockCanvas)).toBe(false);
  });

  it("returns false when RGB values are perturbed / dummy pattern", () => {
    const mockCanvas = document.createElement("canvas");
    const fakeCtx = {
      fillStyle: "",
      fillRect: vi.fn(),
      getImageData: vi.fn().mockReturnValue({
        data: new Uint8ClampedArray([
          20,
          52,
          86,
          255, // altered R
          18,
          52,
          86,
          255,
          18,
          52,
          86,
          255,
          18,
          52,
          86,
          255,
        ]),
      }),
    };
    vi.spyOn(mockCanvas, "getContext").mockReturnValue(
      fakeCtx as unknown as CanvasRenderingContext2D,
    );

    expect(isCanvasReadbackAllowed(mockCanvas)).toBe(false);
  });

  it("returns false when getImageData throws SecurityError", () => {
    const mockCanvas = document.createElement("canvas");
    const fakeCtx = {
      fillStyle: "",
      fillRect: vi.fn(),
      getImageData: vi.fn().mockImplementation(() => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      }),
    };
    vi.spyOn(mockCanvas, "getContext").mockReturnValue(
      fakeCtx as unknown as CanvasRenderingContext2D,
    );

    expect(isCanvasReadbackAllowed(mockCanvas)).toBe(false);
  });

  it("returns false when getContext returns null", () => {
    const mockCanvas = document.createElement("canvas");
    vi.spyOn(mockCanvas, "getContext").mockReturnValue(null);

    expect(isCanvasReadbackAllowed(mockCanvas)).toBe(false);
  });

  it("verifyCanvasReadback resolves matching boolean", async () => {
    const mockCanvas = document.createElement("canvas");
    await expect(verifyCanvasReadback(mockCanvas)).resolves.toBe(true);
  });
});
