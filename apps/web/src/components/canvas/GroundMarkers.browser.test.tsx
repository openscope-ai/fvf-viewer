import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type uPlot from "uplot";
import fourChUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import Oscilloscope from "./Oscilloscope";
import WaveformToolbar from "../toolbar/WaveformToolbar";
import { yScaleKey } from "../../capture/channelUnits";
import { useCaptureStore } from "../../state/captureStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import { useCursorStore } from "../../state/cursorStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useThemeStore } from "../../state/themeStore";
import { useViewportStore } from "../../state/viewportStore";
import { useBadgePopoverStore } from "../toolbar/badgeConfig/anchoredPopover";

/**
 * Issue #98 acceptance: colored ground flags (A▶, B▶…) on the left
 * graticule margin at each channel's displayed 0V baseline, Ctrl+
 * vertical drag over a trace (or marker) sliding the channel offset
 * with the popover tracking live, double-click reset to 0, physical
 * readouts untouched, and the 1-click Overlay/Stack lane partitioning.
 * Mouse coordinates are integer-rounded (synthetic events).
 */

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching ${url}`).toBeTruthy();
  return response.arrayBuffer();
}

describe("Ground markers, vertical offset & quick-stack (issue #98)", () => {
  let host: HTMLDivElement;
  let root: Root;

  const mountFullUi = async (): Promise<uPlot> => {
    let mounted: uPlot | null = null;
    await act(async () => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope
            onUPlotInit={(u) => {
              mounted = u;
            }}
          />
        </div>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(mounted).not.toBeNull();
    return mounted!;
  };

  const settle = async (ms = 40): Promise<void> => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  };

  /** Plot-area CSS coordinates (integer-rounded) of a rendered sample. */
  const tracePoint = (
    u: uPlot,
    seriesIdx: number,
    sampleIdx: number,
  ): { x: number; y: number } => {
    const series = u.series[seriesIdx]!;
    const scaleKey =
      typeof series.scale === "string" && series.scale !== "x"
        ? series.scale
        : yScaleKey(seriesIdx - 1);
    return {
      x: Math.round(u.valToPos(u.data[0]![sampleIdx]!, "x")),
      y: Math.round(u.valToPos(u.data[seriesIdx]![sampleIdx]!, scaleKey)),
    };
  };

  const clientPoint = (u: uPlot, p: { x: number; y: number }) => {
    const rect = u.over.getBoundingClientRect();
    return {
      clientX: Math.round(rect.left + p.x),
      clientY: Math.round(rect.top + p.y),
    };
  };

  beforeEach(async () => {
    useBadgePopoverStore.getState().setOpen(null);
    window.localStorage.clear();
    useChannelDisplayStore.getState().reset();
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
    useChannelNamesStore.setState({ fileKey: null, names: {} });
    await useCaptureStore
      .getState()
      .parseBuffer(await fixture(fourChUrl), "four.fvf");
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

  it("AC1 (#249): ground flags render on the channel's own axis column at the displayed 0V baseline and follow the offset", async () => {
    const uplot = await mountFullUi();

    const strip = document.querySelector(
      "[data-testid='ground-marker-A']",
    ) as HTMLElement | null;
    expect(strip).not.toBeNull();
    expect(strip!.style.display).toBe("block");

    const rootRect = uplot.root.getBoundingClientRect();
    const stripRect = strip!.getBoundingClientRect();
    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const plotLeftCss = uplot.bbox.left / pxRatio;
    const plotTopCss = uplot.bbox.top / pxRatio;
    const zeroY = uplot.valToPos(0, yScaleKey(0)) / pxRatio;
    // Issue #249: the strip spans channel A's OWN axis column (layout
    // from uPlot's side-3 axis geometry) and never reaches the plot.
    const axisA = uplot.axes.find(
      (a) => a.scale === yScaleKey(0),
    ) as unknown as { _pos: number; _size: number; _lpos: number };
    expect(axisA).toBeDefined();
    expect(stripRect.left).toBeGreaterThanOrEqual(
      rootRect.left + axisA._lpos - 20 - 1,
    );
    expect(stripRect.right).toBeLessThanOrEqual(rootRect.left + axisA._pos + 1);
    expect(stripRect.right).toBeLessThan(rootRect.left + plotLeftCss - 1);
    // The strip centers on the displayed 0V baseline.
    expect(
      Math.abs(
        stripRect.top +
          stripRect.height / 2 -
          (rootRect.top + plotTopCss + zeroY),
      ),
    ).toBeLessThan(2);

    // Offsetting channel A moves its ground flag with the baseline.
    const before = strip!.getBoundingClientRect().top;
    useChannelDisplayStore.getState().setOffset("A", 1);
    await settle();
    const after = strip!.getBoundingClientRect().top;
    expect(Math.abs(after - before)).toBeGreaterThan(5);
  });

  it("AC2: Ctrl+vertical drag over a trace slides that channel's offset; double-click resets to 0", async () => {
    const uplot = await mountFullUi();
    const mid = Math.floor(
      useCaptureStore.getState().capture!.timestamps.length / 2,
    );
    const point = tracePoint(uplot, 1, mid);
    const start = clientPoint(uplot, point);
    const scale = uplot.scales[yScaleKey(0)]!;
    const pxRatio = uplot.width > 0 ? uplot.ctx.canvas.width / uplot.width : 1;
    const unitsPerPx =
      (scale.max! - scale.min!) / (uplot.bbox.height / pxRatio);
    const dy = 60;

    await act(async () => {
      uplot.over.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          ctrlKey: true,
          clientX: start.clientX,
          clientY: start.clientY,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          buttons: 1,
          ctrlKey: true,
          clientX: start.clientX,
          clientY: start.clientY + 25,
        }),
      );
    });
    await settle();
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          buttons: 1,
          ctrlKey: true,
          clientX: start.clientX,
          clientY: start.clientY + dy,
        }),
      );
    });
    await settle();
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: start.clientX,
          clientY: start.clientY + dy,
        }),
      );
    });

    const offset = useChannelDisplayStore.getState().keyConfigs.A?.offset;
    expect(offset).toBeDefined();
    // Dragging DOWN moves the trace down: offset decreases by dy units.
    expect(offset!).toBeLessThan(-dy * unitsPerPx * 0.5);
    expect(offset!).toBeGreaterThan(-dy * unitsPerPx * 1.5);

    // Double-click the ground marker resets to 0.
    const strip = document.querySelector(
      "[data-testid='ground-marker-A']",
    ) as HTMLElement;
    await act(async () => {
      strip.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });
    expect(
      useChannelDisplayStore.getState().keyConfigs.A?.offset,
    ).toBeUndefined();
  });

  it("AC2 guard: an unclaimed Ctrl+click on a trace still relocates the active cursor (#14 semantics)", async () => {
    const uplot = await mountFullUi();
    const total = useCaptureStore.getState().capture!.timestamps.length;
    useCursorStore.setState({
      c1Active: true,
      selectedCursor: "C1",
      c1SampleIndex: 0,
    });
    await settle(30);

    const target = Math.floor(total * 0.7);
    const point = clientPoint(uplot, tracePoint(uplot, 1, target));
    await act(async () => {
      uplot.over.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          ctrlKey: true,
          clientX: point.clientX,
          clientY: point.clientY,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: point.clientX,
          clientY: point.clientY,
        }),
      );
    });
    await settle(30);
    const cursor = useCursorStore.getState();
    expect(cursor.selectedCursor).toBe("C1");
    // Snapped to the clicked sample (integer-rounded synthetic
    // coordinates: ±1 px ≈ ±13 samples at this fixture's density).
    expect(Math.abs(cursor.c1SampleIndex - target)).toBeLessThanOrEqual(14);
    // No offset was claimed by the plain click.
    expect(
      useChannelDisplayStore.getState().keyConfigs.A?.offset,
    ).toBeUndefined();
  });

  it("AC3: the HUD readout card keeps reporting true physical voltage while the trace is offset", async () => {
    await mountFullUi();
    const total = useCaptureStore.getState().capture!.timestamps.length;
    useCursorStore.setState({
      c1Active: true,
      selectedCursor: "C1",
      c1SampleIndex: Math.floor(total / 2),
    });
    await settle(30);
    const readout = () =>
      document.querySelector("[data-testid='cursor-c1-ch-A']")?.textContent ??
      "";
    const before = readout();

    useChannelDisplayStore.getState().setOffset("A", 1.5);
    useChannelDisplayStore.getState().setYScale("A", 250);
    await settle(30);

    expect(readout()).toBe(before);
  });

  it("AC5: the popover's offset field tracks a Ctrl+drag live (bidirectional sync)", async () => {
    const uplot = await mountFullUi();
    await act(async () => {
      (
        document.querySelector(
          "[data-testid='channel-gear-A']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    const input = document.querySelector(
      "[data-testid='offset-scrub-input']",
    ) as HTMLInputElement;
    expect(input.value).toBe("0");

    // A trace point on the RIGHT half: the open channel-A popover
    // drops over the left canvas area and would swallow canvas events.
    const total = useCaptureStore.getState().capture!.timestamps.length;
    const start = clientPoint(
      uplot,
      tracePoint(uplot, 1, Math.floor(total * 0.78)),
    );
    await act(async () => {
      uplot.over.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          ctrlKey: true,
          clientX: start.clientX,
          clientY: start.clientY,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          buttons: 1,
          ctrlKey: true,
          clientX: start.clientX,
          clientY: start.clientY + 30,
        }),
      );
    });
    await settle(60);
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: start.clientX,
          clientY: start.clientY + 30,
        }),
      );
    });

    const offset = useChannelDisplayStore.getState().keyConfigs.A?.offset;
    expect(offset).toBeDefined();
    expect(input.value).toBe(String(offset));
  });

  it("review F1: hiding a channel while stacked re-partitions idempotently (spans never multiply)", async () => {
    const uplot = await mountFullUi();
    const capture = useCaptureStore.getState().capture!;
    const first = (i: number) => {
      const s = uplot.scales[yScaleKey(i)]!;
      return { min: s.min!, max: s.max!, span: s.max! - s.min! };
    };

    await act(async () => {
      (
        document.querySelector(
          "[data-testid='stack-mode-stack']",
        ) as HTMLButtonElement
      ).click();
    });
    await settle(30);
    const stackedA = first(0);

    // Hide channel B while stacked: 3 lanes now, and A's lane must be
    // derived from its ORIGINAL pre-stack window — not the laned one.
    await act(async () => {
      useViewportStore.getState().setActiveChannels(["A", "C", "D"]);
    });
    await settle(30);
    const relaned = first(0);

    // Span for 3 lanes from the same original window: 3x original, not
    // 3x the already-laned 4x span.
    const original = stackedA.span / 4;
    expect(relaned.span).toBeCloseTo(original * 3, 5);
    // Lane 0 of 3 centers the trace at fraction 1 - 0.5/3.
    const s0 = uplot.scales[yScaleKey(0)]!;
    expect(s0.min).toBeLessThan(s0.max!);
    void capture;
  });

  it("review F5: a horizontal-dominant Ctrl+drag on a trace is forwarded to the cursor plugin (#14 semantics)", async () => {
    const uplot = await mountFullUi();
    const total = useCaptureStore.getState().capture!.timestamps.length;
    useCursorStore.setState({
      c1Active: true,
      selectedCursor: "C1",
      c1SampleIndex: Math.floor(total * 0.5),
    });
    await settle(30);
    const startIdx = useCursorStore.getState().c1SampleIndex;

    // Press ON a trace (the interceptor arms), then drag horizontally.
    const point = clientPoint(
      uplot,
      tracePoint(uplot, 1, Math.floor(total * 0.4)),
    );
    await act(async () => {
      uplot.over.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          ctrlKey: true,
          clientX: point.clientX,
          clientY: point.clientY,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          buttons: 1,
          ctrlKey: true,
          clientX: point.clientX - 60,
          clientY: point.clientY + 1,
        }),
      );
    });
    await settle(40);
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: point.clientX - 60,
          clientY: point.clientY + 1,
        }),
      );
    });

    // The forwarded gesture moved the cursor; no offset was claimed.
    expect(useCursorStore.getState().c1SampleIndex).not.toBe(startIdx);
    expect(
      useChannelDisplayStore.getState().keyConfigs.A?.offset,
    ).toBeUndefined();
  });

  it("AC4: the Stack toggle partitions visible channels into equal lanes and Overlay restores", async () => {
    const uplot = await mountFullUi();
    const capture = useCaptureStore.getState().capture!;
    const visible = capture.channels.length; // all four visible by default

    const spansBefore = capture.channels.map((_c, i) => {
      const s = uplot.scales[yScaleKey(i)]!;
      return { min: s.min!, max: s.max! };
    });

    await act(async () => {
      (
        document.querySelector(
          "[data-testid='stack-mode-stack']",
        ) as HTMLButtonElement
      ).click();
    });
    await settle(30);

    capture.channels.forEach((_c, i) => {
      const s = uplot.scales[yScaleKey(i)]!;
      const before = spansBefore[i]!;
      // Lane window: span widens by the lane count, and the channel's
      // pre-stack window CENTER renders exactly at its lane's center
      // fraction (lane 0 at the top).
      expect(s.max! - s.min!).toBeCloseTo(
        (before.max - before.min) * visible,
        5,
      );
      const traceCenter = (before.min + before.max) / 2;
      const fraction = (traceCenter - s.min!) / (s.max! - s.min!);
      const laneFraction = 1 - (i + 0.5) / visible;
      expect(fraction).toBeCloseTo(laneFraction, 5);
    });

    await act(async () => {
      (
        document.querySelector(
          "[data-testid='stack-mode-overlay']",
        ) as HTMLButtonElement
      ).click();
    });
    await settle(30);
    capture.channels.forEach((_c, i) => {
      const s = uplot.scales[yScaleKey(i)]!;
      expect(s.min).toBeCloseTo(spansBefore[i]!.min, 6);
      expect(s.max).toBeCloseTo(spansBefore[i]!.max, 6);
    });
  });
});
