import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import badMagicUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/rejected-invalid-magic-1ch-1000.fvf.bin?url";
import { useCaptureStore } from "../../state/captureStore";
import App from "../../App";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function fetchFixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching fixture ${url}`).toBe(true);
  return response.arrayBuffer();
}

describe("ErrorModal browser integration (real worker round-trip)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;
  let uncaughtErrors: ErrorEvent[] = [];
  const errorHandler = (event: ErrorEvent) => {
    uncaughtErrors.push(event);
  };

  beforeEach(() => {
    useCaptureStore.getState().reset();
    uncaughtErrors = [];
    window.addEventListener("error", errorHandler);

    hostElement = document.createElement("div");
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    hostElement.remove();
    window.removeEventListener("error", errorHandler);
    useCaptureStore.getState().reset();
  });

  it("surfaces human title, detected hex and ASCII bytes, and returns to hero on dismiss without console crash", async () => {
    // 1. Mount App in empty state
    await act(async () => {
      root.render(<App />);
    });

    expect(
      hostElement.querySelector("[data-testid='hero-dropzone']"),
    ).not.toBeNull();
    expect(hostElement.querySelector("[data-testid='error-modal']")).toBeNull();

    // 2. Parse rejected-invalid-magic fixture through real worker
    const buffer = await fetchFixture(badMagicUrl);
    await act(async () => {
      await useCaptureStore.getState().parseBuffer(buffer, "corrupt.fvf");
    });

    // 3. Assert error state and modal presence
    const state = useCaptureStore.getState();
    expect(state.parseState).toBe("error");
    expect(state.error?.code).toBe("invalid_signature");

    const modal = hostElement.querySelector("[data-testid='error-modal']");
    expect(modal).not.toBeNull();

    // Human title
    const title = hostElement.querySelector("#error-modal-title");
    expect(title?.textContent).toBe("Invalid File Signature");

    // Engine message
    const message = hostElement.querySelector(
      "[data-testid='error-modal-message']",
    );
    expect(message?.textContent).toContain("invalid signature");

    // Detected hex & ASCII bytes
    const hexEl = hostElement.querySelector("[data-testid='detected-hex']");
    const asciiEl = hostElement.querySelector("[data-testid='detected-ascii']");
    expect(hexEl?.textContent).toBe("58 58 2e 58 56 46 1a 00");
    expect(asciiEl?.textContent).toBe("XX.XVF..");

    // 4. Dismiss modal via button
    const dismissBtn = hostElement.querySelector(
      "[data-testid='error-modal-dismiss']",
    ) as HTMLButtonElement;
    expect(dismissBtn).not.toBeNull();

    await act(async () => {
      dismissBtn.click();
    });

    // 5. Assert dismissal returns to the hero empty state
    expect(hostElement.querySelector("[data-testid='error-modal']")).toBeNull();
    expect(
      hostElement.querySelector("[data-testid='hero-dropzone']"),
    ).not.toBeNull();
    expect(useCaptureStore.getState().parseState).toBe("idle");
    expect(useCaptureStore.getState().error).toBeNull();

    // 6. No uncaught errors occurred on window
    expect(uncaughtErrors).toHaveLength(0);
  });

  it("dismisses on Escape key and backdrop click", async () => {
    const buffer = await fetchFixture(badMagicUrl);
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      await useCaptureStore.getState().parseBuffer(buffer, "corrupt.fvf");
    });

    expect(
      hostElement.querySelector("[data-testid='error-modal']"),
    ).not.toBeNull();

    // Test Escape key
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(hostElement.querySelector("[data-testid='error-modal']")).toBeNull();
    expect(
      hostElement.querySelector("[data-testid='hero-dropzone']"),
    ).not.toBeNull();

    // Trigger error again and test backdrop click
    const buffer2 = await fetchFixture(badMagicUrl);
    await act(async () => {
      await useCaptureStore.getState().parseBuffer(buffer2, "corrupt2.fvf");
    });

    const backdrop = hostElement.querySelector(
      "[data-testid='error-modal-backdrop']",
    ) as HTMLDivElement;
    expect(backdrop).not.toBeNull();

    await act(async () => {
      backdrop.click();
    });

    expect(hostElement.querySelector("[data-testid='error-modal']")).toBeNull();
    expect(
      hostElement.querySelector("[data-testid='hero-dropzone']"),
    ).not.toBeNull();
    expect(uncaughtErrors).toHaveLength(0);
  });
});
