import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import WaveformToolbar from "../WaveformToolbar";
import "../../../index.css";
import { useCaptureStore } from "../../../state/captureStore";
import { useChannelNamesStore } from "../../../state/channelNamesStore";
import { useCursorStore } from "../../../state/cursorStore";
import { usePaletteStore } from "../../../state/paletteStore";
import { useThemeStore } from "../../../state/themeStore";
import { AnchoredPopover, useBadgePopoverStore } from "./anchoredPopover";
import {
  CURSOR_DISPLAY_STORAGE_KEY,
  useCursorDisplayStore,
} from "../../../state/cursorDisplayStore";
import { useViewportStore } from "../../../state/viewportStore";
import { CURSOR_MOVEMENT_SUMMARY } from "../../cursors/cursorHelp";
import type { ParsedCapture } from "../../../types/capture";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createTestCapture(sampleCount = 1000): ParsedCapture {
  const timestamps = new Float32Array(sampleCount);
  const channels = ["A", "B", "C", "D"].map((name, ch) => {
    const data = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      timestamps[i] = (i / (sampleCount - 1) - 0.5) * 0.01;
      if (ch === 0) data[i] = Math.sin(i * 0.05) * 3;
      else if (ch === 1) data[i] = Math.cos(i * 0.04) * 1.5;
      else if (ch === 2) data[i] = (i % 100) / 10 - 5;
      else data[i] = i % 2 === 0 ? 0 : 5;
    }
    return { name, label: `Input ${name}`, derived: false, data };
  });
  return {
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "1 ms/Div",
      secondsPerDiv: 1e-3,
      timestamp14: "12300020261003",
      samples: sampleCount,
      deltaT: 1e-5,
      channels: channels.map((c) => ({
        name: c.name,
        label: c.label,
        derived: false,
        samples: sampleCount,
        deltaT: 1e-5,
        unit: "V",
      })),
    },
    channels,
    derivedChannels: [],
    timestamps,
    warnings: [],
  };
}

describe("Badge config popover (issue #204)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;
  let capture: ParsedCapture;

  function setReactInputValue(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const openChannelPopover = async (name = "A") => {
    await act(async () => {
      (
        hostElement.querySelector(
          `[data-testid='channel-gear-${name}']`,
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    return document.body.querySelector(
      "[data-testid='badge-config-popover']",
    ) as HTMLElement;
  };

  const openCursorPopover = async (id: "c1" | "c2" = "c1") => {
    await act(async () => {
      (
        hostElement.querySelector(
          `[data-testid='cursor-gear-${id}']`,
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    return document.body.querySelector(
      "[data-testid='badge-config-popover']",
    ) as HTMLElement;
  };

  const expandColorDetail = async () => {
    await act(async () => {
      (
        document.body.querySelector(
          "[data-testid='hero-color-square']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
  };

  const popoverCount = () =>
    document.body.querySelectorAll("[data-testid='badge-config-popover']")
      .length;

  beforeEach(() => {
    useBadgePopoverStore.getState().setOpen(null);
    window.localStorage.clear();
    useCursorDisplayStore.getState().reset();
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
    useChannelNamesStore.setState({ fileKey: null, names: {} });
    capture = createTestCapture();
    useCaptureStore.setState({ capture });
    hostElement = document.createElement("div");
    hostElement.style.width = "1200px";
    hostElement.style.height = "80px";
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
    act(() => {
      root.render(<WaveformToolbar />);
    });
  });

  afterEach(() => {
    useBadgePopoverStore.getState().setOpen(null);
    act(() => {
      root.unmount();
    });
    hostElement.remove();
    window.localStorage.clear();
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
    useChannelNamesStore.setState({ fileKey: null, names: {} });
  });

  it("AC5/AC6: gear opens one role=dialog popover with initial focus; Esc dismisses and refocuses the gear", async () => {
    const gear = hostElement.querySelector(
      "[data-testid='channel-gear-A']",
    ) as HTMLButtonElement;
    expect(gear.getAttribute("aria-haspopup")).toBe("dialog");
    expect(gear.getAttribute("aria-expanded")).toBe("false");
    expect(popoverCount()).toBe(0);

    const popover = await openChannelPopover("A");
    expect(popover).not.toBeNull();
    expect(popover.getAttribute("role")).toBe("dialog");
    expect(popover.getAttribute("aria-modal")).toBe("false");
    expect(popover.getAttribute("aria-label")).toBe("Configure Channel A");
    expect(gear.getAttribute("aria-expanded")).toBe("true");

    // Initial focus lands on the first interactive element (hero square).
    expect(document.activeElement).toBe(
      popover.querySelector("[data-testid='hero-color-square']"),
    );

    // Esc dismisses the popover and returns focus to the gear.
    await act(async () => {
      popover.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(popoverCount()).toBe(0);
    expect(gear.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(gear);
  });

  it("AC6: Esc blurs a focused field first, the next Esc dismisses", async () => {
    const popover = await openChannelPopover("A");
    const nameField = popover.querySelector(
      "[data-testid='popover-name-field']",
    ) as HTMLInputElement;
    nameField.focus();

    await act(async () => {
      nameField.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await new Promise((r) => setTimeout(r, 30));
    });
    // First Esc only blurs the field; the popover survives.
    expect(popoverCount()).toBe(1);
    expect(document.activeElement).not.toBe(nameField);

    await act(async () => {
      popover.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(popoverCount()).toBe(0);
  });

  it("AC6: outside pointerdown dismisses the popover without stealing focus", async () => {
    await openChannelPopover("A");
    expect(popoverCount()).toBe(1);
    await act(async () => {
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(popoverCount()).toBe(0);
  });

  it("AC5: opening one popover dismisses any other (single openKey)", async () => {
    await openChannelPopover("A");
    expect(popoverCount()).toBe(1);
    const cursorPopover = await openCursorPopover("c1");
    expect(popoverCount()).toBe(1);
    expect(cursorPopover.getAttribute("aria-label")).toBe(
      "Configure Cursor C1",
    );
  });

  it("AC2: hero carries the ghost name field (live commit) and the unwrapped stats line", async () => {
    const popover = await openChannelPopover("A");

    const nameField = popover.querySelector(
      "[data-testid='popover-name-field']",
    ) as HTMLInputElement;
    expect(nameField.maxLength).toBe(24);
    expect(nameField.getAttribute("placeholder")).toBe("Channel A");
    expect(nameField.getAttribute("aria-label")).toBe(
      "Custom name for channel A",
    );

    await act(async () => {
      setReactInputValue(nameField, "V_grid");
      await new Promise((r) => setTimeout(r, 30));
    });
    // Live commit into the same store the inline rename writes.
    expect(useChannelNamesStore.getState().names.A).toBe("V_grid");

    // Stats line: sample count + voltage extents, monospace, never wraps.
    const stats = popover.querySelector(
      "[data-testid='channel-stats']",
    ) as HTMLElement;
    expect(stats.textContent).toBe(
      "1,000 samples \u00b7 \u22123.00 V \u2026 +3.00 V",
    );
    const statsStyle = window.getComputedStyle(stats);
    expect(statsStyle.whiteSpace).toBe("nowrap");
    expect(statsStyle.fontFamily).toContain("monospace");
  });

  it("AC2: hero square shows the effective color at opacity over a checkerboard and toggles the color detail", async () => {
    const popover = await openChannelPopover("A");
    const square = popover.querySelector(
      "[data-testid='hero-color-square']",
    ) as HTMLButtonElement;
    expect(square.getAttribute("aria-label")).toBe("Expand color detail");
    expect(square.getAttribute("aria-expanded")).toBe("false");
    // Effective dark-theme default for A is gold, at 100% opacity
    // (CSSOM normalizes hex to rgb()).
    expect(square.style.background).toContain("rgb(255, 215, 0)");

    await expandColorDetail();
    expect(square.getAttribute("aria-expanded")).toBe("true");
    expect(
      popover.querySelector("[data-testid='badge-color-detail']"),
    ).not.toBeNull();

    // Scrubbing gold down blends it over the checkerboard (still gold hue).
    await act(async () => {
      usePaletteStore.getState().setKeyOpacity("A", 30);
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(square.style.background).toMatch(/rgba\(255, 215, 0, 0\.3\)/);
  });

  it("AC2: quick knobs hold opacity preset chips (aria-pressed) + dual-canvas preview + low-contrast guard", async () => {
    const popover = await openChannelPopover("A");

    // Chips reflect state via aria-pressed; 100 is initially pressed.
    const chip100 = popover.querySelector(
      "[data-testid='opacity-chip-100']",
    ) as HTMLButtonElement;
    const chip25 = popover.querySelector(
      "[data-testid='opacity-chip-25']",
    ) as HTMLButtonElement;
    expect(chip100.getAttribute("aria-pressed")).toBe("true");
    expect(chip25.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      chip25.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(usePaletteStore.getState().keyConfigs.A).toEqual({ opacity: 25 });
    expect(chip25.getAttribute("aria-pressed")).toBe("true");
    expect(chip100.getAttribute("aria-pressed")).toBe("false");

    // Non-preset values simply unlight all chips.
    await act(async () => {
      usePaletteStore.getState().setKeyOpacity("A", 60);
      await new Promise((r) => setTimeout(r, 30));
    });
    for (const p of [25, 50, 75, 100]) {
      expect(
        (
          popover.querySelector(
            `[data-testid='opacity-chip-${p}']`,
          ) as HTMLButtonElement
        ).getAttribute("aria-pressed"),
      ).toBe("false");
    }

    // Dual-canvas preview strokes the exact color + opacity over both
    // theme backgrounds.
    const preview = popover.querySelector(
      "[data-testid='dual-canvas-preview']",
    ) as HTMLElement;
    const canvases = preview.querySelectorAll(".badge-preview-canvas");
    expect(canvases.length).toBe(2);
    expect((canvases[0] as HTMLElement).style.background).toBe("rgb(0, 0, 0)");
    expect((canvases[1] as HTMLElement).style.background).toBe(
      "rgb(255, 255, 255)",
    );
    const paths = preview.querySelectorAll(".badge-preview-wave");
    expect(paths.length).toBe(2);
    expect(paths[0]!.getAttribute("stroke")).toBe("rgba(255, 215, 0, 0.60)");

    // Gold is high-contrast: the advisory guard stays hidden.
    const warn = popover.querySelector(
      "[data-testid='low-contrast-warning']",
    ) as HTMLElement;
    expect(warn.className).not.toContain("badge-contrast-warn--show");

    // A dim trace color shows the advisory (never blocks anything).
    await act(async () => {
      usePaletteStore.getState().setCustomColor("A", "#00008B");
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(warn.className).toContain("badge-contrast-warn--show");
  });

  it("AC2: color detail carries the 15-column swatch matrix and the one-line footer", async () => {
    const popover = await openChannelPopover("A");
    await expandColorDetail();

    const grid = popover.querySelector(
      "[data-testid='curated-swatch-grid']",
    ) as HTMLElement;
    const swatches = grid.querySelectorAll(".badge-grid-swatch");
    expect(swatches.length).toBe(30);
    expect(
      window.getComputedStyle(grid).gridTemplateColumns.split(" ").length,
    ).toBe(15);

    // Curated swatch applies live.
    await act(async () => {
      (
        popover.querySelector(
          "[data-testid='config-swatch-#FF4444']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(usePaletteStore.getState().customColors.A).toBe("#ff4444");
    const active = popover.querySelector(
      '.badge-grid-swatch[aria-pressed="true"]',
    ) as HTMLButtonElement;
    expect(active.getAttribute("data-testid")).toBe("config-swatch-#FF4444");

    // One-line footer: native picker + hex (12ch) + scrub field + reset.
    const footer = popover.querySelector(
      ".badge-color-detail-footer",
    ) as HTMLElement;
    expect(
      footer.querySelector("[data-testid='config-native-picker']"),
    ).not.toBeNull();
    const hex = footer.querySelector(
      "[data-testid='config-hex']",
    ) as HTMLInputElement;
    expect(hex.value).toBe("#ff4444");
    expect(
      footer.querySelector("[data-testid='opacity-scrub-field']"),
    ).not.toBeNull();
    expect(footer.querySelector("[data-testid='config-reset']")).not.toBeNull();
  });

  it("AC2: hex entry commits valid values live (canonical lowercase); invalid drafts roll back on blur", async () => {
    const popover = await openChannelPopover("A");
    await expandColorDetail();
    const hex = popover.querySelector(
      "[data-testid='config-hex']",
    ) as HTMLInputElement;

    await act(async () => {
      setReactInputValue(hex, "#00FF00");
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(usePaletteStore.getState().customColors.A).toBe("#00ff00");
    expect(hex.value).toBe("#00ff00");

    // Invalid draft: flagged, not committed.
    await act(async () => {
      setReactInputValue(hex, "nope");
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(usePaletteStore.getState().customColors.A).toBe("#00ff00");
    expect(hex.getAttribute("aria-invalid")).toBe("true");
    expect(hex.className).toContain("badge-hex--invalid");

    // Blur rolls the invalid draft back to the effective color.
    await act(async () => {
      hex.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
      hex.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(hex.value).toBe("#00ff00");
    expect(hex.className).not.toContain("badge-hex--invalid");
  });

  it("AC2: precise opacity scrub field — steppers, typing, clamping, arrow keys", async () => {
    const popover = await openChannelPopover("A");
    await expandColorDetail();

    const down = popover.querySelector(
      "[data-testid='opacity-step-down']",
    ) as HTMLButtonElement;
    const up = popover.querySelector(
      "[data-testid='opacity-step-up']",
    ) as HTMLButtonElement;
    const input = popover.querySelector(
      "[data-testid='opacity-scrub-input']",
    ) as HTMLInputElement;
    expect(input.getAttribute("min")).toBe("5");
    expect(input.getAttribute("max")).toBe("100");

    // Steppers move in ±5 increments.
    await act(async () => {
      down.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(usePaletteStore.getState().keyConfigs.A).toEqual({ opacity: 95 });
    await act(async () => {
      up.click();
      up.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    // Back at 100 = default: the record prunes away entirely.
    expect(usePaletteStore.getState().keyConfigs.A).toBeUndefined();

    // Typing an exact value commits.
    await act(async () => {
      setReactInputValue(input, "42");
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(usePaletteStore.getState().keyConfigs.A).toEqual({ opacity: 42 });

    // Clamped to 5–100.
    await act(async () => {
      setReactInputValue(input, "3");
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(usePaletteStore.getState().keyConfigs.A).toEqual({ opacity: 5 });

    // Native arrow-key stepping for keyboard users.
    await act(async () => {
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(usePaletteStore.getState().keyConfigs.A).toEqual({ opacity: 6 });
  });

  it("AC2/AC4: \u21ba reset restores theme-default color AND 100% opacity, disabled at defaults", async () => {
    const popover = await openChannelPopover("A");
    await expandColorDetail();
    const reset = popover.querySelector(
      "[data-testid='config-reset']",
    ) as HTMLButtonElement;

    // Gold on dark + 100% = defaults: disabled.
    expect(reset.disabled).toBe(true);

    await act(async () => {
      usePaletteStore.getState().setCustomColor("A", "#FF4444");
      usePaletteStore.getState().setKeyOpacity("A", 30);
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(reset.disabled).toBe(false);

    await act(async () => {
      reset.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(usePaletteStore.getState().customColors).toEqual({});
    expect(usePaletteStore.getState().keyConfigs).toEqual({});
    expect(reset.disabled).toBe(true);
    // Per-key persistence entry is gone entirely.
    expect(window.localStorage.getItem("fvf.channel-palette")).toBeNull();
  });

  it("AC3: cursor popover — static title, position stats, movement hint, identical color/opacity controls", async () => {
    await act(async () => {
      useCursorStore.getState().setCursorActive("C1", true, 1000);
      useCursorStore.getState().setCursorSample("C1", 250, 1000);
      await new Promise((r) => setTimeout(r, 30));
    });

    const popover = await openCursorPopover("c1");
    expect(popover.querySelector(".badge-static-title")?.textContent).toBe(
      "Cursor C1",
    );
    // Not renamable: no ghost field.
    expect(
      popover.querySelector("[data-testid='popover-name-field']"),
    ).toBeNull();

    const stats = popover.querySelector(
      "[data-testid='cursor-stats']",
    ) as HTMLElement;
    expect(stats.textContent).toMatch(/^Sample 250 \u00b7 .+ ms$/);

    const hint = popover.querySelector(
      "[data-testid='cursor-movement-hint']",
    ) as HTMLElement;
    expect(hint.textContent).toBe(CURSOR_MOVEMENT_SUMMARY);

    // Identical color/opacity controls.
    expect(
      popover.querySelector("[data-testid='opacity-chip-50']"),
    ).not.toBeNull();
    expect(
      popover.querySelector("[data-testid='dual-canvas-preview']"),
    ).not.toBeNull();
    await expandColorDetail();
    expect(
      popover.querySelector("[data-testid='curated-swatch-grid']"),
    ).not.toBeNull();

    // Cursor opacity binds the C1 palette key.
    await act(async () => {
      (
        popover.querySelector(
          "[data-testid='opacity-chip-50']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(usePaletteStore.getState().keyConfigs.C1).toEqual({ opacity: 50 });
  });

  it("issue #227 AC1/AC3: cursor preview draws a vertical cursor line over a muted mock waveform on both panels, updating live", async () => {
    const popover = await openCursorPopover("c1");
    const darkPanel = popover.querySelector(
      ".badge-preview-canvas--dark",
    ) as HTMLElement;
    const lightPanel = popover.querySelector(
      ".badge-preview-canvas--light",
    ) as HTMLElement;

    // Vertical line spans the full panel height on both panels.
    const lines = [darkPanel, lightPanel].map(
      (panel) =>
        panel.querySelector(
          "[data-testid='cursor-preview-line']",
        ) as SVGLineElement,
    );
    expect(lines[0]).not.toBeNull();
    expect(lines[1]).not.toBeNull();
    for (const line of lines) {
      expect(line.getAttribute("y1")).toBe("0");
      expect(line.getAttribute("y2")).toBe("44");
      expect(line.getAttribute("x1")).toBe(line.getAttribute("x2"));
    }

    // The line carries the effective cursor color at the current opacity
    // (defaults: dark theme C1 #E040FB at 100%).
    expect(lines[0]!.getAttribute("stroke")).toBe("#E040FB");
    expect(lines[1]!.getAttribute("stroke")).toBe("#E040FB");

    // Tiny handle glyph at the top: solid fill (canvas handles stay solid
    // while the line carries the per-key opacity).
    const handle = darkPanel.querySelector(
      "[data-testid='cursor-preview-handle']",
    ) as SVGPathElement;
    expect(handle.getAttribute("fill")).toBe("#E040FB");

    // The background wave is a deliberately muted neutral per panel —
    // never the cursor color — and the channel-style colored wave stroke
    // is absent from the cursor popover entirely.
    const darkWave = darkPanel.querySelector(
      ".badge-preview-mockwave",
    ) as SVGPathElement;
    const lightWave = lightPanel.querySelector(
      ".badge-preview-mockwave",
    ) as SVGPathElement;
    expect(darkWave.getAttribute("stroke")).toBe("#3f3f3f");
    expect(lightWave.getAttribute("stroke")).toBe("#a9a9a9");
    expect(popover.querySelectorAll(".badge-preview-wave").length).toBe(0);

    // Live update via an opacity preset chip: the line re-strokes to 25%.
    await act(async () => {
      (
        popover.querySelector(
          "[data-testid='opacity-chip-25']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(lines[0]!.getAttribute("stroke")).toBe("rgba(224, 64, 251, 0.25)");

    // Live update via a custom color: line and handle re-color in place.
    await act(async () => {
      usePaletteStore.getState().setCustomColor("C1", "#00ff7f");
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(lines[0]!.getAttribute("stroke")).toBe("rgba(0, 255, 127, 0.25)");
    expect(handle.getAttribute("fill")).toBe("#00ff7f");
  });

  it("issue #226 AC1/AC4: measurement units live in cursor popovers only, are shared across both, and persist", async () => {
    // Channel popovers carry neither new section.
    const channelPopover = await openChannelPopover("A");
    expect(
      channelPopover.querySelector("[data-testid='measurement-units-section']"),
    ).toBeNull();
    expect(
      channelPopover.querySelector("[data-testid='line-style-section']"),
    ).toBeNull();

    // Cursor C1 at sample 0 → t = -5 ms under SI; the pinned `s` unit
    // distinguishes the position line (-0.005 s).
    await act(async () => {
      useCursorStore.getState().setCursorActive("C1", true, 1000);
      useCursorStore.getState().setCursorSample("C1", 0, 1000);
      await new Promise((r) => setTimeout(r, 30));
    });

    const popover = await openCursorPopover("c1");
    expect(
      popover.querySelector("[data-testid='measurement-units-section']"),
    ).not.toBeNull();
    const stats = popover.querySelector(
      "[data-testid='cursor-stats']",
    ) as HTMLElement;
    expect(stats.textContent).toBe("Sample 0 · -5.000 ms");

    await act(async () => {
      (
        popover.querySelector(
          "[data-testid='setting-time-s']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    // The popover position line reformats with the pinned unit.
    expect(stats.textContent).toBe("Sample 0 · -0.005 s");

    // The shared selection reflects identically in the C2 popover.
    const c2Popover = await openCursorPopover("c2");
    expect(c2Popover.getAttribute("aria-label")).toBe("Configure Cursor C2");
    expect(
      (
        c2Popover.querySelector(
          "[data-testid='setting-time-s']",
        ) as HTMLButtonElement
      ).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      (
        c2Popover.querySelector(
          "[data-testid='setting-time-si']",
        ) as HTMLButtonElement
      ).getAttribute("aria-pressed"),
    ).toBe("false");

    // Persistence: the global selection survives in session storage.
    expect(
      JSON.parse(window.localStorage.getItem(CURSOR_DISPLAY_STORAGE_KEY)!),
    ).toMatchObject({ timeUnit: "s" });
  });

  it("issue #226 AC3/AC4: per-cursor line styles are independent and persist", async () => {
    const c1Popover = await openCursorPopover("c1");
    expect(
      c1Popover.querySelector("[data-testid='line-style-section']"),
    ).not.toBeNull();

    await act(async () => {
      (
        c1Popover.querySelector(
          "[data-testid='setting-line-style-dashed']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(useCursorDisplayStore.getState().lineStyles).toEqual({
      C1: "dashed",
      C2: "solid",
    });

    // The other cursor's popover still shows its own (solid) selection.
    const c2Popover = await openCursorPopover("c2");
    expect(
      (
        c2Popover.querySelector(
          "[data-testid='setting-line-style-solid']",
        ) as HTMLButtonElement
      ).getAttribute("aria-pressed"),
    ).toBe("true");
    await act(async () => {
      (
        c2Popover.querySelector(
          "[data-testid='setting-line-style-dotted']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(useCursorDisplayStore.getState().lineStyles).toEqual({
      C1: "dashed",
      C2: "dotted",
    });
    expect(
      JSON.parse(window.localStorage.getItem(CURSOR_DISPLAY_STORAGE_KEY)!),
    ).toMatchObject({ lineStyles: { C1: "dashed", C2: "dotted" } });
  });

  it("issue #225 AC1/AC4: channel binding is per-cursor and persists", async () => {
    const c1Popover = await openCursorPopover("c1");
    const section = c1Popover.querySelector(
      "[data-testid='channel-binding-section']",
    );
    expect(section).not.toBeNull();

    await act(async () => {
      (
        c1Popover.querySelector(
          "[data-testid='setting-binding-b']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(useCursorDisplayStore.getState().bindings).toEqual({
      C1: "B",
      C2: "all",
    });

    // The other cursor's binding is independent.
    const c2Popover = await openCursorPopover("c2");
    expect(
      (
        c2Popover.querySelector(
          "[data-testid='setting-binding-all']",
        ) as HTMLButtonElement
      ).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      JSON.parse(window.localStorage.getItem(CURSOR_DISPLAY_STORAGE_KEY)!),
    ).toMatchObject({ bindings: { C1: "B", C2: "all" } });
  });

  it("issue #225 AC2/AC4: locked Δt is one shared toggle surfaced in both popovers", async () => {
    const c1Popover = await openCursorPopover("c1");
    const lock1 = c1Popover.querySelector(
      "[data-testid='setting-delta-lock']",
    ) as HTMLButtonElement;
    expect(lock1.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      lock1.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(useCursorDisplayStore.getState().deltaLocked).toBe(true);

    // The C2 popover reflects the same shared state (one pair-level flag).
    const c2Popover = await openCursorPopover("c2");
    const lock2 = c2Popover.querySelector(
      "[data-testid='setting-delta-lock']",
    ) as HTMLButtonElement;
    expect(lock2.getAttribute("aria-pressed")).toBe("true");
    expect(lock2.textContent).toBe("Locked");
  });

  it("issue #227 AC2: channel preview remains the waveform stroke (no cursor line, no mock wave)", async () => {
    const popover = await openChannelPopover("A");

    expect(popover.querySelectorAll(".badge-preview-wave").length).toBe(2);
    expect(
      popover.querySelector("[data-testid='cursor-preview-line']"),
    ).toBeNull();
    expect(
      popover.querySelector("[data-testid='cursor-preview-handle']"),
    ).toBeNull();
    expect(popover.querySelector(".badge-preview-mockwave")).toBeNull();
  });

  it("AC4: per-key {color, opacity} records persist alongside the palette", async () => {
    const popover = await openChannelPopover("A");
    await expandColorDetail();

    await act(async () => {
      (
        popover.querySelector(
          "[data-testid='config-swatch-#FF4444']",
        ) as HTMLButtonElement
      ).click();
      (
        popover.querySelector(
          "[data-testid='opacity-chip-25']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(
      JSON.parse(window.localStorage.getItem("fvf.channel-palette")!),
    ).toEqual({
      A: { color: "#ff4444", opacity: 25 },
    });
  });

  it("issue #262 AC2/AC3: AnchoredPopover evaluates projected anchor geometry on first open for right collision and vertical flip", async () => {
    await page.viewport(1280, 800);
    try {
      // Left-anchored (Channel A) does not trigger right collision or flip on desktop
      const popoverA = await openChannelPopover("A");
      expect(popoverA.className).not.toContain("badge-popover--anchor-r");
      expect(popoverA.className).not.toContain("badge-popover--flip");
      const rectA = popoverA.getBoundingClientRect();
      expect(rectA.left).toBeGreaterThanOrEqual(12);

      // Close Channel A popover
      await act(async () => {
        useBadgePopoverStore.getState().setOpen(null);
        await new Promise((r) => setTimeout(r, 30));
      });

      // Test a right-anchored trigger element
      const rightAnchor = document.createElement("button");
      rightAnchor.style.position = "fixed";
      rightAnchor.style.top = "50px";
      rightAnchor.style.left = `${window.innerWidth - 80}px`;
      rightAnchor.style.width = "40px";
      rightAnchor.style.height = "30px";
      document.body.appendChild(rightAnchor);

      const testRootEl = document.createElement("div");
      document.body.appendChild(testRootEl);
      const testRoot = createRoot(testRootEl);

      try {
        await act(async () => {
          testRoot.render(
            <AnchoredPopover
              openKey="test-right"
              anchorEl={rightAnchor}
              ariaLabel="Test Right"
              testId="test-right-popover"
              onClose={() => useBadgePopoverStore.getState().setOpen(null)}
            >
              <div style={{ width: "390px", height: "100px" }}>
                Right Content
              </div>
            </AnchoredPopover>,
          );
        });

        // Open on the very first try
        await act(async () => {
          useBadgePopoverStore.getState().setOpen("test-right");
          await new Promise((r) => setTimeout(r, 40));
        });

        const rightPop = document.querySelector(
          "[data-testid='test-right-popover']",
        ) as HTMLElement;
        expect(rightPop).not.toBeNull();
        expect(rightPop.className).toContain("badge-popover--anchor-r");
        const rightRect = rightPop.getBoundingClientRect();
        expect(rightRect.right).toBeLessThanOrEqual(window.innerWidth - 12);
        expect(rightRect.left).toBeGreaterThanOrEqual(12);

        // Close and test bottom trigger for vertical flip
        await act(async () => {
          useBadgePopoverStore.getState().setOpen(null);
          await new Promise((r) => setTimeout(r, 30));
        });

        const bottomAnchor = document.createElement("button");
        bottomAnchor.style.position = "fixed";
        bottomAnchor.style.top = `${window.innerHeight - 40}px`;
        bottomAnchor.style.left = "100px";
        bottomAnchor.style.width = "40px";
        bottomAnchor.style.height = "30px";
        document.body.appendChild(bottomAnchor);

        try {
          await act(async () => {
            testRoot.render(
              <AnchoredPopover
                openKey="test-bottom"
                anchorEl={bottomAnchor}
                ariaLabel="Test Bottom"
                testId="test-bottom-popover"
                onClose={() => useBadgePopoverStore.getState().setOpen(null)}
              >
                <div style={{ width: "390px", height: "100px" }}>
                  Bottom Content
                </div>
              </AnchoredPopover>,
            );
          });

          await act(async () => {
            useBadgePopoverStore.getState().setOpen("test-bottom");
            await new Promise((r) => setTimeout(r, 40));
          });

          const bottomPop = document.querySelector(
            "[data-testid='test-bottom-popover']",
          ) as HTMLElement;
          expect(bottomPop).not.toBeNull();
          expect(bottomPop.className).toContain("badge-popover--flip");
        } finally {
          bottomAnchor.remove();
        }
      } finally {
        act(() => testRoot.unmount());
        testRootEl.remove();
        rightAnchor.remove();
        useBadgePopoverStore.getState().setOpen(null);
      }
    } finally {
      await page.viewport(414, 896);
    }
  });
});
