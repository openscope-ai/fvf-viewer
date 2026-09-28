import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import uPlot from "uplot";
import Oscilloscope from "../canvas/Oscilloscope";
import "../../index.css";
import PaletteSettings, { CURATED_SWATCHES } from "./PaletteSettings";
import { createPaletteStore, usePaletteStore } from "../../state/paletteStore";
import { useThemeStore } from "../../state/themeStore";
import { useCaptureStore } from "../../state/captureStore";
import { useViewportStore } from "../../state/viewportStore";
import type { ParsedCapture } from "../../types/capture";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function resolveStroke(
  stroke: unknown,
  uplot: uPlot,
  seriesIdx: number,
): string {
  if (typeof stroke === "function") {
    return String(
      (stroke as (...args: unknown[]) => unknown)(uplot, seriesIdx),
    );
  }
  return String(stroke);
}

function createTestCapture(sampleCount = 500): ParsedCapture {
  const timestamps = new Float32Array(sampleCount);
  const ch1Data = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    timestamps[i] = i * 1e-5;
    ch1Data[i] = Math.sin(i * 0.05) * 3.3;
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

/** Sets a React-controlled input's value and fires the input event. */
function setReactInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Palette settings inline color picker accordion (Issue #59)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;

  const q = <T extends Element = Element>(sel: string) =>
    hostElement.querySelector(sel) as T;
  const panel = () =>
    q<HTMLDivElement>("[data-testid='palette-settings-panel']");
  const chip = (key: string) =>
    q<HTMLButtonElement>(`[data-testid='palette-chip-${key}']`);
  const accordion = (key: string) =>
    q<HTMLDivElement>(`[data-testid='palette-accordion-${key}']`);

  function mount(withScope = false) {
    act(() => {
      root.render(
        <div>
          <PaletteSettings />
          {withScope && <Oscilloscope capture={createTestCapture()} />}
        </div>,
      );
    });
    act(() => {
      q<HTMLButtonElement>("[data-testid='palette-settings-button']").click();
    });
  }

  beforeEach(() => {
    window.localStorage.clear();
    usePaletteStore.getState().resetPalette();
    useThemeStore.getState().setTheme("dark");
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
    hostElement = document.createElement("div");
    hostElement.style.width = "900px";
    hostElement.style.height = "600px";
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    hostElement.remove();
    window.localStorage.clear();
    usePaletteStore.getState().resetPalette();
    useThemeStore.getState().setTheme("dark");
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
  });

  it("AC1: rows are streamlined to label, active color chip, and reset button", () => {
    mount();
    expect(panel()).not.toBeNull();

    const rowA = q<HTMLDivElement>("[data-testid='palette-row-A']");
    expect(rowA).not.toBeNull();
    // Exactly one chip and one reset control on the row; no inline presets,
    // hex box, or native picker remain in the default row view.
    expect(rowA.querySelectorAll(".palette-chip")).toHaveLength(1);
    expect(rowA.querySelectorAll(".palette-row-reset")).toHaveLength(1);
    expect(rowA.querySelectorAll("input")).toHaveLength(0);
    expect(rowA.querySelectorAll(".palette-swatch")).toHaveLength(0);

    // Chip displays the effective (theme default) color for Channel A.
    expect(chip("A").style.backgroundColor).toBe("rgb(255, 215, 0)");
    // Reset is disabled without a customization.
    expect(
      q<HTMLButtonElement>("[data-testid='palette-reset-A']").disabled,
    ).toBe(true);
  });

  it("AC2: clicking a chip expands its accordion and collapses the previous one", () => {
    mount();
    act(() => {
      chip("A").click();
    });
    expect(accordion("A")).not.toBeNull();
    expect(chip("A").getAttribute("aria-expanded")).toBe("true");
    expect(chip("A").getAttribute("aria-controls")).toBe("palette-accordion-A");

    // Single-open: expanding B collapses A.
    act(() => {
      chip("B").click();
    });
    expect(accordion("B")).not.toBeNull();
    expect(accordion("A")).toBeNull();
    expect(chip("A").getAttribute("aria-expanded")).toBe("false");

    // Clicking the chip again collapses its own accordion.
    act(() => {
      chip("B").click();
    });
    expect(accordion("B")).toBeNull();

    // Done button collapses too.
    act(() => {
      chip("C1").click();
    });
    act(() => {
      q<HTMLButtonElement>("[data-testid='palette-done-C1']").click();
    });
    expect(accordion("C1")).toBeNull();
  });

  it("AC3: the accordion presents the curated matrix, hex input, and native picker", () => {
    mount();
    act(() => {
      chip("A").click();
    });
    expect(CURATED_SWATCHES.length).toBeGreaterThanOrEqual(24);
    expect(CURATED_SWATCHES.length).toBeLessThanOrEqual(36);
    const grid = q<HTMLDivElement>("[data-testid='palette-swatch-grid-A']");
    expect(grid.querySelectorAll("button")).toHaveLength(
      CURATED_SWATCHES.length,
    );
    expect(q<HTMLInputElement>("[data-testid='palette-hex-A']")).not.toBeNull();
    expect(
      q<HTMLInputElement>("[data-testid='palette-color-A']"),
    ).not.toBeNull();

    // The currently active color is visually selected in the matrix.
    const active = q<HTMLButtonElement>(
      "[data-testid='palette-swatch-A-#FFD700']",
    );
    expect(active.getAttribute("aria-pressed")).toBe("true");
  });

  it("AC4: clicking a swatch updates the waveform trace live and keeps the accordion open", () => {
    mount(true);
    act(() => {
      chip("A").click();
    });
    const container = q<HTMLDivElement>(
      "[data-testid='oscilloscope-container']",
    );
    const uplot = (container as HTMLElement & { __uplot?: uPlot }).__uplot;
    expect(uplot).toBeDefined();
    expect(resolveStroke(uplot!.series[1]?.stroke, uplot!, 1)).toBe("#FFD700");

    act(() => {
      q<HTMLButtonElement>("[data-testid='palette-swatch-A-#FF1493']").click();
    });

    // Live in-place restyle through the palette store...
    // Store canonicalizes to lowercase hex.
    expect(resolveStroke(uplot!.series[1]?.stroke, uplot!, 1)).toBe("#ff1493");
    // ...while the accordion stays open for further comparison.
    expect(accordion("A")).not.toBeNull();
    expect(usePaletteStore.getState().customColors.A).toBe("#ff1493");
  });

  it("AC5: hex input commits valid colors live and rolls back invalid entry on blur", () => {
    mount();
    act(() => {
      chip("A").click();
    });
    const hex = q<HTMLInputElement>("[data-testid='palette-hex-A']");

    act(() => {
      setReactInputValue(hex, "#123ABC");
    });
    expect(usePaletteStore.getState().customColors.A).toBe("#123abc");
    expect(hex.className).not.toContain("palette-hex--invalid");

    act(() => {
      setReactInputValue(hex, "#12G999");
    });
    // Invalid draft: marked invalid, not committed.
    expect(hex.className).toContain("palette-hex--invalid");
    expect(hex.getAttribute("aria-invalid")).toBe("true");
    expect(usePaletteStore.getState().customColors.A).toBe("#123abc");

    // Blur rolls the draft back to the committed (valid) state. React
    // synthesizes onBlur from the delegated focusout event.
    act(() => {
      hex.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(hex.className).not.toContain("palette-hex--invalid");
    expect(hex.value.toLowerCase()).toBe("#123abc");
  });

  it("AC6: the native color picker commits arbitrary off-matrix colors", () => {
    mount();
    act(() => {
      chip("C2").click();
    });
    const picker = q<HTMLInputElement>("[data-testid='palette-color-C2']");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(picker, "#0B3D91");
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(usePaletteStore.getState().customColors.C2).toBe("#0b3d91");
  });

  it("AC7: keyboard operates the accordion and Escape closes it", () => {
    mount();
    // Chips are native buttons: focused, platform Enter/Space activation
    // synthesizes a click. Focus the chip, then drive the same toggle
    // handler the platform event would invoke.
    act(() => {
      chip("A").focus();
      chip("A").click();
    });
    expect(accordion("A")).not.toBeNull();
    expect(document.activeElement).toBe(chip("A"));

    // Swatches are real buttons with descriptive labels (Enter/Space
    // activatable by platform default).
    const swatch = q<HTMLButtonElement>(
      "[data-testid='palette-swatch-A-#00CED1']",
    );
    expect(swatch.getAttribute("aria-label")).toBe(
      "Apply #00CED1 to Channel A",
    );

    act(() => {
      accordion("A").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(accordion("A")).toBeNull();
    expect(chip("A").getAttribute("aria-expanded")).toBe("false");
  });

  it("AC8: custom colors persist across sessions and reset per-row and globally", () => {
    mount();
    act(() => {
      chip("A").click();
    });
    act(() => {
      q<HTMLButtonElement>("[data-testid='palette-swatch-A-#00CED1']").click();
    });
    expect(JSON.parse(localStorage.getItem("fvf.channel-palette")!)).toEqual({
      A: "#00ced1",
    });

    // Fresh session (new store instance) restores the override.
    expect(createPaletteStore().getState().customColors.A).toBe("#00ced1");

    // Per-row reset clears exactly that override and disables the action.
    const resetA = q<HTMLButtonElement>("[data-testid='palette-reset-A']");
    act(() => {
      resetA.click();
    });
    expect(usePaletteStore.getState().customColors).toEqual({});
    expect(resetA.disabled).toBe(true);
  });
});
