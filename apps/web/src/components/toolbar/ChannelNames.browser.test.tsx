import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import uPlot from "uplot";
import Oscilloscope from "../canvas/Oscilloscope";
import "../../index.css";
import WaveformToolbar from "./WaveformToolbar";
import MetadataBanner from "../banner/MetadataBanner";
import MeasurementsTable from "../measurements/MeasurementsTable";
import { CursorReadoutCard } from "../cursors/CursorReadoutCard";
import {
  captureFileKey,
  useChannelNamesStore,
} from "../../state/channelNamesStore";
import {
  alignedChannels,
  buildCsvHeaderLines,
  exportCompositeCsv,
} from "../export/csvExport";
import { useCaptureStore } from "../../state/captureStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useMeasurementsStore } from "../../state/measurementsStore";
import { useCursorStore } from "../../state/cursorStore";
import { useViewportStore } from "../../state/viewportStore";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useBadgePopoverStore } from "./badgeConfig/anchoredPopover";
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

  describe("Compare (Ref-*) channel renaming & per-file persistence (Issue #335)", () => {
    let refCapture: ParsedCapture;

    const refBadge = () =>
      hostElement.querySelector(
        "[data-testid='channel-badge-Ref-A']",
      ) as HTMLButtonElement;

    function createRefCapture(sampleCount = 500): ParsedCapture {
      const base = createTestCapture(sampleCount);
      return {
        ...base,
        metadata: {
          ...base.metadata,
          timestamp14: "09150020261029",
        },
      };
    }

    function mountCompareAll() {
      act(() => {
        root.render(
          <div>
            <MetadataBanner capture={capture} fileName="scope.fvf" />
            <WaveformToolbar />
            <Oscilloscope capture={capture} />
            <MeasurementsTable capture={capture} />
            <CursorReadoutCard capture={capture} />
          </div>,
        );
      });
    }

    beforeEach(() => {
      useBadgePopoverStore.getState().setOpen(null);
      useReferenceStore.getState().clear();
      useMeasurementsStore.setState({ isOpen: false });
      refCapture = createRefCapture();
      act(() => {
        useChannelNamesStore
          .getState()
          .setRefFileKey(
            captureFileKey("compare.fvf", refCapture.metadata.timestamp14),
          );
        useReferenceStore.setState({
          capture: refCapture,
          fileName: "compare.fvf",
          lanes: [new Float32Array(refCapture.channels[0]!.data)],
          refActiveChannels: ["Ref-A"],
          parseState: "success",
          error: null,
          timeSlipSamples: 0,
        });
      });
    });

    afterEach(() => {
      useBadgePopoverStore.getState().setOpen(null);
      useReferenceStore.getState().clear();
      useMeasurementsStore.setState({ isOpen: false });
    });

    it("AC1+AC2+AC4: double-clicking a Ref-* badge opens inline editor without changing visibility; single click toggles visibility; Enter/blur commits and Escape cancels", () => {
      mountCompareAll();

      // AC2: single click toggles visibility
      expect(refBadge().getAttribute("aria-pressed")).toBe("true");
      act(() => {
        refBadge().click();
      });
      expect(refBadge().getAttribute("aria-pressed")).toBe("false");
      expect(useReferenceStore.getState().refActiveChannels).toEqual([]);

      // Double-click while hidden (false): 2 rapid clicks (detail 1, 2) + dblclick leaves visibility false
      act(() => {
        refBadge().dispatchEvent(
          new MouseEvent("click", { bubbles: true, detail: 1 }),
        );
        refBadge().dispatchEvent(
          new MouseEvent("click", { bubbles: true, detail: 2 }),
        );
        refBadge().dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true, detail: 2 }),
        );
      });
      expect(useReferenceStore.getState().refActiveChannels).toEqual([]);
      const editorHidden = hostElement.querySelector(
        "[data-testid='channel-badge-edit-Ref-A']",
      ) as HTMLElement;
      expect(editorHidden).not.toBeNull();
      expect(editorHidden.textContent).toContain("Ref-A: ");

      // AC4: Escape cancels with no change
      const inputHidden = editorHidden.querySelector(
        "input",
      ) as HTMLInputElement;
      act(() => {
        typeInto(inputHidden, "Abandoned");
        inputHidden.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        inputHidden.dispatchEvent(
          new FocusEvent("focusout", { bubbles: true }),
        );
      });
      expect(
        hostElement.querySelector("[data-testid='channel-badge-edit-Ref-A']"),
      ).toBeNull();
      expect(useChannelNamesStore.getState().names["Ref-A"]).toBeUndefined();
      expect(useReferenceStore.getState().refActiveChannels).toEqual([]);

      // Toggle back to visible (true) via single click
      act(() => {
        refBadge().dispatchEvent(
          new MouseEvent("click", { bubbles: true, detail: 1 }),
        );
      });
      expect(useReferenceStore.getState().refActiveChannels).toEqual(["Ref-A"]);

      // Double-click while visible (true): 2 rapid clicks (detail 1, 2) + dblclick leaves visibility true
      act(() => {
        refBadge().dispatchEvent(
          new MouseEvent("click", { bubbles: true, detail: 1 }),
        );
        refBadge().dispatchEvent(
          new MouseEvent("click", { bubbles: true, detail: 2 }),
        );
        refBadge().dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true, detail: 2 }),
        );
      });
      expect(useReferenceStore.getState().refActiveChannels).toEqual(["Ref-A"]);

      const input = hostElement.querySelector(
        "[data-testid='channel-name-input-Ref-A']",
      ) as HTMLInputElement;
      expect(input).not.toBeNull();

      // AC4: Enter commits the name
      act(() => {
        typeInto(input, "V_ref_bus");
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
      expect(
        hostElement.querySelector("[data-testid='channel-badge-edit-Ref-A']"),
      ).toBeNull();
      expect(refBadge().textContent).toBe("Ref-A: V_ref_bus");
      expect(useChannelNamesStore.getState().names["Ref-A"]).toBe("V_ref_bus");
      expect(useReferenceStore.getState().refActiveChannels).toEqual(["Ref-A"]);

      // Blur commits an empty name to clear back to default (AC4)
      act(() => {
        refBadge().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      });
      const inputClear = hostElement.querySelector(
        "[data-testid='channel-name-input-Ref-A']",
      ) as HTMLInputElement;
      act(() => {
        typeInto(inputClear, "   ");
        inputClear.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
        inputClear.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
      expect(useChannelNamesStore.getState().names["Ref-A"]).toBeUndefined();
      expect(refBadge().textContent).toBe("Ref-A");
    });

    it("AC3+AC4: renaming via the Ref-* badge gear Configuration popover works with Enter, blur, empty-clear, and Escape cancel", async () => {
      mountCompareAll();

      const gear = hostElement.querySelector(
        "[data-testid='channel-gear-Ref-A']",
      ) as HTMLButtonElement;
      await act(async () => {
        gear.click();
        await new Promise((r) => setTimeout(r, 30));
      });

      const popover = document.body.querySelector(
        "[data-testid='badge-config-popover']",
      ) as HTMLElement;
      expect(popover).not.toBeNull();
      const nameField = popover.querySelector(
        "[data-testid='popover-name-field']",
      ) as HTMLInputElement;
      expect(nameField).not.toBeNull();
      expect(nameField.getAttribute("placeholder")).toBe("Channel Ref-A");

      // Type and press Escape -> cancels back to empty default
      act(() => {
        nameField.focus();
        typeInto(nameField, "CancelledName");
        nameField.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      expect(useChannelNamesStore.getState().names["Ref-A"]).toBeUndefined();
      expect(refBadge().textContent).toBe("Ref-A");

      // Type and press Enter -> commits
      act(() => {
        nameField.focus();
        typeInto(nameField, "Ref_Shunt");
        nameField.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
      expect(useChannelNamesStore.getState().names["Ref-A"]).toBe("Ref_Shunt");
      expect(refBadge().textContent).toBe("Ref-A: Ref_Shunt");

      // Type new draft and press Escape -> reverts to committed "Ref_Shunt"
      act(() => {
        nameField.focus();
        typeInto(nameField, "DiscardedEdit");
        nameField.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      expect(useChannelNamesStore.getState().names["Ref-A"]).toBe("Ref_Shunt");
      expect(refBadge().textContent).toBe("Ref-A: Ref_Shunt");

      // Type empty and blur -> clears back to default
      act(() => {
        nameField.focus();
        typeInto(nameField, "");
        nameField.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
        nameField.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
      expect(useChannelNamesStore.getState().names["Ref-A"]).toBeUndefined();
      expect(refBadge().textContent).toBe("Ref-A");
    });

    it("AC5+AC6+AC7: custom compare name propagation and per-file persistence", async () => {
      act(() => {
        useMeasurementsStore.setState({ isOpen: true });
      });
      mountCompareAll();

      act(() => {
        useChannelNamesStore.getState().setName("A", "Primary_Vin");
        useChannelNamesStore.getState().setName("Ref-A", "Compare_Vout");
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // Primary and Ref badges
      expect(badge().textContent).toBe("A: Primary_Vin");
      expect(refBadge().textContent).toBe("Ref-A: Compare_Vout");

      // Canvas uPlot series & axis label
      const container = hostElement.querySelector(
        "[data-testid='oscilloscope-container']",
      ) as HTMLElement & { __uplot?: uPlot };
      const uplot = container.__uplot!;
      expect(String(uplot.series[1]!.label)).toBe("A: Primary_Vin");
      expect(String(uplot.series[2]!.label)).toBe("Ref-A: Compare_Vout");
      const refAxis = uplot.axes.find((a) => a.scale === "y1");
      expect(String(refAxis?.label)).toContain("Compare_Vout");

      // Measurements table row for Ref-A
      const refMeasRow = hostElement.querySelector(
        "[data-testid='measurement-row-ref-a']",
      );
      expect(refMeasRow?.textContent).toContain("Ref-A: Compare_Vout");

      // Composite CSV header includes both custom names
      const csvBlob = await exportCompositeCsv(
        capture,
        "scope.fvf",
        refCapture,
        "compare.fvf",
        useReferenceStore.getState().lanes ?? [],
        0,
        useChannelNamesStore.getState().names,
      );
      const csvText = await csvBlob.text();
      expect(csvText).toContain("[File 1] A: Primary_Vin");
      expect(csvText).toContain("[File 2] A: Compare_Vout");

      // AC6 & AC7: localStorage keys primary under scope.fvf and compare under compare.fvf
      const stored = JSON.parse(localStorage.getItem("fvf.channel-names")!);
      expect(stored).toEqual({
        "scope.fvf::12300020260912": { A: "Primary_Vin" },
        "compare.fvf::09150020261029": { A: "Compare_Vout" },
      });
    });
  });
});
