import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import uPlot from "uplot";
import Oscilloscope from "./Oscilloscope";
import "../../index.css";
import { formatCanonicalPerDiv } from "../../capture/channelUnits";
import { useCaptureStore } from "../../state/captureStore";
import { useViewportStore } from "../../state/viewportStore";
import type { ParsedCapture } from "../../types/capture";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createVoltageTestCapture(
  sampleCount = 1000,
  yAmplitude = 5,
): ParsedCapture {
  const timestamps = new Float32Array(sampleCount);
  const ch1Data = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    timestamps[i] = (i / (sampleCount - 1) - 0.5) * 0.01;
    ch1Data[i] = Math.sin(i * 0.05) * yAmplitude;
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
          unit: "V",
        },
      ],
    },
    channels: [{ name: "A", label: "Input A", derived: false, data: ch1Data }],
    derivedChannels: [],
    timestamps,
    warnings: [],
  };
}

function createCurrentTestCapture(
  sampleCount = 1000,
  yAmplitude = 665,
): ParsedCapture {
  const timestamps = new Float32Array(sampleCount);
  const ch1Data = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    timestamps[i] = (i / (sampleCount - 1) - 0.5) * 0.01;
    ch1Data[i] = Math.sin(i * 0.05) * yAmplitude;
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
          unit: "A",
        },
      ],
    },
    channels: [{ name: "A", label: "Input A", derived: false, data: ch1Data }],
    derivedChannels: [],
    timestamps,
    warnings: [],
  };
}

function createTwoChannelTestCapture(sampleCount = 1000): ParsedCapture {
  const timestamps = new Float32Array(sampleCount);
  const ch1Data = new Float32Array(sampleCount);
  const ch2Data = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    timestamps[i] = (i / (sampleCount - 1) - 0.5) * 0.01;
    ch1Data[i] = Math.sin(i * 0.05) * 5;
    ch2Data[i] = Math.cos(i * 0.05) * 600;
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
          unit: "V",
        },
        {
          name: "B",
          label: "Input B",
          derived: false,
          samples: sampleCount,
          deltaT: 1e-5,
          unit: "A",
        },
      ],
    },
    channels: [
      { name: "A", label: "Input A", derived: false, data: ch1Data },
      { name: "B", label: "Input B", derived: false, data: ch2Data },
    ],
    derivedChannels: [],
    timestamps,
    warnings: [],
  };
}

describe("Zoom-adaptive Y-axis SI units (Issue #86, #120)", () => {
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

  async function mountCapture(capture: ParsedCapture): Promise<uPlot> {
    act(() => {
      root.render(
        <div
          style={{ display: "flex", flexDirection: "column", height: "600px" }}
        >
          <Oscilloscope capture={capture} />
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

  async function mount(yAmplitude = 5): Promise<uPlot> {
    return mountCapture(createVoltageTestCapture(1000, yAmplitude));
  }

  async function zoomYTo(uplot: uPlot, min: number, max: number) {
    // Issue #106: zoom the bound (active-channel) scale, not a shared "y".
    const key = (uplot.axes[1]?.scale as string | undefined) ?? "y0";
    act(() => {
      uplot.setScale(key, { min, max });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
  }

  it("dynamically adapts Y-axis label between kV, V, mV, and µV based on largest absolute bound", async () => {
    const uplot = await mount(5); // ~10V peak-to-peak span
    expect(uplot.axes[1]!.label).toBe("A (V)");

    // Zoom out to industrial kV bound (e.g. -1500 to +1500, maxAbs = 1500 >= 1050 kV boundary)
    await zoomYTo(uplot, -1500, 1500);
    expect(uplot.axes[1]!.label).toBe("A (kV)");

    // Zoom in to mV range (e.g. -0.05 to +0.05 = 0.1V = 100 mV span)
    await zoomYTo(uplot, -0.05, 0.05);
    expect(uplot.axes[1]!.label).toBe("A (mV)");

    // Zoom in to deep sub-millivolt µV range (e.g. -200e-6 to +200e-6 = 400 µV span)
    await zoomYTo(uplot, -200e-6, 200e-6);
    expect(uplot.axes[1]!.label).toBe("A (µV)");
  });

  it("scales tick values according to the active unit", async () => {
    const uplot = await mount(0.02); // 40 mV span -> mV active
    expect(uplot.axes[1]!.label).toBe("A (mV)");

    // Test the axis values formatter with raw values in Volts
    const valuesFn = uplot.axes[1]!.values;
    expect(typeof valuesFn).toBe("function");
    if (typeof valuesFn === "function") {
      const formatted = (
        valuesFn as (u: unknown, splits: number[]) => string[]
      )(uplot, [-0.02, 0, 0.025]);
      expect(formatted).toEqual(["-20", "0", "25"]);
    }
  });

  it("preserves 5% hysteresis across boundary transitions to prevent title jitter", async () => {
    const uplot = await mount(5); // 10V span -> V active
    expect(uplot.axes[1]!.label).toBe("A (V)");

    // Zoom to 0.98V span (< 1.0, but >= 0.95 due to 5% hysteresis)
    await zoomYTo(uplot, 0, 0.98);
    expect(uplot.axes[1]!.label).toBe("A (V)");

    // Zoom past 0.95 -> switches to mV
    await zoomYTo(uplot, 0, 0.94);
    expect(uplot.axes[1]!.label).toBe("A (mV)");

    // Zoom back out to 1.02V (>= 1.0, but < 1.05 due to hysteresis)
    await zoomYTo(uplot, 0, 1.02);
    expect(uplot.axes[1]!.label).toBe("A (mV)");

    // Zoom past 1.05 -> switches back to V
    await zoomYTo(uplot, 0, 1.06);
    expect(uplot.axes[1]!.label).toBe("A (V)");
  });

  it("AC5: offscreen print render adopts the live Y-axis unit for export parity, including inside hysteresis bands", async () => {
    const { composePrintSnapshot } = await import("../export/pngSnapshot");
    const capture = createVoltageTestCapture(1000, 0.02); // mV range
    const uplot = await mount(0.02);
    expect(uplot.axes[1]!.label).toBe("A (mV)");

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

    expect(composed.cssWidth).toBe(uplot.width);
    expect(composed.cssHeight).toBe(uplot.height);
    expect(composed.yAxisUnit).toBe("mV");

    // Zoom to a span inside the hysteresis band:
    // Established in V (amplitude 5 -> 10V span), then zoomed to 0.98V span.
    // In the live canvas, 0.98V is held in V because 0.98 >= 0.95 (5% margin).
    const vPlot = await mount(5);
    expect(vPlot.axes[1]!.label).toBe("A (V)");
    await zoomYTo(vPlot, 0, 0.98);
    expect(vPlot.axes[1]!.label).toBe("A (V)");

    const hysteresisSnapshot = await composePrintSnapshot(
      vPlot,
      createVoltageTestCapture(1000, 5),
      {
        cursor1: "#6A1B9A",
        cursor2: "#4B5563",
        background: "#FFFFFF",
        legend: [],
        selected: null,
      },
      { series: [{ label: "A", color: "#B8860B", show: true }] },
    );
    // Export must match live canvas unit exactly ('V', not falling back to 'mV')
    expect(hysteresisSnapshot.yAxisUnit).toBe("V");

    // Zoom out to kV
    await zoomYTo(uplot, -1500, 1500);
    expect(uplot.axes[1]!.label).toBe("A (kV)");

    const kvSnapshot = await composePrintSnapshot(
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
    expect(kvSnapshot.yAxisUnit).toBe("kV");
  });

  it("AC6: CSV export remains untouched with lossless raw base units (Volts)", async () => {
    const { buildCsvHeaderLines, formatSampleValue } =
      await import("../export/csvExport");
    const capture = createVoltageTestCapture(100, 0.02);
    const header = buildCsvHeaderLines(capture, "test.fvf").join("\n");
    // Header should contain unscaled Channel labels, not scaled units
    expect(header).not.toMatch(/Voltage \((mV|µV|kV)\)/);
    // Sample values remain unscaled raw numbers
    expect(formatSampleValue(0.025)).toBe("0.025");
    expect(formatSampleValue(-0.0123)).toBe("-0.0123");
  });

  it("AC1: a ±665 A window renders an A axis (ticks <= 3 digits), not kA", async () => {
    const capture = createCurrentTestCapture(1000, 665);
    const uplot = await mountCapture(capture);
    await zoomYTo(uplot, -665, 665);
    expect(uplot.axes[1]!.label).toBe("A (A)");

    const valuesFn = uplot.axes[1]!.values as (
      u: unknown,
      splits: number[],
    ) => string[];
    expect(typeof valuesFn).toBe("function");
    const formatted = valuesFn(uplot, [-600, -400, -200, 0, 200, 400, 600]);
    expect(formatted).toEqual([
      "-600",
      "-400",
      "-200",
      "0",
      "200",
      "400",
      "600",
    ]);
    for (const tick of formatted) {
      const digits = tick.replace("-", "");
      expect(digits.length).toBeLessThanOrEqual(3);
    }
  });

  it("AC3: largest absolute bound of 0 or non-finite selects unscaled base unit (0 V, never 0 µV)", async () => {
    const uplot = await mount(5);
    await zoomYTo(uplot, 0, 0);
    expect(uplot.axes[1]!.label).toBe("A (V)");
  });

  it("AC4: rapid channel toggling combined with zooming never leaves an axis without ticks or gridlines", async () => {
    const capture = createTwoChannelTestCapture();
    const uplot = await mountCapture(capture);

    // Initial state: A selected, both visible
    expect(uplot.axes[1]!.show).toBe(true);
    expect(uplot.axes[2]!.show).toBe(true);
    expect(uplot.axes[1]?.ticks?.show).toBe(true);
    expect(uplot.axes[2]?.ticks?.show).toBe(true);

    // Rapidly toggle channels and zoom
    act(() => {
      useViewportStore.getState().toggleChannel("A");
    });
    act(() => {
      uplot.setScale("y1", { min: -100, max: 100 });
    });
    act(() => {
      useViewportStore.getState().toggleChannel("A");
    });
    act(() => {
      useViewportStore.getState().setSelectedChannel("A");
    });
    act(() => {
      uplot.setScale("y0", { min: -20, max: 20 });
    });
    act(() => {
      useViewportStore.getState().toggleChannel("B");
    });
    act(() => {
      uplot.setScale("y0", { min: -5, max: 5 });
    });
    act(() => {
      useViewportStore.getState().toggleChannel("B");
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    // Both channels are visible again
    const axisB = uplot.axes.find((a) => a.scale === "y1")!;
    const axisA = uplot.axes.find((a) => a.scale === "y0")!;
    expect(axisA.show).toBe(true);
    expect(axisB.show).toBe(true);
    expect(axisA.ticks?.show).toBe(true);
    expect(axisB.ticks?.show).toBe(true);
    expect(axisA.grid?.show).toBe(true); // A is selected
    expect(axisB.grid?.show).toBe(false); // B is not selected

    const valuesA = (
      axisA.values as (u: unknown, splits: number[]) => string[]
    )(uplot, [-5, 0, 5]);
    const valuesB = (
      axisB.values as (u: unknown, splits: number[]) => string[]
    )(uplot, [-100, 0, 100]);
    expect(valuesA.length).toBe(3);
    expect(valuesB.length).toBe(3);
    expect(axisA.label).toBeTruthy();
    expect(axisB.label).toBeTruthy();
  });

  it("AC5: per-division banner values and readout-card values keep own-magnitude canonical SI (±1600 V window renders 400 V/div with a kV axis)", async () => {
    const uplot = await mount(5);
    await zoomYTo(uplot, -1600, 1600);
    // Axis renders kV because maxAbs = 1600 >= 1000
    expect(uplot.axes[1]!.label).toBe("A (kV)");

    // Window span is 3200 V, so 8 divisions = 400 V/div
    const windowSpan = 1600 - -1600;
    const perDiv = windowSpan / 8;
    expect(perDiv).toBe(400);

    // formatCanonicalPerDiv formats using own-magnitude canonical SI (400 V/Div, not 0.4 kV/Div)
    const perDivFormatted = formatCanonicalPerDiv(perDiv, "V");
    expect(perDivFormatted).toBe("400 V/Div");
  });
});
