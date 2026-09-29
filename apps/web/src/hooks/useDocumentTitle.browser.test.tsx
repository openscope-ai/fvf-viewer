/**
 * Issues #74, #101, #142: reactive document.title — `<filename> - FVF Viewer`
 * while a capture is loaded (full file extension kept, ASCII hyphen-minus
 * U+002D separator), default brand title `fvf • viewer` on the landing state,
 * after reset, and when ingestion fails.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { documentTitleFor, useDocumentTitle } from "./useDocumentTitle";
import { useCaptureStore } from "../state/captureStore";
import fourChUrl from "../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function HookHost(): null {
  useDocumentTitle();
  return null;
}

async function fixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching ${url}`).toBeTruthy();
  return response.arrayBuffer();
}

describe("useDocumentTitle (browser)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useCaptureStore.getState().reset();
    document.title = "fvf • viewer";
    hostElement = document.createElement("div");
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    hostElement.remove();
    useCaptureStore.getState().reset();
    document.title = "fvf • viewer";
  });

  it("AC: tab title shows '<filename> - FVF Viewer' (ASCII hyphen-minus) while a capture is loaded", async () => {
    await act(async () => {
      root.render(<HookHost />);
    });
    expect(document.title).toBe("fvf • viewer");

    await act(async () => {
      await useCaptureStore
        .getState()
        .parseBuffer(await fixture(fourChUrl), "capture_01.fvf");
    });

    expect(useCaptureStore.getState().capture).not.toBeNull();
    expect(document.title).toBe("capture_01.fvf - FVF Viewer");
    expect(document.title).not.toContain("—");
    expect(document.title).toContain(" - ");
    expect(document.title.charCodeAt(15)).toBe(0x2d); // ASCII hyphen-minus
  });

  it("AC: title reverts to the default after reset()", async () => {
    await act(async () => {
      root.render(<HookHost />);
    });
    await act(async () => {
      await useCaptureStore
        .getState()
        .parseBuffer(await fixture(fourChUrl), "capture_01.fvf");
    });
    expect(document.title).toBe("capture_01.fvf - FVF Viewer");

    await act(async () => {
      useCaptureStore.getState().reset();
    });
    expect(document.title).toBe("fvf • viewer");
  });

  it("AC: title reverts to the default when ingestion fails", async () => {
    await act(async () => {
      root.render(<HookHost />);
    });

    await act(async () => {
      await useCaptureStore
        .getState()
        .parseBuffer(new ArrayBuffer(64), "broken.fvf");
    });
    expect(useCaptureStore.getState().error).not.toBeNull();
    expect(useCaptureStore.getState().capture).toBeNull();
    expect(document.title).toBe("fvf • viewer");
  });

  it("documentTitleFor helper formats ASCII hyphen-minus and handles edge cases", () => {
    expect(documentTitleFor("capture_01.fvf", true)).toBe(
      "capture_01.fvf - FVF Viewer",
    );
    expect(documentTitleFor("scope_test.bin", true)).toBe(
      "scope_test.bin - FVF Viewer",
    );
    expect(documentTitleFor(null, true)).toBe("fvf • viewer");
    expect(documentTitleFor("", true)).toBe("fvf • viewer");
    expect(documentTitleFor("capture_01.fvf", false)).toBe("fvf • viewer");
    expect(documentTitleFor(null, false)).toBe("fvf • viewer");
  });
});
