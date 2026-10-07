import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import WaveformToolbar from "../WaveformToolbar";
import "../../../index.css";
import { useCaptureStore } from "../../../state/captureStore";
import { useChannelNamesStore } from "../../../state/channelNamesStore";
import { useCursorStore } from "../../../state/cursorStore";
import { usePaletteStore } from "../../../state/paletteStore";
import { useThemeStore } from "../../../state/themeStore";
import { useBadgePopoverStore } from "./anchoredPopover";
import {
  CHANNEL_DISPLAY_STORAGE_KEY,
  useChannelDisplayStore,
} from "../../../state/channelDisplayStore";
import { useViewportStore } from "../../../state/viewportStore";
import type { ParsedCapture } from "../../../types/capture";

/**
 * Issue #224: the channel popover's Display section — Y-scale %, vertical
 * offset, invert ± (per-key persisted), the derived ≈ V/Div readout, and
 * the Solo quick-knob beside the opacity presets. Cursor popovers never
 * render the section; the #204 testid surface is untouched.
 */

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

describe("Channel display settings (issue #224)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;

  function setReactInputValue(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const openPopover = async (gear: string) => {
    await act(async () => {
      (
        hostElement.querySelector(
          `[data-testid='${gear}']`,
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    return document.body.querySelector(
      "[data-testid='badge-config-popover']",
    ) as HTMLElement;
  };

  const stored = (): { keyConfigs: Record<string, unknown> } | null => {
    const raw = window.localStorage.getItem(CHANNEL_DISPLAY_STORAGE_KEY);
    return raw
      ? (JSON.parse(raw) as { keyConfigs: Record<string, unknown> })
      : null;
  };

  beforeEach(() => {
    useBadgePopoverStore.getState().setOpen(null);
    window.localStorage.clear();
    useChannelDisplayStore.getState().reset();
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
    useChannelNamesStore.setState({ fileKey: null, names: {} });
    useCaptureStore.setState({ capture: createTestCapture() });
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
    act(() => root.unmount());
    hostElement.remove();
    document.body
      .querySelectorAll(".badge-popover-anchor")
      .forEach((n) => n.remove());
  });

  it("renders the Display section in channel popovers only", async () => {
    const channelPopover = await openPopover("channel-gear-A");
    expect(
      channelPopover.querySelector("[data-testid='channel-display-section']"),
    ).not.toBeNull();
    expect(
      channelPopover.querySelector("[data-testid='scale-scrub-field']"),
    ).not.toBeNull();
    expect(
      channelPopover.querySelector("[data-testid='offset-scrub-field']"),
    ).not.toBeNull();
    expect(
      channelPopover.querySelector("[data-testid='invert-toggle']"),
    ).not.toBeNull();
    expect(
      channelPopover.querySelector("[data-testid='solo-chip-A']"),
    ).not.toBeNull();

    const cursorPopover = await openPopover("cursor-gear-c1");
    expect(
      cursorPopover.querySelector("[data-testid='channel-display-section']"),
    ).toBeNull();
    expect(
      cursorPopover.querySelector("[data-testid='solo-chip-C1']"),
    ).toBeNull();
  });

  it("Y-scale commits through the scrub field, clamps to 10–500, and persists per key", async () => {
    const popover = await openPopover("channel-gear-A");
    const input = popover.querySelector(
      "[data-testid='scale-scrub-input']",
    ) as HTMLInputElement;
    await act(async () => {
      setReactInputValue(input, "250");
    });
    expect(useChannelDisplayStore.getState().keyConfigs.A?.yScalePercent).toBe(
      250,
    );
    expect(stored()?.keyConfigs.A).toEqual({ yScalePercent: 250 });

    await act(async () => {
      setReactInputValue(input, "9999");
    });
    expect(useChannelDisplayStore.getState().keyConfigs.A?.yScalePercent).toBe(
      500,
    );
    await act(async () => {
      setReactInputValue(input, "1");
    });
    expect(useChannelDisplayStore.getState().keyConfigs.A?.yScalePercent).toBe(
      10,
    );
  });

  it("the 100% chip resets the Y-scale and prunes the record", async () => {
    useChannelDisplayStore.getState().setYScale("A", 250);
    const popover = await openPopover("channel-gear-A");
    await act(async () => {
      (
        popover.querySelector(
          "[data-testid='scale-reset-chip']",
        ) as HTMLButtonElement
      ).click();
    });
    expect(useChannelDisplayStore.getState().keyConfigs.A).toBeUndefined();
    expect(stored()?.keyConfigs.A).toBeUndefined();
  });

  it("offset commits in the channel's axis unit and reset-to-0 prunes", async () => {
    const popover = await openPopover("channel-gear-A");
    const input = popover.querySelector(
      "[data-testid='offset-scrub-input']",
    ) as HTMLInputElement;
    // Channel A is the synthetic volt channel: the unit suffix reads V.
    expect(
      popover.querySelector(
        "[data-testid='offset-scrub-field'] .badge-opacity-unit",
      )?.textContent,
    ).toBe("V");
    await act(async () => {
      setReactInputValue(input, "2.5");
    });
    expect(useChannelDisplayStore.getState().keyConfigs.A?.offset).toBe(2.5);
    expect(stored()?.keyConfigs.A).toEqual({ offset: 2.5 });

    await act(async () => {
      (
        popover.querySelector(
          "[data-testid='offset-reset']",
        ) as HTMLButtonElement
      ).click();
    });
    expect(useChannelDisplayStore.getState().keyConfigs.A).toBeUndefined();
    expect(stored()?.keyConfigs.A).toBeUndefined();
  });

  it("invert flips readouts consistently while scale/offset never alter them", async () => {
    // Channel D has extents [0, +5] V — asymmetric, so the flip is visible.
    const popover = await openPopover("channel-gear-D");
    const stats = () =>
      popover.querySelector("[data-testid='channel-stats']")?.textContent ?? "";

    expect(stats()).toContain("+5.00 V");

    // Display-only transforms never touch the physical extents readout.
    useChannelDisplayStore.getState().setYScale("D", 250);
    useChannelDisplayStore.getState().setOffset("D", 3);
    expect(stats()).toContain("+5.00 V");
    expect(stats()).not.toContain("−5.00");

    // Invert ± flips displayed trace AND readouts consistently.
    await act(async () => {
      (
        popover.querySelector(
          "[data-testid='invert-toggle']",
        ) as HTMLButtonElement
      ).click();
    });
    expect(useChannelDisplayStore.getState().keyConfigs.D?.inverted).toBe(true);
    expect(stored()?.keyConfigs.D).toEqual({
      yScalePercent: 250,
      offset: 3,
      inverted: true,
    });
    expect(stats()).toContain("−5.00");
    expect(stats()).not.toContain("+5.00");
  });

  it("solo isolates the channel, restores on second click, and persists", async () => {
    const popover = await openPopover("channel-gear-B");
    const chip = popover.querySelector(
      "[data-testid='solo-chip-B']",
    ) as HTMLButtonElement;
    expect(chip.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      chip.click();
    });
    expect(useViewportStore.getState().activeChannels).toEqual(["B"]);
    expect(useChannelDisplayStore.getState().solo).toEqual({
      key: "B",
      savedActive: ["A", "B", "C", "D"],
    });
    expect(
      (
        popover.querySelector(
          "[data-testid='solo-chip-B']",
        ) as HTMLButtonElement
      ).getAttribute("aria-pressed"),
    ).toBe("true");

    await act(async () => {
      (
        popover.querySelector(
          "[data-testid='solo-chip-B']",
        ) as HTMLButtonElement
      ).click();
    });
    expect(useViewportStore.getState().activeChannels).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(useChannelDisplayStore.getState().solo).toBeNull();
  });

  it("the derived ≈ V/Div readout tracks live viewport geometry and scale", async () => {
    // Plant a fake live plot handle: 800 CSS px wide (2x device ratio),
    // 400 CSS px tall, channel A's y0 scale showing [-10, +10].
    const fakeContainer = document.createElement("div");
    fakeContainer.setAttribute("data-testid", "oscilloscope-container");
    const fakeUplot = {
      width: 800,
      bbox: { height: 800, left: 0, width: 800 },
      ctx: { canvas: { width: 1600 } },
      scales: { x: { min: -1, max: 1 }, y0: { min: -10, max: 10 } },
    };
    (fakeContainer as HTMLElement & { __uplot?: unknown }).__uplot = fakeUplot;
    document.body.appendChild(fakeContainer);

    try {
      const popover = await openPopover("channel-gear-A");
      const readout = popover.querySelector(
        "[data-testid='perdiv-readout']",
      ) as HTMLElement;
      expect(readout.textContent).toBe("≈ 2 V/Div");

      // 200% scale: geometry ÷ scale halves the effective per-division.
      await act(async () => {
        useChannelDisplayStore.getState().setYScale("A", 200);
      });
      expect(
        (popover.querySelector("[data-testid='perdiv-readout']") as HTMLElement)
          .textContent,
      ).toBe("≈ 1 V/Div");
    } finally {
      fakeContainer.remove();
    }
  });
});
