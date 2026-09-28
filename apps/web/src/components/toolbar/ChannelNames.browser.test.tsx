import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import uPlot from "uplot";
import Oscilloscope from "../canvas/Oscilloscope";
import "../../index.css";
import WaveformToolbar from "./WaveformToolbar";
import MetadataBanner from "../banner/MetadataBanner";
import { CursorReadoutCard } from "../cursors/CursorReadoutCard";
import {
  captureFileKey,
  useChannelNamesStore,
} from "../../state/channelNamesStore";
import { alignedChannels, buildCsvHeaderLines } from "../export/csvExport";
import { useCaptureStore } from "../../state/captureStore";
import { useCursorStore } from "../../state/cursorStore";
import { useViewportStore } from "../../state/viewportStore";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import type { ParsedCapture } from "../../types/capture";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createTestCapture(sampleCount = 500): ParsedCapture {
  const timestamps = new Float32Array(sampleCount);
  const ch1Data = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    timestamps[i] = (i / (sampleCount - 1) - 0.5) * 0.01;
    ch1Data[i] = Math.sin(i * 0.05) * 3;
  }
  return {
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "10 us/Div",
      secondsPerDiv: 1e-5,
      timestamp14: "12300020260912",
      samples: sampleCount,
      deltaT: 1e-5,
      channels: [
        {
          name: "A",
          label: "Input A",
          derived: false,
          samples: sampleCount,
          deltaT: 1e-5,
        },
      ],
    },
    channels: [{ name: "A", label: "Input A", derived: false, data: ch1Data }],
    derivedChannels: [],
    timestamps,
    warnings: [],
  };
}

describe("Channel name inline editing (Issue #64)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;
  let capture: ParsedCapture;

  const badge = () =>
    hostElement.querySelector(
      "[data-testid='channel-badge-A']",
    ) as HTMLButtonElement;

  function mountAll() {
    act(() => {
      root.render(
        <div>
          <MetadataBanner capture={capture} fileName="scope.fvf" />
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
          <CursorReadoutCard capture={capture} />
        </div>,
      );
    });
  }

  function typeInto(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function enterEdit() {
    act(() => {
      badge().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
  }

  beforeEach(() => {
    localStorage.clear();
    useChannelNamesStore.getState().setFileKey(null);
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
    capture = createTestCapture();
    useCaptureStore.setState({ capture });
    hostElement = document.createElement("div");
    hostElement.style.width = "900px";
    hostElement.style.height = "600px";
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
    act(() => {
      useChannelNamesStore
        .getState()
        .setFileKey(captureFileKey("scope.fvf", capture.metadata.timestamp14));
    });
  });

  afterEach(() => {
    await_unmount();
    localStorage.clear();
    useChannelNamesStore.getState().setFileKey(null);
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
  });

  function await_unmount() {
    act(() => {
      root.unmount();
    });
    hostElement.remove();
  }

  it("AC1/AC2: double-click opens the inline editor; committing shows 'A: <name>'", () => {
    mountAll();
    enterEdit();
    const editor = hostElement.querySelector(
      "[data-testid='channel-badge-edit-A']",
    ) as HTMLElement;
    expect(editor).not.toBeNull();
    expect(editor.textContent).toContain("A: ");
    const input = editor.querySelector("input") as HTMLInputElement;
    expect(input.maxLength).toBe(24);

    act(() => {
      typeInto(input, "V_grid");
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    // Editor closed; badge shows the amended name.
    expect(
      hostElement.querySelector("[data-testid='channel-badge-edit-A']"),
    ).toBeNull();
    expect(badge().textContent).toContain("A: V_grid");
    expect(useChannelNamesStore.getState().names.A).toBe("V_grid");
  });

  it("AC3: submitting an empty amendment restores the default label", () => {
    mountAll();
    act(() => {
      useChannelNamesStore.getState().setName("A", "V_grid");
    });
    expect(badge().textContent).toContain("A: V_grid");

    enterEdit();
    const input = hostElement.querySelector(
      "[data-testid='channel-name-input-A']",
    ) as HTMLInputElement;
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(badge().textContent).toContain("A: V_grid");

    enterEdit();
    const input2 = hostElement.querySelector(
      "[data-testid='channel-name-input-A']",
    ) as HTMLInputElement;
    act(() => {
      typeInto(input2, "");
      input2.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(useChannelNamesStore.getState().names.A).toBeUndefined();
    expect(badge().textContent).toBe("A");
  });

  it("AC4: Escape cancels editing without saving", () => {
    mountAll();
    enterEdit();
    const input = hostElement.querySelector(
      "[data-testid='channel-name-input-A']",
    ) as HTMLInputElement;
    act(() => {
      typeInto(input, "V_grid");
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      // Real browsers fire blur when the editor unmounts; the cancelled
      // flag must swallow it.
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(
      hostElement.querySelector("[data-testid='channel-badge-edit-A']"),
    ).toBeNull();
    expect(useChannelNamesStore.getState().names.A).toBeUndefined();
    expect(badge().textContent).not.toContain("V_grid");
  });

  it("AC5: single click still toggles visibility; double-click leaves it unchanged", () => {
    mountAll();
    const pressed = () => badge().getAttribute("aria-pressed");
    expect(pressed()).toBe("true");
    act(() => {
      badge().click();
    });
    expect(pressed()).toBe("false");
    act(() => {
      badge().click();
    });
    expect(pressed()).toBe("true");
    // Double-click: two clicks (net zero) + edit mode, no visibility change.
    enterEdit();
    expect(useViewportStore.getState().activeChannels.includes("A")).toBe(true);
    expect(
      hostElement.querySelector("[data-testid='channel-badge-edit-A']"),
    ).not.toBeNull();
  });

  it("AC6: amendments propagate to readout card, series label, CSV, and banner", () => {
    mountAll();
    // Activate C1 so the readout card renders.
    act(() => {
      useCursorStore.getState().setCursorActive("C1", true, 500);
    });
    act(() => {
      useChannelNamesStore.getState().setName("A", "V_grid");
    });

    // Cursor readout card row label (issue #143: no trailing colon
    // after a renamed channel).
    const reading = hostElement.querySelector("[data-testid='cursor-c1-ch-A']");
    expect(reading?.textContent).toContain("A: V_grid");
    expect(reading?.textContent).not.toContain("A: V_grid:");

    // uPlot series label (canvas legend source).
    const container = hostElement.querySelector(
      "[data-testid='oscilloscope-container']",
    ) as HTMLElement & { __uplot?: uPlot };
    const uplot = container.__uplot!;
    expect(String(uplot.series[1]!.label)).toBe("A: V_grid");

    // CSV header column uses the amended name.
    const columns = alignedChannels(capture, { A: "V_grid" });
    expect(columns[0]!.header).toBe("A: V_grid");
    const headerLines = buildCsvHeaderLines(capture, "scope.fvf", {
      A: "V_grid",
    });
    expect(headerLines.join("\n")).toContain("A: V_grid");

    // Metadata banner channel list (issue #121: tooltip only, never inline).
    const banner = hostElement.querySelector(".metadata-banner")!;
    expect(banner.textContent).not.toContain("V_grid");
    const bannerLetter = banner.querySelector(
      ".banner-channel-names span",
    ) as HTMLElement;
    expect(bannerLetter.title).toBe("V_grid");
  });

  it("AC7: custom names persist per file and restore on reopen", async () => {
    mountAll();
    act(() => {
      useChannelNamesStore.getState().setName("A", "V_grid");
    });
    const raw = localStorage.getItem("fvf.channel-names");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({
      "scope.fvf::12300020260912": { A: "V_grid" },
    });

    // Reopen the same file (fresh session): names restore.
    vi.resetModules();
    const { createChannelNamesStore } =
      await import("../../state/channelNamesStore");
    const fresh = createChannelNamesStore();
    fresh.getState().setFileKey("scope.fvf::12300020260912");
    expect(fresh.getState().names).toEqual({ A: "V_grid" });
    // A different file starts clean.
    fresh.getState().setFileKey("other.fvf::999");
    expect(fresh.getState().names).toEqual({});
  });
});
