import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import MeasurementsTable from "./MeasurementsTable";
import WaveformToolbar from "../toolbar/WaveformToolbar";
import { useCaptureStore } from "../../state/captureStore";
import { useViewportStore } from "../../state/viewportStore";
import { useMeasurementsStore } from "../../state/measurementsStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import type { ParsedCapture } from "../../types/capture";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Creates a synthetic capture with known amplitude statistics:
 * Channel A: 10V constant DC -> Vpp=0, Vmax=10, Vmin=10, Mean=10, RMS=10
 * Channel B: [-5, 0, 5, 10, 15] -> Vpp=20, Vmax=15, Vmin=-5, Mean=5, RMS=sqrt((25+0+25+100+225)/5)=sqrt(75)≈8.660V
 * Channel C: includes saturated NaN samples [2, NaN, 4, NaN, 6] -> Vpp=4, Vmax=6, Vmin=2, Mean=4
 */
function createSyntheticCapture(): ParsedCapture {
  const timestamps = new Float32Array([0, 1e-6, 2e-6, 3e-6, 4e-6]);
  const channelA = new Float32Array([10, 10, 10, 10, 10]);
  const channelB = new Float32Array([-5, 0, 5, 10, 15]);
  const channelC = new Float32Array([2, NaN, 4, NaN, 6]);

  return {
    timestamps,
    channels: [
      { name: "A", label: "Input A", derived: false, data: channelA },
      { name: "B", label: "Input B", derived: false, data: channelB },
      { name: "C", label: "Input C", derived: false, data: channelC },
    ],
    derivedChannels: [],
    warnings: [],
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "1.0 us/Div",
      secondsPerDiv: 1e-6,
      timestamp14: "20261018120000",
      samples: 5,
      deltaT: 1e-6,
      channels: [
        {
          name: "A",
          label: "Input A",
          derived: false,
          samples: 5,
          deltaT: 1e-6,
          unit: "V",
        },
        {
          name: "B",
          label: "Input B",
          derived: false,
          samples: 5,
          deltaT: 1e-6,
          unit: "V",
        },
        {
          name: "C",
          label: "Input C",
          derived: false,
          samples: 5,
          deltaT: 1e-6,
          unit: "V",
        },
      ],
    },
  };
}

describe("MeasurementsTable (browser) - Issue #278", () => {
  let hostElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useCaptureStore.setState({
      capture: createSyntheticCapture(),
      fileName: "test.fvf",
      parseState: "success",
      error: null,
    });
    useViewportStore.getState().reset();
    useViewportStore.getState().setActiveChannels(["A", "B", "C"]);
    useChannelDisplayStore.getState().resetTransforms();
    useMeasurementsStore.getState().reset();

    hostElement = document.createElement("div");
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    hostElement.remove();
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
    useMeasurementsStore.getState().reset();
  });

  it("does not render when measurements panel is closed", async () => {
    const capture = useCaptureStore.getState().capture;
    await act(async () => {
      root.render(<MeasurementsTable capture={capture} />);
    });

    expect(
      hostElement.querySelector("[data-testid='amplitude-measurements-panel']"),
    ).toBeNull();
  });

  it("renders table with known amplitude statistics for all visible channels", async () => {
    const capture = useCaptureStore.getState().capture;
    useMeasurementsStore.getState().setOpen(true);

    await act(async () => {
      root.render(<MeasurementsTable capture={capture} />);
    });

    const panel = hostElement.querySelector(
      "[data-testid='amplitude-measurements-panel']",
    );
    expect(panel).not.toBeNull();

    // Verify Channel A stats (10V constant DC)
    const rowA = hostElement.querySelector("[data-testid='measurement-row-a']");
    expect(rowA).not.toBeNull();
    expect(
      rowA?.querySelector("[data-testid='measurement-vpp-a']")?.textContent,
    ).toBe("0.000 V");
    expect(
      rowA?.querySelector("[data-testid='measurement-vmax-a']")?.textContent,
    ).toBe("10.00 V");
    expect(
      rowA?.querySelector("[data-testid='measurement-vmin-a']")?.textContent,
    ).toBe("10.00 V");
    expect(
      rowA?.querySelector("[data-testid='measurement-mean-a']")?.textContent,
    ).toBe("10.00 V");
    expect(
      rowA?.querySelector("[data-testid='measurement-rms-a']")?.textContent,
    ).toBe("10.00 V");

    // Verify Channel B stats ([-5, 0, 5, 10, 15] -> Vpp=20V, Vmax=15V, Vmin=-5V, Mean=5V, RMS=8.660V)
    const rowB = hostElement.querySelector("[data-testid='measurement-row-b']");
    expect(rowB).not.toBeNull();
    expect(
      rowB?.querySelector("[data-testid='measurement-vpp-b']")?.textContent,
    ).toBe("20.00 V");
    expect(
      rowB?.querySelector("[data-testid='measurement-vmax-b']")?.textContent,
    ).toBe("15.00 V");
    expect(
      rowB?.querySelector("[data-testid='measurement-vmin-b']")?.textContent,
    ).toBe("-5.000 V");
    expect(
      rowB?.querySelector("[data-testid='measurement-mean-b']")?.textContent,
    ).toBe("5.000 V");
    expect(
      rowB?.querySelector("[data-testid='measurement-rms-b']")?.textContent,
    ).toBe("8.660 V");

    // Verify Channel C stats with saturated NaN samples ([2, NaN, 4, NaN, 6])
    const rowC = hostElement.querySelector("[data-testid='measurement-row-c']");
    expect(rowC).not.toBeNull();
    expect(
      rowC?.querySelector("[data-testid='measurement-vpp-c']")?.textContent,
    ).toBe("4.000 V");
    expect(
      rowC?.querySelector("[data-testid='measurement-vmax-c']")?.textContent,
    ).toBe("6.000 V");
    expect(
      rowC?.querySelector("[data-testid='measurement-vmin-c']")?.textContent,
    ).toBe("2.000 V");
    expect(
      rowC?.querySelector("[data-testid='measurement-mean-c']")?.textContent,
    ).toBe("4.000 V");
  });

  it("updates statistics live when viewport bounds change (simulating zoom)", async () => {
    const capture = useCaptureStore.getState().capture;
    useMeasurementsStore.getState().setOpen(true);

    await act(async () => {
      root.render(<MeasurementsTable capture={capture} />);
    });

    // Zoom into samples 1 to 3 of Channel B (values: [0, 5, 10])
    // Timestamps: [1e-6, 3e-6]
    await act(async () => {
      useViewportStore.getState().setBounds({
        xMin: 1e-6,
        xMax: 3e-6,
      });
    });

    // For [0, 5, 10]: Vpp = 10V, Vmax = 10V, Vmin = 0V, Mean = 5V
    const rowB = hostElement.querySelector("[data-testid='measurement-row-b']");
    expect(
      rowB?.querySelector("[data-testid='measurement-vpp-b']")?.textContent,
    ).toBe("10.00 V");
    expect(
      rowB?.querySelector("[data-testid='measurement-vmax-b']")?.textContent,
    ).toBe("10.00 V");
    expect(
      rowB?.querySelector("[data-testid='measurement-vmin-b']")?.textContent,
    ).toBe("0.000 V");
    expect(
      rowB?.querySelector("[data-testid='measurement-mean-b']")?.textContent,
    ).toBe("5.000 V");
  });

  it("updates rows when channel visibility changes", async () => {
    const capture = useCaptureStore.getState().capture;
    useMeasurementsStore.getState().setOpen(true);

    await act(async () => {
      root.render(<MeasurementsTable capture={capture} />);
    });

    expect(
      hostElement.querySelector("[data-testid='measurement-row-a']"),
    ).not.toBeNull();
    expect(
      hostElement.querySelector("[data-testid='measurement-row-b']"),
    ).not.toBeNull();

    // Hide Channel B
    await act(async () => {
      useViewportStore.getState().setActiveChannels(["A", "C"]);
    });

    expect(
      hostElement.querySelector("[data-testid='measurement-row-a']"),
    ).not.toBeNull();
    expect(
      hostElement.querySelector("[data-testid='measurement-row-b']"),
    ).toBeNull();
    expect(
      hostElement.querySelector("[data-testid='measurement-row-c']"),
    ).not.toBeNull();
  });

  it("toggles table via Measurements toolbar button and closes via close button", async () => {
    const capture = useCaptureStore.getState().capture;

    await act(async () => {
      root.render(
        <div>
          <WaveformToolbar />
          <MeasurementsTable capture={capture} />
        </div>,
      );
    });

    const toggleButton = hostElement.querySelector(
      "[data-testid='measurements-toggle-button']",
    ) as HTMLButtonElement;
    expect(toggleButton).not.toBeNull();
    expect(toggleButton.getAttribute("aria-pressed")).toBe("false");
    expect(
      hostElement.querySelector("[data-testid='amplitude-measurements-panel']"),
    ).toBeNull();

    // 1. Click toggle button -> opens measurements table
    await act(async () => {
      toggleButton.click();
    });

    expect(toggleButton.getAttribute("aria-pressed")).toBe("true");
    const panel = hostElement.querySelector(
      "[data-testid='amplitude-measurements-panel']",
    );
    expect(panel).not.toBeNull();

    // 2. Click close button -> closes measurements table
    const closeButton = hostElement.querySelector(
      "[data-testid='measurements-close-button']",
    ) as HTMLButtonElement;
    expect(closeButton).not.toBeNull();

    await act(async () => {
      closeButton.click();
    });

    expect(toggleButton.getAttribute("aria-pressed")).toBe("false");
    expect(
      hostElement.querySelector("[data-testid='amplitude-measurements-panel']"),
    ).toBeNull();
  });
});
