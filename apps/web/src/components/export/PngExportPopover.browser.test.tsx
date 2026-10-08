import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type uPlot from "uplot";
import fourChUrlQ from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import Oscilloscope from "../canvas/Oscilloscope";
import WaveformToolbar from "../toolbar/WaveformToolbar";
import "../../index.css";
import {
  PNG_EXPORT_DEFAULTS,
  usePngExportStore,
} from "../../state/pngExportStore";
import { useCaptureStore } from "../../state/captureStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import { useCursorStore } from "../../state/cursorStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useThemeStore } from "../../state/themeStore";
import { useViewportStore } from "../../state/viewportStore";
import { useBadgePopoverStore } from "../toolbar/badgeConfig/anchoredPopover";
import { useSnapshotStore } from "./snapshotStore";

/**
 * Issue #252 acceptance: the PNG export options popover on a split-action
 * Export chip — theme, background, readout card, cursors, grid, and
 * filename — with one persisted source of truth shared by the download
 * and clipboard paths, anchored-portal chrome (collision handling,
 * mutual exclusivity), the accessibility bar, and defaults
 * byte-compatible with today's export.
 */

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching ${url}`).toBeTruthy();
  return response.arrayBuffer();
}

interface CapturedExport {
  settings: typeof PNG_EXPORT_DEFAULTS;
  blob: Blob;
}

describe("PNG export options popover (issue #252)", () => {
  let host: HTMLDivElement;
  let root: Root;

  const mountFullUi = async (): Promise<void> => {
    await act(async () => {
      root.render(
        <div>
          {/* The toolbar already embeds the split-action Export chip. */}
          <WaveformToolbar />
          <Oscilloscope />
        </div>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
  };

  const settle = async (ms = 60): Promise<void> => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  };

  /**
   * Replaces the live exporter with a capturing stub. Call BEFORE
   * mounting (the button binds at render) and re-assert with
   * `reattach` after the Oscilloscope has registered its own exporter
   * at mount — inside act, so subscribed components re-render
   * synchronously and the button's click closure picks the stub up.
   */
  const captureExports = (): {
    captured: CapturedExport[];
    reattach: () => void;
  } => {
    const captured: CapturedExport[] = [];
    const stub = async (settings: typeof PNG_EXPORT_DEFAULTS) => {
      captured.push({ settings: { ...settings }, blob: new Blob(["x"]) });
      return captured[captured.length - 1]!.blob;
    };
    const attach = (): void => {
      useSnapshotStore.getState().registerExporter(stub);
    };
    attach();
    return { captured, reattach: () => act(attach) };
  };

  const openPopover = async (): Promise<void> => {
    await act(async () => {
      (
        document.querySelector(
          "[data-testid='png-export-gear']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(
      document.querySelector("[data-testid='png-export-popover']"),
    ).not.toBeNull();
  };

  beforeEach(async () => {
    useBadgePopoverStore.getState().setOpen(null);
    window.localStorage.clear();
    usePngExportStore.getState().setTheme("dark");
    usePngExportStore.getState().setBackground("opaque");
    usePngExportStore.getState().setReadoutCard("full");
    usePngExportStore.getState().setCursors(true);
    usePngExportStore.getState().setGrid(true);
    usePngExportStore.getState().setFileName("");
    useChannelDisplayStore.getState().reset();
    useCaptureStore.getState().reset();
    useReferenceStore.getState().clear();
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
    useChannelNamesStore.setState({ fileKey: null, names: {} });
    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(fourChUrlQ), "four.fvf");
    host = document.createElement("div");
    host.style.width = "900px";
    host.style.height = "640px";
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.localStorage.clear();
  });

  it("AC1: split-action chip — main zone exports immediately with current settings; gear opens the popover; the invert checkbox is gone", async () => {
    const { captured, reattach } = captureExports();
    await mountFullUi();
    reattach();

    expect(
      document.querySelector("[data-testid='png-invert-toggle']"),
    ).toBeNull();
    const main = document.querySelector(
      "[data-testid='png-export-button']",
    ) as HTMLButtonElement;
    const gear = document.querySelector(
      "[data-testid='png-export-gear']",
    ) as HTMLButtonElement;
    expect(main).not.toBeNull();
    expect(gear.getAttribute("aria-haspopup")).toBe("dialog");

    // One click on the main zone exports with the current settings —
    // no popover round-trip.
    await act(async () => {
      main.click();
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.settings.theme).toBe("dark");

    // The gear opens the options popover.
    await openPopover();
    expect(gear.getAttribute("aria-expanded")).toBe("true");
  });

  it("split-action chip geometry & popover layout: padding, hero header, and badge chips", async () => {
    await mountFullUi();

    const chip = document.querySelector(".png-export-chip") as HTMLElement;
    const main = document.querySelector(
      "[data-testid='png-export-button']",
    ) as HTMLButtonElement;
    const gear = document.querySelector(
      "[data-testid='png-export-gear']",
    ) as HTMLButtonElement;
    const divider = chip.querySelector(".badge-split-divider") as HTMLElement;

    // M3 split-action chip geometry
    const chipStyle = window.getComputedStyle(chip);
    expect(chipStyle.borderRadius).toBe("8px");
    expect(chip.offsetHeight).toBe(32);
    expect(divider).not.toBeNull();
    expect(window.getComputedStyle(divider).width).toBe("1px");

    // Transparent-bounds touch targets (>= 48px) and M3 state layers
    expect(main.offsetHeight).toBeGreaterThanOrEqual(48);
    expect(gear.offsetHeight).toBeGreaterThanOrEqual(48);
    const mainLayer = window.getComputedStyle(main, "::before");
    const gearLayer = window.getComputedStyle(gear, "::before");
    expect(mainLayer.content).not.toBe("none");
    expect(gearLayer.content).not.toBe("none");

    // Copy button geometry matches (32px height, 8px radius)
    const copyBtn = document.querySelector(
      "[data-testid='png-copy-button']",
    ) as HTMLButtonElement | null;
    if (copyBtn) {
      expect(copyBtn.offsetHeight).toBe(32);
      expect(window.getComputedStyle(copyBtn).borderRadius).toBe("8px");
    }

    // Open popover: chip gets --open class and gear brightens
    await openPopover();
    await settle(200);
    expect(chip.className).toContain("png-export-chip--open");
    expect(window.getComputedStyle(gear).color).toBe("rgb(255, 255, 255)");

    const popover = document.querySelector(
      "[data-testid='png-export-popover']",
    ) as HTMLElement;
    const hero = popover.querySelector(".badge-popover-hero") as HTMLElement;
    const body = popover.querySelector(".badge-popover-body") as HTMLElement;
    const closeBtn = popover.querySelector(
      "[data-testid='png-popover-close']",
    ) as HTMLButtonElement;

    // Popover has hero header and body with horizontal padding
    expect(hero).not.toBeNull();
    expect(body).not.toBeNull();
    expect(window.getComputedStyle(body).paddingLeft).toBe("14px");
    expect(window.getComputedStyle(body).paddingRight).toBe("14px");

    // Options use badge-opacity-chip badge-setting-chip and domains don't wrap awkwardly
    const domainLabels = popover.querySelectorAll(".png-export-domain");
    expect(domainLabels.length).toBeGreaterThan(0);
    const themeChip = popover.querySelector(
      "[data-testid='png-theme-dark']",
    ) as HTMLButtonElement;
    expect(themeChip.className).toContain("badge-opacity-chip");
    expect(themeChip.className).toContain("badge-setting-chip");
    expect(themeChip.getAttribute("aria-pressed")).toBe("true");

    // Close button dismisses popover and returns focus to gear
    await act(async () => {
      closeBtn.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(
      document.querySelector("[data-testid='png-export-popover']"),
    ).toBeNull();
    expect(document.activeElement).toBe(gear);
  });

  it("AC2+AC11: anchored-portal popover with mutual exclusivity and the accessibility bar", async () => {
    await mountFullUi();

    // Channel gear + export gear interoperate: opening one closes the other.
    await act(async () => {
      (
        document.querySelector(
          "[data-testid='channel-gear-A']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(
      document.querySelector("[data-testid='badge-config-popover']"),
    ).not.toBeNull();

    await act(async () => {
      (
        document.querySelector(
          "[data-testid='png-export-gear']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(
      document.querySelector("[data-testid='badge-config-popover']"),
    ).toBeNull();
    const popover = document.querySelector(
      "[data-testid='png-export-popover']",
    ) as HTMLElement;
    expect(popover).not.toBeNull();
    // role=dialog, non-modal, initial focus inside.
    expect(popover.getAttribute("role")).toBe("dialog");
    expect(popover.getAttribute("aria-modal")).toBe("false");
    await settle(50);
    expect(popover.contains(document.activeElement)).toBe(true);

    // Esc closes and returns focus to the gear.
    await act(async () => {
      popover.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(
      document.querySelector("[data-testid='png-export-popover']"),
    ).toBeNull();
    const gear = document.querySelector(
      "[data-testid='png-export-gear']",
    ) as HTMLButtonElement;
    expect(document.activeElement).toBe(gear);
  });

  it("AC3: theme — dark renders the screen snapshot settings, light the print pass settings", async () => {
    const { captured, reattach } = captureExports();
    await mountFullUi();
    reattach();
    await openPopover();

    await act(async () => {
      (
        document.querySelector(
          "[data-testid='png-theme-light']",
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        document.querySelector(
          "[data-testid='png-export-button']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(captured.at(-1)!.settings.theme).toBe("light");

    await act(async () => {
      (
        document.querySelector(
          "[data-testid='png-theme-dark']",
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        document.querySelector(
          "[data-testid='png-export-button']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(captured.at(-1)!.settings.theme).toBe("dark");
  });

  it("AC4+AC5+AC6+AC7: background / readout card / cursors / grid options reach the exporter", async () => {
    const { captured, reattach } = captureExports();
    await mountFullUi();
    reattach();
    await openPopover();

    const click = async (testId: string): Promise<void> => {
      await act(async () => {
        (
          document.querySelector(
            `[data-testid='${testId}']`,
          ) as HTMLButtonElement
        ).click();
      });
    };

    await click("png-bg-transparent");
    await click("png-card-excluded");
    await click("png-cursors-exclude");
    await click("png-grid-exclude");
    await act(async () => {
      (
        document.querySelector(
          "[data-testid='png-export-button']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 60));
    });

    const settings = captured.at(-1)!.settings;
    expect(settings.background).toBe("transparent");
    expect(settings.readoutCard).toBe("excluded");
    expect(settings.cursors).toBe(false);
    expect(settings.grid).toBe(false);

    // Collapsed card option too.
    await click("png-card-collapsed");
    await act(async () => {
      (
        document.querySelector(
          "[data-testid='png-export-button']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(captured.at(-1)!.settings.readoutCard).toBe("collapsed");
  });

  it("AC8+AC9: filename field live-commits (sanitized) and settings persist with validated hydration", async () => {
    await mountFullUi();
    await openPopover();

    const input = document.querySelector(
      "[data-testid='png-filename-field']",
    ) as HTMLInputElement;
    // Live commit per keystroke (channel custom-name mechanics); path
    // separators are stripped.
    await act(async () => {
      input.focus();
      input.select();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "my capture/v2");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(usePngExportStore.getState().settings.fileName).toBe("my capturev2");

    // Persisted per session: a fresh store hydrates the record (invalid
    // fields drop, valid ones survive).
    window.localStorage.setItem(
      "fvf.png-export",
      JSON.stringify({
        theme: "light",
        background: "bogus",
        readoutCard: "collapsed",
        cursors: false,
        grid: "yes",
        fileName: "kept.png",
      }),
    );
    const { createPngExportStore } = await import("../../state/pngExportStore");
    const hydrated = createPngExportStore().getState().settings;
    expect(hydrated.theme).toBe("light");
    expect(hydrated.background).toBe("opaque"); // invalid dropped -> default
    expect(hydrated.readoutCard).toBe("collapsed");
    expect(hydrated.cursors).toBe(false);
    expect(hydrated.grid).toBe(true); // invalid dropped -> default
    expect(hydrated.fileName).toBe("kept.png");
  });

  it("AC9: a fresh session starts from defaults that reproduce today's export behavior", async () => {
    await mountFullUi();
    const settings = usePngExportStore.getState().settings;
    expect(settings).toEqual(PNG_EXPORT_DEFAULTS);
    // The default route is the historical screen path: dark + opaque +
    // grid included (the exporter's routing guard).
    expect(settings.theme).toBe("dark");
    expect(settings.background).toBe("opaque");
    expect(settings.grid).toBe(true);
    expect(settings.readoutCard).toBe("full");
    expect(settings.cursors).toBe(true);
    expect(settings.fileName).toBe("");
    // Default record is not persisted (absence = defaults).
    expect(window.localStorage.getItem("fvf.png-export")).toBeNull();
  });

  it("AC10: the clipboard copy control uses the same settings and stays beside the chip", async () => {
    const { captured, reattach } = captureExports();
    await mountFullUi();
    reattach();

    const copy = document.querySelector(
      "[data-testid='png-copy-button']",
    ) as HTMLButtonElement | null;
    if (!copy) {
      // Clipboard image writes unsupported in this environment: the
      // control hides (progressive enhancement) — nothing to assert.
      expect(window.navigator.clipboard).toBeDefined();
      return;
    }
    await act(async () => {
      usePngExportStore.getState().setTheme("light");
    });
    await act(async () => {
      copy.click();
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(captured.at(-1)!.settings.theme).toBe("light");
    // Placement: the copy button sits right after the chip inside the
    // same controls span.
    const chip = document.querySelector(".png-export-chip") as HTMLElement;
    expect(chip.nextElementSibling).toBe(copy);
  });

  it("AC4 (compositing): transparent background exports alpha margins with theme ink", async () => {
    await mountFullUi();
    const capture = useCaptureStore.getState().capture!;
    const uplot = (
      document.querySelector(
        "[data-testid='oscilloscope-container']",
      ) as HTMLElement & { __uplot?: uPlot }
    ).__uplot!;
    await act(async () => {
      usePngExportStore.getState().setTheme("dark");
      usePngExportStore.getState().setBackground("transparent");
    });

    const { composePrintSnapshot } = await import("./pngSnapshot");
    const composite = await composePrintSnapshot(
      uplot,
      capture,
      {
        cursor1: "#E040FB",
        cursor2: "#B0B0B0",
        background: "#000000",
        legend: [],
        selected: null,
      },
      {
        series: capture.channels.map((channel) => ({
          label: channel.name,
          color: "#FFD700",
          show: true,
        })),
        palette: "dark",
        transparent: true,
      },
    );
    const ctx = composite.canvas.getContext("2d")!;
    // The margin corner is fully transparent (alpha 0)…
    const corner = ctx.getImageData(2, 2, 1, 1).data;
    expect(corner[3]).toBe(0);
    // …while the dark-theme ink stays opaque inside.
    const midX = Math.floor(composite.canvas.width / 2);
    const midY = Math.floor(composite.canvas.height / 2);
    let anyOpaqueInk = false;
    const probe = ctx.getImageData(midX - 40, midY - 40, 80, 80).data;
    for (let i = 3; i < probe.length; i += 4) {
      if (probe[i]! > 200) {
        anyOpaqueInk = true;
        break;
      }
    }
    expect(anyOpaqueInk).toBe(true);
  });

  it("AC7 (compositing): grid exclusion removes the graticule from the export only", async () => {
    await mountFullUi();
    const capture = useCaptureStore.getState().capture!;
    const uplot = (
      document.querySelector(
        "[data-testid='oscilloscope-container']",
      ) as HTMLElement & { __uplot?: uPlot }
    ).__uplot!;
    const { composePrintSnapshot } = await import("./pngSnapshot");
    const series = capture.channels.map((channel) => ({
      label: channel.name,
      color: "#FFD700",
      show: true,
    }));
    const overlay = {
      cursor1: "#E040FB",
      cursor2: "#B0B0B0",
      background: "#FFFFFF",
      legend: [] as Array<{ label: string; color: string }>,
      selected: null as "C1" | "C2" | null,
    };

    const withGrid = await composePrintSnapshot(uplot, capture, overlay, {
      series,
      palette: "light",
    });
    const withoutGrid = await composePrintSnapshot(uplot, capture, overlay, {
      series,
      palette: "light",
      omitGrid: true,
    });

    // The two renders are identical except for the graticule: count
    // differing pixels (the removed grid lines) across the plot area.
    const countGridPixels = (
      a: HTMLCanvasElement,
      b: HTMLCanvasElement,
    ): number => {
      if (a.width !== b.width || a.height !== b.height) return -1;
      const ctxA = a.getContext("2d")!;
      const ctxB = b.getContext("2d")!;
      const x0 = Math.round(uplot.bbox.left) + 10;
      const width = Math.min(200, Math.round(uplot.bbox.width) - 20);
      const y0 = Math.round(uplot.bbox.top) + 5;
      const height = Math.round(uplot.bbox.height) - 10;
      const ra = ctxA.getImageData(x0, y0, width, height).data;
      const rb = ctxB.getImageData(x0, y0, width, height).data;
      let diff = 0;
      for (let i = 0; i < ra.length; i += 4) {
        if (
          ra[i] !== rb[i] ||
          ra[i + 1] !== rb[i + 1] ||
          ra[i + 2] !== rb[i + 2] ||
          ra[i + 3] !== rb[i + 3]
        ) {
          diff += 1;
        }
      }
      return diff;
    };
    // The graticule's pixels exist in the with-grid render and are gone
    // in the gridless one: the two differ by the grid lines alone.
    const diff = countGridPixels(withGrid.canvas, withoutGrid.canvas);
    expect(diff).toBeGreaterThan(100);
    // And the on-screen view keeps its graticule (export args only).
    expect(useChannelDisplayStore.getState().stackMode).toBe(false);
    const liveRow = uplot.ctx.getImageData(
      uplot.bbox.left + 60,
      uplot.bbox.top + Math.round(0.25 * uplot.bbox.height),
      40,
      3,
    ).data;
    let liveGridish = 0;
    for (let i = 0; i < liveRow.length; i += 4) {
      const [r, g, b] = [liveRow[i]!, liveRow[i + 1]!, liveRow[i + 2]!];
      if (r !== 0 || g !== 0 || b !== 0) liveGridish += 1;
    }
    expect(liveGridish).toBeGreaterThan(0);
  });

  it("AC6 (compositing): cursor exclusion removes the cursor line from the export only", async () => {
    await mountFullUi();
    const capture = useCaptureStore.getState().capture!;
    const uplot = (
      document.querySelector(
        "[data-testid='oscilloscope-container']",
      ) as HTMLElement & { __uplot?: uPlot }
    ).__uplot!;
    const total = capture.timestamps.length;
    act(() => {
      useCursorStore.getState().setCursorActive("C1", true, total);
      useCursorStore
        .getState()
        .setCursorSample("C1", Math.floor(total / 2), total);
    });
    await settle(60);

    const { composeSnapshotCanvas } = await import("./pngSnapshot");
    const overlay = {
      cursor1: "#E040FB",
      cursor2: "#B0B0B0",
      background: "#000000",
      legend: [] as Array<{ label: string; color: string }>,
      selected: null as "C1" | "C2" | null,
    };
    const withCursors = composeSnapshotCanvas(uplot, capture, overlay, {
      cursor: {
        c1Active: true,
        c1SampleIndex: Math.floor(total / 2),
        c2Active: false,
        c2SampleIndex: 0,
      },
      readoutCard: null,
    });
    const withoutCursors = composeSnapshotCanvas(uplot, capture, overlay, {
      cursor: {
        c1Active: false,
        c1SampleIndex: Math.floor(total / 2),
        c2Active: false,
        c2SampleIndex: 0,
      },
      readoutCard: null,
    });

    const cursorX =
      uplot.bbox.left +
      uplot.valToPos(capture.timestamps[Math.floor(total / 2)]!, "x");
    const hasColumn = (canvas: HTMLCanvasElement): boolean => {
      const ctx = canvas.getContext("2d")!;
      const pxRatio = canvas.width / uplot.width;
      const col = ctx.getImageData(
        Math.round(cursorX * pxRatio) - 2,
        Math.round(uplot.bbox.top * pxRatio) + 30,
        5,
        Math.round(uplot.bbox.height * pxRatio) - 60,
      ).data;
      let bright = 0;
      for (let i = 0; i < col.length; i += 4) {
        if (col[i]! > 150 && col[i + 2]! > 150) bright += 1;
      }
      return bright > 10;
    };
    expect(hasColumn(withCursors.canvas)).toBe(true);
    expect(hasColumn(withoutCursors.canvas)).toBe(false);
    // On-screen C1 is still active (export args only).
    expect(useCursorStore.getState().c1Active).toBe(true);
  });
});

void ({} as uPlot | undefined);
