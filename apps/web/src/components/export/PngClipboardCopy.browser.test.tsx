/**
 * Copy-to-clipboard PNG control (issue #158, browser): the subtle copy
 * control next to Export PNG writes the composited snapshot to the
 * clipboard as an image/png ClipboardItem (no download), honors the print
 * invert toggle and the canvas-permission gate, hides on browsers without
 * image clipboard support, and shows a transient copied state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSnapshotStore } from "./snapshotStore";
import PngSnapshotButton, { supportsImageClipboard } from "./PngSnapshotButton";
import * as canvasPermission from "./canvasPermission";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function pngBlob(): Blob {
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])], {
    type: "image/png",
  });
}

describe("PNG clipboard copy control (browser, issue #158)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;
  let exporterCalls: boolean[];
  let clipboardWrites: ClipboardItem[];

  beforeEach(() => {
    useSnapshotStore.getState().registerExporter(null);
    exporterCalls = [];
    clipboardWrites = [];
    canvasPermission.setCanvasReadbackOverride(() => true);

    hostElement = document.createElement("div");
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
  });

  afterEach(() => {
    canvasPermission.setCanvasReadbackOverride(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    act(() => {
      root.unmount();
    });
    hostElement.remove();
    useSnapshotStore.getState().registerExporter(null);
  });

  function mountWithExporter(): void {
    useSnapshotStore.getState().registerExporter(async (inverted: boolean) => {
      exporterCalls.push(inverted);
      return pngBlob();
    });
    act(() => {
      root.render(<PngSnapshotButton />);
    });
  }

  function copyButton(): HTMLButtonElement {
    return hostElement.querySelector(
      "[data-testid='png-copy-button']",
    ) as HTMLButtonElement;
  }

  function exportButton(): HTMLButtonElement {
    return hostElement.querySelector(
      "[data-testid='png-export-button']",
    ) as HTMLButtonElement;
  }

  function spyOnClipboardWrite(): ReturnType<typeof vi.spyOn> {
    return vi
      .spyOn(navigator.clipboard, "write")
      .mockImplementation(async (items: ClipboardItems) => {
        clipboardWrites.push(...items);
      });
  }

  it("renders a supported-browser copy control next to Export PNG with a tooltip", () => {
    expect(supportsImageClipboard()).toBe(true);
    mountWithExporter();

    const button = copyButton();
    expect(button).not.toBeNull();
    expect(button.title).toBe("Copy PNG snapshot to clipboard");
    expect(button.getAttribute("aria-label")).toBe(
      "Copy PNG snapshot to clipboard",
    );
    // Subtle icon-only control: no text content, sits after Export PNG.
    expect((button.textContent ?? "").trim()).toBe("");
    const controls = hostElement.querySelector(".png-export-controls")!;
    const children = Array.from(controls.children).map((el) => el.tagName);
    expect(children.indexOf("BUTTON")).toBeLessThan(
      children.lastIndexOf("BUTTON"),
    );
    expect(exportButton()).not.toBeNull();
  });

  it("copies the snapshot blob as an image/png ClipboardItem instead of downloading", async () => {
    const writeSpy = spyOnClipboardWrite();
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:should-not-be-used");
    mountWithExporter();

    await act(async () => {
      copyButton().click();
      for (let i = 0; i < 40 && clipboardWrites.length < 1; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    });

    expect(clipboardWrites.length).toBe(1);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    // No download path ran for a copy.
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(exporterCalls).toEqual([false]);

    const item = clipboardWrites[0]!;
    const blob = await item.getType("image/png");
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(6);
  });

  it("the print invert toggle is honored by the copy path", async () => {
    spyOnClipboardWrite();
    mountWithExporter();

    const toggle = hostElement.querySelector(
      "[data-testid='png-invert-toggle']",
    ) as HTMLInputElement;
    await act(async () => {
      toggle.click();
    });
    expect(toggle.checked).toBe(true);

    await act(async () => {
      copyButton().click();
      for (let i = 0; i < 40 && clipboardWrites.length < 1; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    });

    expect(exporterCalls).toEqual([true]);
    expect(clipboardWrites.length).toBe(1);
  });

  it("shows the transient copied state and reverts to the copy icon", async () => {
    spyOnClipboardWrite();
    mountWithExporter();

    expect(copyButton().className).not.toContain("png-copy-button--copied");
    await act(async () => {
      copyButton().click();
      for (let i = 0; i < 40 && clipboardWrites.length < 1; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    });
    expect(copyButton().className).toContain("png-copy-button--copied");
    expect(
      copyButton().querySelector("svg.copy-icon path")!.getAttribute("d"),
    ).toContain("M7 12.5");

    await act(async () => {
      for (
        let i = 0;
        i < 40 && copyButton().className.includes("--copied");
        i += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    });
    expect(copyButton().className).not.toContain("png-copy-button--copied");
  });

  it("a blocked canvas readback opens the permission modal instead of writing", async () => {
    canvasPermission.setCanvasReadbackOverride(() => false);
    const writeSpy = spyOnClipboardWrite();
    mountWithExporter();

    await act(async () => {
      copyButton().click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(writeSpy).not.toHaveBeenCalled();
    expect(exporterCalls).toEqual([]);
    expect(
      hostElement.querySelector("[data-testid='canvas-blocked-modal']"),
    ).not.toBeNull();
  });

  it("a rejected clipboard write is logged and the button re-arms", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.spyOn(navigator.clipboard, "write").mockRejectedValue(
      new Error("NotAllowedError"),
    );
    mountWithExporter();

    await act(async () => {
      copyButton().click();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(consoleError).toHaveBeenCalledWith(
      "[png-export] clipboard copy failed",
      expect.any(Error),
    );
    expect(copyButton().className).not.toContain("png-copy-button--copied");
    expect(copyButton().disabled).toBe(false);
  });

  it("stays hidden when the browser lacks image clipboard support", () => {
    vi.stubGlobal("ClipboardItem", undefined);
    expect(supportsImageClipboard()).toBe(false);
    mountWithExporter();

    expect(copyButton()).toBeNull();
    expect(exportButton()).not.toBeNull();
  });
});
