import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Oscilloscope from "../canvas/Oscilloscope";
import "../../index.css";
import {
  READOUT_CARD_STORAGE_KEY,
  createReadoutCardStore,
  useReadoutCardStore,
} from "../../state/readoutCardStore";
import { useCaptureStore } from "../../state/captureStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import { useCursorStore } from "../../state/cursorStore";
import {
  CURSOR_DISPLAY_STORAGE_KEY,
  useCursorDisplayStore,
} from "../../state/cursorDisplayStore";
import { useViewportStore } from "../../state/viewportStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useThemeStore } from "../../state/themeStore";
import {
  composeSnapshotCanvas,
  type SnapshotOverlayState,
} from "../export/pngSnapshot";
import type { ReadoutCardSnapshot } from "./readoutSnapshot";
import type { ParsedCapture } from "../../types/capture";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createTestCapture(sampleCount = 1000): ParsedCapture {
  const timestamps = new Float32Array(sampleCount);
  const ch1Data = new Float32Array(sampleCount);
  const dt = 1e-5;
  const center = Math.floor(sampleCount / 2);
  for (let i = 0; i < sampleCount; i += 1) {
    timestamps[i] = (i - center) * dt;
    ch1Data[i] = Math.sin(i * 0.05) * 3.3;
  }
  return {
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "10 us/Div",
      secondsPerDiv: dt,
      timestamp14: "12300020260912",
      samples: sampleCount,
      deltaT: dt,
      channels: [
        {
          name: "A",
          label: "Input A",
          derived: false,
          samples: sampleCount,
          deltaT: dt,
        },
      ],
    },
    channels: [{ name: "A", label: "Input A", derived: false, data: ch1Data }],
    derivedChannels: [],
    timestamps,
    warnings: [],
  };
}

function createVoltCapture(sampleCount = 1000): ParsedCapture {
  const timestamps = new Float32Array(sampleCount);
  const dataA = new Float32Array(sampleCount);
  const dataB = new Float32Array(sampleCount);
  const dt = 1e-5;
  const center = Math.floor(sampleCount / 2);
  for (let i = 0; i < sampleCount; i += 1) {
    timestamps[i] = (i - center) * dt;
    dataA[i] = 3 * Math.sin(i * 0.05);
    dataB[i] = 1.5 * Math.cos(i * 0.04);
  }
  const channels = [
    { name: "A", label: "Input A", derived: false, data: dataA },
    { name: "B", label: "Input B", derived: false, data: dataB },
  ];
  return {
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "10 us/Div",
      secondsPerDiv: dt,
      timestamp14: "12300020261004",
      samples: sampleCount,
      deltaT: dt,
      channels: channels.map((c) => ({
        name: c.name,
        label: c.label,
        derived: false,
        samples: sampleCount,
        deltaT: dt,
        unit: "V",
      })),
    },
    channels,
    derivedChannels: [],
    timestamps,
    warnings: [],
  };
}

const OVERLAY: SnapshotOverlayState = {
  cursor1: "#E040FB",
  cursor2: "#B0B0B0",
  background: "#000000",
  legend: [],
  selected: null,
};

function colorPresentInRegion(
  canvas: HTMLCanvasElement,
  x0: number,
  y0: number,
  width: number,
  height: number,
  target: [number, number, number],
): boolean {
  const ctx = canvas.getContext("2d")!;
  const image = ctx.getImageData(
    Math.round(x0),
    Math.round(y0),
    Math.round(width),
    Math.round(height),
  ).data;
  for (let i = 0; i < image.length; i += 4) {
    if (
      Math.abs(image[i]! - target[0]) <= 6 &&
      Math.abs(image[i + 1]! - target[1]) <= 6 &&
      Math.abs(image[i + 2]! - target[2]) <= 6
    ) {
      return true;
    }
  }
  return false;
}

describe("Draggable cursor readout card (Issue #58)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;
  let capture: ParsedCapture;

  const card = () =>
    hostElement.querySelector(
      "[data-testid='cursor-readout-card']",
    ) as HTMLDivElement;
  const titlebar = () =>
    hostElement.querySelector(
      "[data-testid='cursor-readout-card-titlebar']",
    ) as HTMLDivElement;

  function mount() {
    act(() => {
      root.render(<Oscilloscope capture={capture} />);
    });
    // Activate C1 so the card renders.
    act(() => {
      useCursorStore.getState().setCursorActive("C1", true, 1000);
    });
  }

  function dragBy(dx: number, dy: number) {
    const rect = titlebar().getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const midY = rect.top + rect.height / 2;
    act(() => {
      titlebar().dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          button: 0,
          clientX: midX,
          clientY: midY,
        }),
      );
      titlebar().dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 1,
          clientX: midX + dx,
          clientY: midY + dy,
        }),
      );
      titlebar().dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 1,
          clientX: midX + dx,
          clientY: midY + dy,
        }),
      );
    });
  }

  beforeEach(() => {
    localStorage.removeItem(READOUT_CARD_STORAGE_KEY);
    localStorage.removeItem(CURSOR_DISPLAY_STORAGE_KEY);
    useCursorDisplayStore.getState().reset();
    useReadoutCardStore.getState().reset();
    useCursorStore.getState().reset();
    useViewportStore.getState().reset();
    useCaptureStore.getState().reset();
    usePaletteStore.getState().resetPalette();
    useThemeStore.getState().setTheme("dark");
    useChannelNamesStore.getState().setFileKey(null);

    capture = createTestCapture(1000);
    useCaptureStore.setState({ capture });

    hostElement = document.createElement("div");
    hostElement.style.width = "800px";
    hostElement.style.height = "600px";
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    hostElement.remove();
    localStorage.removeItem(READOUT_CARD_STORAGE_KEY);
    useReadoutCardStore.getState().reset();
    useCursorStore.getState().reset();
    useViewportStore.getState().reset();
    useCaptureStore.getState().reset();
    usePaletteStore.getState().resetPalette();
    useThemeStore.getState().setTheme("dark");
    useChannelNamesStore.getState().setFileKey(null);
  });

  // ---------------------------------------------------------------------
  // Issue #76: user-customized palette propagates to the readout card
  // ---------------------------------------------------------------------

  it("AC (#76 + #143): custom channel color restyles the swatches live; swatches track the viewport theme", () => {
    mount();
    // Activate C2 too so the differential section renders.
    act(() => {
      useCursorStore.getState().setCursorActive("C2", true, 1000);
    });

    const swatchA = () =>
      hostElement.querySelector(
        "[data-testid='cursor-c1-ch-A-swatch']",
      ) as HTMLElement;
    const deltaSwatchA = () =>
      hostElement.querySelector(
        "[data-testid='cursor-delta-v-A-swatch']",
      ) as HTMLElement;
    const labelA = () =>
      hostElement.querySelector(
        "[data-testid='cursor-c1-ch-A'] .cursor-channel-name",
      ) as HTMLElement;

    // Dark OLED default for channel A rides on the swatches; the name
    // text itself stays readable on the dark card, untinted.
    expect(swatchA().style.backgroundColor).toBe("rgb(255, 215, 0)");
    expect(deltaSwatchA().style.backgroundColor).toBe("rgb(255, 215, 0)");
    expect(labelA().style.color).toBe("");
    expect(window.getComputedStyle(labelA()).color).toBe("rgb(224, 224, 224)");

    act(() => {
      usePaletteStore.getState().setCustomColor("A", "#00FF88");
    });
    expect(swatchA().style.backgroundColor).toBe("rgb(0, 255, 136)");
    expect(deltaSwatchA().style.backgroundColor).toBe("rgb(0, 255, 136)");

    // Metric values keep the high-visibility cyan accent
    const deltaT = hostElement.querySelector(
      "[data-testid='cursor-delta-t']",
    ) as HTMLElement;
    expect(window.getComputedStyle(deltaT).color).toBe("rgb(0, 229, 255)");

    // Palette reset restores the dark-theme defaults
    act(() => {
      usePaletteStore.getState().resetPalette();
    });
    expect(swatchA().style.backgroundColor).toBe("rgb(255, 215, 0)");
    expect(deltaSwatchA().style.backgroundColor).toBe("rgb(255, 215, 0)");

    // Issue #143: in the Light viewport theme the swatches match the
    // canvas trace colors exactly (#B8860B for A) while the name text
    // stays readable on the dark card chrome.
    act(() => {
      useThemeStore.getState().setTheme("light");
    });
    expect(swatchA().style.backgroundColor).toBe("rgb(184, 134, 11)");
    expect(deltaSwatchA().style.backgroundColor).toBe("rgb(184, 134, 11)");
    expect(labelA().style.color).toBe("");
    expect(window.getComputedStyle(labelA()).color).toBe("rgb(224, 224, 224)");
    act(() => {
      useThemeStore.getState().setTheme("dark");
    });
  });

  it("AC (#76 + #143): custom cursor color restyles badge ring and glow; selected badge mirrors the toolbar", () => {
    mount();
    act(() => {
      useCursorStore.getState().selectCursor("C1");
    });
    const badge = () =>
      hostElement.querySelector(
        "[data-testid='cursor-badge-select-c1']",
      ) as HTMLElement;

    // Dark OLED default for C1, selected: the ring and glow carry the
    // cursor color while the text goes white (toolbar parity, #143).
    expect(badge().style.borderColor).toBe("rgb(224, 64, 251)");
    expect(badge().style.color).toBe("rgb(255, 255, 255)");
    expect(badge().style.backgroundColor).toBe("rgba(224, 64, 251, 0.2)");
    expect(badge().style.boxShadow).toBe("rgb(224, 64, 251) 0px 0px 8px");

    act(() => {
      usePaletteStore.getState().setCustomColor("C1", "#FF4444");
    });
    expect(badge().style.borderColor).toBe("rgb(255, 68, 68)");
    expect(badge().style.color).toBe("rgb(255, 255, 255)");
    expect(badge().style.backgroundColor).toBe("rgba(255, 68, 68, 0.2)");
    expect(badge().style.boxShadow).toBe("rgb(255, 68, 68) 0px 0px 8px");

    act(() => {
      usePaletteStore.getState().resetPalette();
    });
    expect(badge().style.borderColor).toBe("rgb(224, 64, 251)");
    expect(badge().style.boxShadow).toBe("rgb(224, 64, 251) 0px 0px 8px");
  });

  it("AC (#143): unselected badge keeps a quiet ring and carries no selection dot", () => {
    mount();
    act(() => {
      useCursorStore.getState().setCursorActive("C2", true, 1000);
      useCursorStore.getState().selectCursor("C2");
    });
    const badgeC1 = () =>
      hostElement.querySelector(
        "[data-testid='cursor-badge-select-c1']",
      ) as HTMLElement;

    // Unselected: cursor-colored text with the faint toolbar-style glow.
    expect(badgeC1().style.color).toBe("rgb(224, 64, 251)");
    expect(badgeC1().style.boxShadow).toContain("4px");
    // No selection dot anywhere in the panel; selection is shown by the
    // badge highlight and the selected row.
    expect(card().querySelector(".cursor-badge-dot")).toBeNull();
    expect(
      card().querySelector(
        "[data-testid='cursor-badge-select-c2'].cursor-badge--selected",
      ),
    ).not.toBeNull();
    expect(
      card().querySelector(
        "[data-testid='cursor-readout-c2'].cursor-readout-row--selected",
      ),
    ).not.toBeNull();
  });

  it("AC1: dragging the titlebar repositions the card via pointer events", () => {
    mount();
    expect(card()).not.toBeNull();

    const before = card().getBoundingClientRect();
    const wrapper = card().offsetParent as HTMLElement;
    const wrapperRect = wrapper.getBoundingClientRect();
    const defaultLeft = before.left - wrapperRect.left;
    const defaultTop = before.top - wrapperRect.top;

    dragBy(-60, 40);
    const after = card().getBoundingClientRect();

    // The card moved by exactly the drag delta and the store committed the
    // position relative to the default anchor.
    expect(Math.round(after.left - before.left)).toBe(-60);
    expect(Math.round(after.top - before.top)).toBe(40);
    expect(useReadoutCardStore.getState().position).toEqual({
      left: defaultLeft - 60,
      top: defaultTop + 40,
    });
    // Custom position switches from the right-anchored CSS default to
    // explicit left/top coordinates.
    expect(card().style.left).toContain("px");
    expect(card().style.top).toContain("px");
    expect(card().style.right).toBe("auto");
  });

  it("AC2: dragging the titlebar never triggers uPlot box-zoom", () => {
    mount();
    const xMinBefore = useViewportStore.getState().xMin;
    const xMaxBefore = useViewportStore.getState().xMax;
    const yMinBefore = useViewportStore.getState().yMin;
    const yMaxBefore = useViewportStore.getState().yMax;

    dragBy(120, 80);

    expect(useViewportStore.getState().xMin).toBe(xMinBefore);
    expect(useViewportStore.getState().xMax).toBe(xMaxBefore);
    expect(useViewportStore.getState().yMin).toBe(yMinBefore);
    expect(useViewportStore.getState().yMax).toBe(yMaxBefore);
  });

  it("AC3: drag positions clamp to the wrapper with an 8px margin", () => {
    mount();
    dragBy(5_000, 5_000);

    const store = useReadoutCardStore.getState();
    expect(store.position).not.toBeNull();
    const rect = card().getBoundingClientRect();
    const wrapper = card().offsetParent as HTMLElement;
    expect(store.position!.left).toBe(wrapper.clientWidth - rect.width - 8);
    expect(store.position!.top).toBe(wrapper.clientHeight - rect.height - 8);
  });

  it("AC3: expanding a collapsed card near the bottom re-clamps upward", async () => {
    mount();
    const expandedRect = card().getBoundingClientRect();
    act(() => {
      useReadoutCardStore.getState().setCollapsed(true);
    });
    const collapsedRect = card().getBoundingClientRect();
    expect(collapsedRect.height).toBeLessThan(expandedRect.height);

    // Park the collapsed card against the bottom boundary.
    const wrapper = card().offsetParent as HTMLElement;
    act(() => {
      useReadoutCardStore.getState().setPosition({
        top: wrapper.clientHeight - collapsedRect.height - 8,
        left: 100,
      });
    });

    act(() => {
      useReadoutCardStore.getState().setCollapsed(false);
    });

    await vi.waitFor(
      () => {
        const position = useReadoutCardStore.getState().position;
        expect(position).not.toBeNull();
        const currentRect = card().getBoundingClientRect();
        expect(position!.top).toBeLessThanOrEqual(
          wrapper.clientHeight - currentRect.height - 8 + 1,
        );
      },
      { timeout: 2_000 },
    );
  });

  it("AC4: double-clicking the titlebar restores the default top-right anchor", () => {
    mount();
    dragBy(-100, 50);
    expect(useReadoutCardStore.getState().position).not.toBeNull();

    act(() => {
      titlebar().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(useReadoutCardStore.getState().position).toBeNull();
    const rect = card().getBoundingClientRect();
    const wrapper = card().offsetParent as HTMLElement;
    const wrapperRect = wrapper.getBoundingClientRect();
    expect(Math.round(rect.top - wrapperRect.top)).toBe(76);
    expect(Math.round(wrapperRect.right - rect.right)).toBe(16);
    expect(card().style.top).toBe("");
    expect(card().style.right).toBe("");
  });

  it("AC5: custom positions persist across browser sessions in local storage", () => {
    mount();
    act(() => {
      useReadoutCardStore.getState().setPosition({ top: 120, left: 140 });
    });

    const raw = localStorage.getItem(READOUT_CARD_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toMatchObject({
      position: { top: 120, left: 140 },
    });

    // A freshly created store (fresh browser session) restores the position.
    const restored = createReadoutCardStore().getState();
    expect(restored.position).toEqual({ top: 120, left: 140 });
    expect(restored.collapsed).toBe(false);
  });

  it("AC5: window resize re-clamps the card within the visible wrapper", async () => {
    mount();
    act(() => {
      useReadoutCardStore.getState().setPosition({ top: 520, left: 600 });
    });

    // Shrink the viewport so the parked position overflows the boundary.
    hostElement.style.height = "300px";
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    await vi.waitFor(
      () => {
        const position = useReadoutCardStore.getState().position;
        expect(position).not.toBeNull();
        const rect = card().getBoundingClientRect();
        const wrapper = card().offsetParent as HTMLElement;
        expect(position!.top).toBeLessThanOrEqual(
          wrapper.clientHeight - rect.height - 8 + 1,
        );
        expect(position!.left).toBeLessThanOrEqual(
          wrapper.clientWidth - rect.width - 8 + 1,
        );
      },
      { timeout: 2_000 },
    );
  });

  it("AC6: arrow keys nudge by 10px and Shift+arrow keys by 50px", () => {
    mount();
    const baseLeft =
      card().getBoundingClientRect().left -
      (card().offsetParent as HTMLElement).getBoundingClientRect().left;
    const baseTop =
      card().getBoundingClientRect().top -
      (card().offsetParent as HTMLElement).getBoundingClientRect().top;

    act(() => {
      titlebar().dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
    });
    let position = useReadoutCardStore.getState().position;
    expect(position!.left).toBeCloseTo(baseLeft - 10, 0);
    expect(position!.top).toBeCloseTo(baseTop, 0);

    act(() => {
      titlebar().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          shiftKey: true,
        }),
      );
    });
    position = useReadoutCardStore.getState().position;
    expect(position!.top).toBeCloseTo(baseTop + 50, 0);

    act(() => {
      titlebar().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowLeft",
          bubbles: true,
          shiftKey: true,
        }),
      );
      titlebar().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          bubbles: true,
          shiftKey: true,
        }),
      );
    });
    position = useReadoutCardStore.getState().position;
    expect(position!.left).toBeCloseTo(baseLeft - 10 - 50, 0);
    expect(position!.top).toBeCloseTo(baseTop + 50 - 50, 0);

    // Enter releases focus (commit) without moving the card.
    act(() => {
      titlebar().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(useReadoutCardStore.getState().position).toEqual(position);
    expect(document.activeElement).not.toBe(titlebar());

    // Escape releases focus too; a later nudge starts from a fresh focus.
    act(() => {
      titlebar().focus();
      titlebar().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(document.activeElement).not.toBe(titlebar());
    act(() => {
      titlebar().dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(useReadoutCardStore.getState().position!.left).toBeCloseTo(
      baseLeft - 60 + 10,
      0,
    );
  });

  function createUPlotMock() {
    const baseCanvas = document.createElement("canvas");
    baseCanvas.width = 800;
    baseCanvas.height = 600;
    return {
      width: 800,
      height: 600,
      bbox: { left: 50, top: 20, width: 730, height: 550 },
      ctx: { canvas: baseCanvas },
      scales: { x: { min: 0, max: 1 }, y: { min: -1, max: 1 } },
      valToPos: (value: number) => value * 730,
    } as never;
  }

  it("AC7: snapshot compositing draws the readout card at its live position", () => {
    const uPlotMock = createUPlotMock();

    const cardState: ReadoutCardSnapshot = {
      x: 500,
      y: 300,
      width: 220,
      height: 120,
      collapsed: false,
      rows: [
        {
          cells: [
            { text: "C1", color: "#E040FB", bold: true },
            { text: "#10" },
            { text: "10.00 ms", alignRight: true },
          ],
        },
      ],
    };

    const { canvas } = composeSnapshotCanvas(uPlotMock, capture, OVERLAY, {
      readoutCard: cardState,
    });

    // Dark HUD panel chrome (#0C0C0C) present inside the card area but
    // absent from an untouched region of the same export.
    expect(colorPresentInRegion(canvas, 510, 310, 80, 40, [12, 12, 12])).toBe(
      true,
    );
    expect(colorPresentInRegion(canvas, 60, 400, 80, 40, [12, 12, 12])).toBe(
      false,
    );
  });

  it("AC7: print-inverted snapshots use the light card chrome", () => {
    const uPlotMock = createUPlotMock();

    const cardState: ReadoutCardSnapshot = {
      x: 500,
      y: 300,
      width: 220,
      height: 120,
      collapsed: false,
      rows: [],
    };

    const { canvas } = composeSnapshotCanvas(
      uPlotMock,
      capture,
      { ...OVERLAY, background: "#FFFFFF" },
      { readoutCard: cardState },
    );

    expect(
      colorPresentInRegion(canvas, 510, 310, 80, 40, [255, 255, 255]),
    ).toBe(true);
    expect(
      colorPresentInRegion(canvas, 510, 310, 80, 40, [240, 240, 240]),
    ).toBe(true);
  });

  it("AC7: registered exporter composites the live card without error", async () => {
    mount();
    const { useSnapshotStore } = await import("../export/snapshotStore");
    const exportFn = useSnapshotStore.getState().exporter;
    expect(exportFn).not.toBeNull();
    const { PNG_EXPORT_DEFAULTS } = await import("../../state/pngExportStore");
    const blob = await exportFn!(PNG_EXPORT_DEFAULTS);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe("image/png");
  });

  // ---------------------------------------------------------------------
  // Issue #106: unit-aware readout values on a mixed-unit capture
  // ---------------------------------------------------------------------

  it("AC (#106): mixed units render base-SI values, per-channel context, and unit differential labels", async () => {
    const { parseCaptureBuffer } = await import("../../workers/workerClient");
    const { default: mixedUrl } =
      await import("../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-2ch-current-offcenter-1s-div.fvf.bin?url");
    const response = await fetch(mixedUrl);
    capture = await parseCaptureBuffer(await response.arrayBuffer());
    useCaptureStore.setState({ capture });
    mount();
    const total = capture.timestamps.length;
    act(() => {
      useCursorStore.getState().setCursorSample("C1", 1000, total);
      useCursorStore.getState().setCursorActive("C2", true, total);
      useCursorStore.getState().setCursorSample("C2", 2000, total);
    });

    // Every channel value carries its explicit base-SI family (amperes —
    // the mA file unit never leaks into a value, volts never appear).
    const values = Array.from(
      card().querySelectorAll(".cursor-voltage-value"),
    ).map((el) => el.textContent ?? "");
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value === "—" || /A$/.test(value)).toBe(true);
      expect(value).not.toContain("V");
    }

    // AC2 (issue #131): channel meta section is removed from the floating card
    expect(
      card().querySelector("[data-testid='cursor-channel-meta']"),
    ).toBeNull();
    expect(card().querySelector("[data-testid='cursor-meta-A']")).toBeNull();
    expect(card().querySelector("[data-testid='cursor-meta-B']")).toBeNull();

    // AC1 (issue #131): "Input " prefix is removed from channel voltage readings
    const chNames = Array.from(
      card().querySelectorAll(".cursor-channel-name"),
    ).map((el) => el.textContent);
    expect(chNames).toContain("A:");
    expect(chNames).toContain("B:");
    for (const name of chNames) {
      expect(name).not.toContain("Input");
    }

    // Differential labels name the base unit, never volts-only ΔV.
    const deltaA = card().querySelector("[data-testid='cursor-delta-v-A']");
    const deltaB = card().querySelector("[data-testid='cursor-delta-v-B']");
    expect(deltaA?.textContent).toContain("ΔA(A):");
    expect(deltaB?.textContent).toContain("ΔA(B):");
  });

  it("issue #226 AC1/AC2: global display units reformat the HUD card measurements", () => {
    // Local volt-channel capture: sample i sits at (i-500)*10µs and
    // channel A reads 3·sin(i·0.05) V (unit "V" so the voltage override
    // applies — the shared fixture's unit-less channel would not).
    capture = createVoltCapture();
    useCaptureStore.setState({ capture });
    mount();
    const total = 1000;
    act(() => {
      useCursorStore.getState().setCursorSample("C1", 50, total);
      useCursorStore.getState().setCursorActive("C2", true, total);
      useCursorStore.getState().setCursorSample("C2", 550, total);
    });

    const timeC1 = card().querySelector(
      "[data-testid='cursor-time-c1']",
    ) as HTMLElement;
    const deltaT = card().querySelector(
      "[data-testid='cursor-delta-t']",
    ) as HTMLElement;
    const freq = card().querySelector(
      "[data-testid='cursor-frequency']",
    ) as HTMLElement;

    // Defaults keep the SI ladder: t1 = -4.5 ms, Δt = 5 ms, 1/Δt = 200 Hz.
    expect(timeC1.textContent).toBe("-4.500 ms");
    expect(deltaT.textContent).toBe("5.000 ms");
    expect(freq.textContent).toBe("200.0 Hz");

    // Pin Time = s: absolute cursor time and Δt reformat (no promotion).
    act(() => {
      useCursorDisplayStore.getState().setTimeUnit("s");
    });
    expect(timeC1.textContent).toBe("-0.0045 s");
    expect(deltaT.textContent).toBe("0.005 s");

    // Pin Frequency = kHz: the 1/Δt reciprocal formats in the pinned unit.
    act(() => {
      useCursorDisplayStore.getState().setFrequencyUnit("kHz");
    });
    expect(freq.textContent).toBe("0.2 kHz");

    // Pin Voltage = dBV: volt channels render 20·log10(|V|) —
    // 3·sin(2.5) V ≈ 1.7954 V → 5.083 dBV.
    act(() => {
      useCursorDisplayStore.getState().setVoltageUnit("dBV");
    });
    const voltC1 = card().querySelector(
      "[data-testid='cursor-c1-ch-A'] .cursor-voltage-value",
    ) as HTMLElement;
    expect(voltC1.textContent).toBe("5.083 dBV");

    // Selections persist per session.
    expect(
      JSON.parse(window.localStorage.getItem(CURSOR_DISPLAY_STORAGE_KEY)!),
    ).toEqual({
      timeUnit: "s",
      frequencyUnit: "kHz",
      voltageUnit: "dBV",
      lineStyles: { C1: "solid", C2: "solid" },
      bindings: { C1: "all", C2: "all" },
      deltaLocked: false,
    });
  });

  it("issue #225 AC1/AC2: channel binding filters HUD rows, hidden bound channels fall back with a hint, and the Δt lock badge shows", () => {
    capture = createVoltCapture();
    useCaptureStore.setState({ capture });
    mount();
    const total = 1000;
    act(() => {
      useCursorStore.getState().setCursorActive("C2", true, total);
    });

    // Baseline: both cursors show every visible channel.
    expect(
      card().querySelector("[data-testid='cursor-c1-ch-A']"),
    ).not.toBeNull();
    expect(
      card().querySelector("[data-testid='cursor-c1-ch-B']"),
    ).not.toBeNull();

    // Bind C1 to B: only C1's rows filter; C2 (unbound) still shows all.
    act(() => {
      useCursorDisplayStore.getState().setBinding("C1", "B");
    });
    expect(card().querySelector("[data-testid='cursor-c1-ch-A']")).toBeNull();
    expect(
      card().querySelector("[data-testid='cursor-c1-ch-B']"),
    ).not.toBeNull();
    expect(
      card().querySelector("[data-testid='cursor-c2-ch-A']"),
    ).not.toBeNull();

    // Differential rows keep only the channels both cursors measure.
    expect(card().querySelector("[data-testid='cursor-delta-v-A']")).toBeNull();
    expect(
      card().querySelector("[data-testid='cursor-delta-v-B']"),
    ).not.toBeNull();

    // Hiding the bound channel falls back to all visible channels with
    // the explicit hint — never an empty card.
    act(() => {
      useViewportStore.getState().toggleChannel("B");
    });
    expect(
      card().querySelector("[data-testid='cursor-c1-ch-A']"),
    ).not.toBeNull();
    const hint = card().querySelector(
      "[data-testid='cursor-binding-hint-c1']",
    ) as HTMLElement;
    expect(hint.textContent).toContain("B hidden");
    expect(
      card().querySelector("[data-testid='cursor-binding-hint-c2']"),
    ).toBeNull();

    // Δt lock badge appears on the differential row while locked.
    expect(
      card().querySelector("[data-testid='cursor-dt-lock-badge']"),
    ).toBeNull();
    act(() => {
      useViewportStore.getState().toggleChannel("B");
      useCursorDisplayStore.getState().setDeltaLocked(true);
    });
    expect(
      card().querySelector("[data-testid='cursor-dt-lock-badge']"),
    ).not.toBeNull();
  });

  it("AC (Issue #143): help button tooltips 'Cursor help' and toggles the floating guidance panel", () => {
    mount();
    act(() => {
      useCursorStore.getState().setCursorActive("C1", true, 1000);
    });

    const helpBtn = card().querySelector(
      "[data-testid='cursor-readout-help-btn']",
    ) as HTMLButtonElement;
    expect(helpBtn).not.toBeNull();
    expect(helpBtn.title).toBe("Cursor help");
    expect(helpBtn.getAttribute("aria-label")).toContain("Cursor help");
    expect(helpBtn.getAttribute("aria-expanded")).toBe("false");

    // Iconoir SVG is present inside the button
    const svg = helpBtn.querySelector("svg.cursor-help-icon");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");

    // The guidance lives in the floating panel, not the tooltip.
    expect(
      hostElement.querySelector("[data-testid='cursor-readout-help-panel']"),
    ).toBeNull();
    act(() => {
      helpBtn.click();
    });
    const panel = hostElement.querySelector(
      "[data-testid='cursor-readout-help-panel']",
    ) as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.textContent).toContain("Cursor Movement Controls");
    expect(panel.textContent).toContain("Ctrl + Drag");
    expect(panel.textContent).toContain("Ctrl + Click");
    expect(panel.textContent).toContain("Ctrl + Mousewheel");
    expect(panel.textContent).toContain("Ctrl + Arrow keys");
    expect(helpBtn.getAttribute("aria-expanded")).toBe("true");

    // The close button dismisses the panel; the toggle reopens it.
    const close = hostElement.querySelector(
      "[data-testid='cursor-readout-help-close']",
    ) as HTMLButtonElement;
    act(() => {
      close.click();
    });
    expect(
      hostElement.querySelector("[data-testid='cursor-readout-help-panel']"),
    ).toBeNull();
    act(() => {
      helpBtn.click();
    });
    expect(
      hostElement.querySelector("[data-testid='cursor-readout-help-panel']"),
    ).not.toBeNull();
  });

  it("AC (Issue #143): renamed channels show no trailing colon; defaults keep it", () => {
    mount();
    const nameCell = () =>
      hostElement.querySelector(
        "[data-testid='cursor-c1-ch-A'] .cursor-channel-name",
      ) as HTMLElement;
    expect(nameCell().textContent).toBe("A:");

    act(() => {
      useChannelNamesStore.getState().setFileKey("test-file::123");
      useChannelNamesStore.getState().setName("A", "V_grid");
    });
    expect(nameCell().textContent).toBe("A: V_grid");

    act(() => {
      useChannelNamesStore.getState().clearName("A");
    });
    expect(nameCell().textContent).toBe("A:");
  });
});
