import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import fourChUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import twoChMinUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-2ch-10000-1min-div.fvf.bin?url";
import App from "../../App";
import "../../index.css";
import { useCaptureStore } from "../../state/captureStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useViewportStore } from "../../state/viewportStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";

/**
 * Issue #96 end-to-end: the 50/50 split drop overlay over an open
 * capture, the + Compare toolbar picker, File 2 loading WITHOUT altering
 * File 1 state, reference badges with the #204/#224 popover surface, and
 * independent reference visibility.
 */

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function fetchFixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching fixture ${url}`).toBe(true);
  return response.arrayBuffer();
}

async function createFixtureFile(url: string, fileName: string): Promise<File> {
  const buffer = await fetchFixture(url);
  return new File([buffer], fileName);
}

function simulateDragEnter(target: Element): void {
  const event = new Event("dragenter", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { dropEffect: "copy" },
  });
  target.dispatchEvent(event);
}

function simulateDragOverAt(target: Element, clientX: number): void {
  const event = new Event("dragover", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { dropEffect: "copy" },
  });
  Object.defineProperty(event, "clientX", { value: clientX });
  target.dispatchEvent(event);
}

function simulateDropAt(target: Element, file: File, clientX: number): void {
  // Realistic sequence: dragover precedes drop and carries the pointer
  // position that routes the split overlay.
  simulateDragOverAt(target, clientX);
  const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(dropEvent, "dataTransfer", {
    value: { files: [file] },
  });
  Object.defineProperty(dropEvent, "clientX", { value: clientX });
  target.dispatchEvent(dropEvent);
}

async function waitForStoreCondition(
  predicate: () => boolean,
  timeoutMs = 8000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for store predicate");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("Dual-file comparison (issue #96)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useCaptureStore.getState().reset();
    useReferenceStore.getState().clear();
    useViewportStore.getState().reset();
    useChannelDisplayStore.getState().reset();
    window.localStorage.clear();
    hostElement = document.createElement("div");
    hostElement.style.width = "1200px";
    hostElement.style.height = "800px";
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    hostElement.remove();
    useCaptureStore.getState().reset();
    useReferenceStore.getState().clear();
    useViewportStore.getState().reset();
    useChannelDisplayStore.getState().reset();
    window.localStorage.clear();
  });

  it("dragging a file over an open capture presents the 50/50 split overlay", async () => {
    const file1 = await createFixtureFile(fourChUrl, "file1.fvf");
    await act(async () => {
      root.render(<App />);
    });
    const container = hostElement.querySelector(
      "[data-testid='ingestion-container']",
    ) as HTMLElement;

    await act(async () => {
      container.dispatchEvent(
        Object.assign(new Event("drop", { bubbles: true, cancelable: true }), {
          dataTransfer: { files: [file1] },
        }),
      );
      await waitForStoreCondition(
        () => useCaptureStore.getState().parseState === "success",
      );
    });

    await act(async () => {
      simulateDragEnter(container);
      await new Promise((r) => setTimeout(r, 60));
    });

    const overlay = hostElement.querySelector(
      "[data-testid='shell-drop-overlay']",
    );
    expect(overlay).not.toBeNull();
    const left = overlay?.querySelector("[data-testid='split-drop-replace']");
    const right = overlay?.querySelector("[data-testid='split-drop-compare']");
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(left?.textContent).toContain("Drop to Replace Active Capture");
    expect(right?.textContent).toContain("Drop to Compare as Reference");
  });

  it("dropping on the right half loads File 2 without altering File 1 state", async () => {
    const file1 = await createFixtureFile(fourChUrl, "file1.fvf");
    const file2 = await createFixtureFile(twoChMinUrl, "file2.fvf");
    await act(async () => {
      root.render(<App />);
    });
    const container = hostElement.querySelector(
      "[data-testid='ingestion-container']",
    ) as HTMLElement;

    await act(async () => {
      container.dispatchEvent(
        Object.assign(new Event("drop", { bubbles: true, cancelable: true }), {
          dataTransfer: { files: [file1] },
        }),
      );
      await waitForStoreCondition(
        () => useCaptureStore.getState().parseState === "success",
      );
    });

    const file1Capture = useCaptureStore.getState().capture;
    const file1Name = useCaptureStore.getState().fileName;

    // Drop the second file over the RIGHT half (clientX near the right
    // edge of a 1200px host).
    await act(async () => {
      simulateDropAt(container, file2, 1100);
      await waitForStoreCondition(
        () => useReferenceStore.getState().parseState === "success",
      );
    });

    const refState = useReferenceStore.getState();
    expect(refState.fileName).toBe("file2.fvf");
    expect(refState.refActiveChannels).toEqual(["Ref-A", "Ref-B"]);
    expect(refState.lanes).toHaveLength(2);
    // Resampled lanes align with File 1's time grid.
    expect(refState.lanes![0]!.length).toBe(file1Capture!.timestamps.length);

    // File 1 is untouched: same capture object, name, and parse state.
    expect(useCaptureStore.getState().capture).toBe(file1Capture);
    expect(useCaptureStore.getState().fileName).toBe(file1Name);
    expect(useCaptureStore.getState().parseState).toBe("success");

    // Reference badges render in the toolbar with the secondary palette.
    const refBadge = hostElement.querySelector(
      "[data-testid='channel-badge-Ref-A']",
    );
    expect(refBadge).not.toBeNull();
    const refGear = hostElement.querySelector(
      "[data-testid='channel-gear-Ref-A']",
    );
    expect(refGear).not.toBeNull();
  });

  it("the + Compare banner action opens the File 2 picker (issue #239)", async () => {
    const file1 = await createFixtureFile(fourChUrl, "file1.fvf");
    await act(async () => {
      root.render(<App />);
    });
    const container = hostElement.querySelector(
      "[data-testid='ingestion-container']",
    ) as HTMLElement;
    await act(async () => {
      container.dispatchEvent(
        Object.assign(new Event("drop", { bubbles: true, cancelable: true }), {
          dataTransfer: { files: [file1] },
        }),
      );
      await waitForStoreCondition(
        () => useCaptureStore.getState().parseState === "success",
      );
    });

    const compareInput = hostElement.querySelector(
      "[data-testid='compare-picker-input']",
    ) as HTMLInputElement;
    const clickSpy = vi.spyOn(compareInput, "click");
    const compareButton = hostElement.querySelector(
      "[data-testid='compare-file-button']",
    ) as HTMLButtonElement;
    expect(compareButton).not.toBeNull();
    expect(compareButton.textContent).toContain("+ Compare");
    // Issue #239: the control sits in the banner header row, immediately
    // after 'Open file…', styled exactly like it (same class).
    expect(compareButton.closest(".banner-top-row")).not.toBeNull();
    expect(compareButton.className).toBe(
      (hostElement.querySelector(".banner-open-btn") as HTMLElement).className,
    );
    expect(
      (hostElement.querySelector(".banner-open-btn") as HTMLElement)
        .nextElementSibling,
    ).toBe(compareButton);

    await act(async () => {
      compareButton.click();
    });
    expect(clickSpy).toHaveBeenCalled();
  });

  it("reference badges carry the full #204/#224 popover surface and independent visibility", async () => {
    const file1 = await createFixtureFile(fourChUrl, "file1.fvf");
    await act(async () => {
      root.render(<App />);
    });
    const container = hostElement.querySelector(
      "[data-testid='ingestion-container']",
    ) as HTMLElement;
    await act(async () => {
      container.dispatchEvent(
        Object.assign(new Event("drop", { bubbles: true, cancelable: true }), {
          dataTransfer: { files: [file1] },
        }),
      );
      await waitForStoreCondition(
        () => useCaptureStore.getState().parseState === "success",
      );
    });

    // Seed a parsed + resampled reference through the real store actions.
    const file2 = await createFixtureFile(twoChMinUrl, "file2.fvf");
    await act(async () => {
      await useReferenceStore
        .getState()
        .parseReferenceBuffer(await file2.arrayBuffer(), "file2.fvf");
      await waitForStoreCondition(
        () => useReferenceStore.getState().parseState === "success",
      );
    });

    await act(async () => {
      (
        hostElement.querySelector(
          "[data-testid='channel-gear-Ref-A']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 40));
    });

    const popover = document.body.querySelector(
      "[data-testid='badge-config-popover']",
    ) as HTMLElement;
    expect(popover).not.toBeNull();
    // #224 display controls fully participate.
    expect(
      popover.querySelector("[data-testid='channel-display-section']"),
    ).not.toBeNull();
    expect(
      popover.querySelector("[data-testid='scale-scrub-field']"),
    ).not.toBeNull();
    expect(
      popover.querySelector("[data-testid='solo-chip-Ref-A']"),
    ).not.toBeNull();
    // Stats line resolves File 2's channel.
    const stats = popover.querySelector(
      "[data-testid='channel-stats']",
    )?.textContent;
    expect(stats).toContain("samples");

    // Independent visibility: toggling a Ref badge leaves the primary set.
    const primaryActive = [...useViewportStore.getState().activeChannels];
    await act(async () => {
      (
        hostElement.querySelector(
          "[data-testid='channel-badge-Ref-A']",
        ) as HTMLButtonElement
      ).click();
    });
    expect(useReferenceStore.getState().refActiveChannels).toEqual(["Ref-B"]);
    expect(useViewportStore.getState().activeChannels).toEqual(primaryActive);
  });

  it("replacing File 1 clears the reference comparison", async () => {
    const file1 = await createFixtureFile(fourChUrl, "file1.fvf");
    const file2 = await createFixtureFile(twoChMinUrl, "file2.fvf");
    await act(async () => {
      root.render(<App />);
    });
    const container = hostElement.querySelector(
      "[data-testid='ingestion-container']",
    ) as HTMLElement;
    await act(async () => {
      container.dispatchEvent(
        Object.assign(new Event("drop", { bubbles: true, cancelable: true }), {
          dataTransfer: { files: [file1] },
        }),
      );
      await waitForStoreCondition(
        () => useCaptureStore.getState().parseState === "success",
      );
    });
    await act(async () => {
      simulateDropAt(container, file2, 1100);
      await waitForStoreCondition(
        () => useReferenceStore.getState().parseState === "success",
      );
    });
    expect(useReferenceStore.getState().capture).not.toBeNull();

    // Drop a replacement on the LEFT half: File 1 changes, File 2 drops.
    const file3 = await createFixtureFile(fourChUrl, "replacement.fvf");
    await act(async () => {
      simulateDropAt(container, file3, 100);
      await waitForStoreCondition(
        () =>
          useCaptureStore.getState().parseState === "success" &&
          useCaptureStore.getState().fileName === "replacement.fvf",
      );
    });
    expect(useReferenceStore.getState().capture).toBeNull();
    expect(
      hostElement.querySelector("[data-testid='channel-badge-Ref-A']"),
    ).toBeNull();
  });
});
