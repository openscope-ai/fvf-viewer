import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import uPlot from "uplot";
import Oscilloscope from "./Oscilloscope";
import "../../index.css";
import { useCaptureStore } from "../../state/captureStore";
import { useViewportStore } from "../../state/viewportStore";
import type { ParsedCapture } from "../../types/capture";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createTestCapture(
  sampleCount = 1000,
  spanSeconds = 0.01,
): ParsedCapture {
  const timestamps = new Float32Array(sampleCount);
  const ch1Data = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    timestamps[i] = (i / (sampleCount - 1) - 0.5) * spanSeconds;
    ch1Data[i] = Math.sin(i * 0.05) * 3;
  }
  return {
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "10 us/Div",
      secondsPerDiv: spanSeconds / sampleCount,
      timestamp14: "12300020260912",
      samples: sampleCount,
      deltaT: spanSeconds / sampleCount,
      channels: [
        {
          name: "A",
          label: "Input A",
          derived: false,
          samples: sampleCount,
          deltaT: spanSeconds / sampleCount,
        },
      ],
    },
    channels: [{ name: "A", label: "Input A", derived: false, data: ch1Data }],
    derivedChannels: [],
    timestamps,
    warnings: [],
  };
}

describe("Zoom-adaptive X-axis time units (Issue #63)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
    hostElement = document.createElement("div");
    hostElement.style.width = "800px";
    hostElement.style.height = "600px";
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    hostElement.remove();
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
  });

  async function mount(spanSeconds = 0.01): Promise<uPlot> {
    act(() => {
      root.render(
        <div
          style={{ display: "flex", flexDirection: "column", height: "600px" }}
        >
          <Oscilloscope capture={createTestCapture(1000, spanSeconds)} />
        </div>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const container = hostElement.querySelector(
      "[data-testid='oscilloscope-container']",
    ) as HTMLElement & { __uplot?: uPlot };
    expect(container.__uplot).toBeDefined();
    return container.__uplot!;
  }

  async function zoomTo(uplot: uPlot, min: number, max: number) {
    act(() => {
      uplot.setScale("x", { min, max });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
  }

  it("the axis label adapts to the visible span across unit ranges", async () => {
    const uplot = await mount(0.01); // fit: 10 ms span
    expect(uplot.axes[0]!.label).toBe("Time (ms)");

    await zoomTo(uplot, -0.6, 0.6); // 1.2 s -> seconds
    expect(uplot.axes[0]!.label).toBe("Time (s)");

    await zoomTo(uplot, -150, 150); // 300 s -> minutes
    expect(uplot.axes[0]!.label).toBe("Time (min)");

    await zoomTo(uplot, -0.0002, 0.0002); // 400 µs -> microseconds
    expect(uplot.axes[0]!.label).toBe("Time (µs)");

    await zoomTo(uplot, -2e-7, 2e-7); // 400 ns -> nanoseconds
    expect(uplot.axes[0]!.label).toBe("Time (ns)");
  });

  it("AC5: CSV export is untouched (lossless seconds in time_s)", async () => {
    const { buildCsvHeaderLines, formatSampleValue } =
      await import("../export/csvExport");
    const capture = createTestCapture(100, 0.01);
    const header = buildCsvHeaderLines(capture, "t.fvf").join("\n");
    expect(header).not.toMatch(/Time \((ms|µs|ns|min)\)/);
    // Values remain unscaled, lossless seconds regardless of the axis unit.
    expect(formatSampleValue(-0.005)).toBe("-0.005");
  });

  it("AC5: the print render adopts the live unit for export parity", async () => {
    const { composePrintSnapshot } = await import("../export/pngSnapshot");
    const capture = createTestCapture(1000, 0.01);
    const uplot = await mount(0.01);
    expect(uplot.axes[0]!.label).toBe("Time (ms)");
    const composed = await composePrintSnapshot(
      uplot,
      capture,
      {
        cursor1: "#6A1B9A",
        cursor2: "#4B5563",
        background: "#FFFFFF",
        legend: [],
        selected: null,
      },
      { series: [{ label: "A", color: "#B8860B", show: true }] },
    );
    // Same viewport geometry at the ms-scaled bounds...
    expect(composed.cssWidth).toBe(uplot.width);
    expect(composed.cssHeight).toBe(uplot.height);
    // ...and the export reports the same adaptive unit as the live axis.
    expect(composed.timeAxisUnit).toBe("ms");

    // Zoom to seconds: the export follows the live unit.
    await zoomTo(uplot, -0.6, 0.6);
    const seconds = await composePrintSnapshot(
      uplot,
      capture,
      {
        cursor1: "#6A1B9A",
        cursor2: "#4B5563",
        background: "#FFFFFF",
        legend: [],
        selected: null,
      },
      { series: [{ label: "A", color: "#B8860B", show: true }] },
    );
    expect(seconds.timeAxisUnit).toBe("s");
  });
});
