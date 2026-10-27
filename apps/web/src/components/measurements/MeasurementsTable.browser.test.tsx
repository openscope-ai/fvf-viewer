import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import MeasurementsTable from "./MeasurementsTable";
import WaveformToolbar from "../toolbar/WaveformToolbar";
import { useCaptureStore } from "../../state/captureStore";
import { useViewportStore } from "../../state/viewportStore";
import { useMeasurementsStore } from "../../state/measurementsStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import { useCursorStore } from "../../state/cursorStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useThemeStore } from "../../state/themeStore";
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
    useReferenceStore.getState().clear();
    useThemeStore.getState().setTheme("dark");
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
    useReferenceStore.getState().clear();
    useThemeStore.getState().setTheme("dark");
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

  it("renders timing section with graceful fallback for flat/insufficient signals", async () => {
    const capture = useCaptureStore.getState().capture;
    useMeasurementsStore.getState().setOpen(true);

    await act(async () => {
      root.render(<MeasurementsTable capture={capture} />);
    });

    const timingSection = hostElement.querySelector(
      "[data-testid='timing-measurements-section']",
    );
    expect(timingSection).not.toBeNull();

    expect(
      hostElement.querySelector("[data-testid='timing-gate-mode']")
        ?.textContent,
    ).toBe("Visible Window");
    expect(
      hostElement.querySelector("[data-testid='timing-period']")?.textContent,
    ).toBe("--");
    expect(
      hostElement.querySelector("[data-testid='timing-frequency']")
        ?.textContent,
    ).toBe("--");
    expect(
      hostElement.querySelector("[data-testid='timing-positive-width']")
        ?.textContent,
    ).toBe("--");
    expect(
      hostElement.querySelector("[data-testid='timing-negative-width']")
        ?.textContent,
    ).toBe("--");
    expect(
      hostElement.querySelector("[data-testid='timing-duty-cycle']")
        ?.textContent,
    ).toBe("--");
  });

  it("displays accurate timing measurements for periodic signals and updates on channel switch", async () => {
    const n = 1000;
    const fs = 100_000;
    const dt = 1 / fs;
    const timestamps = new Float32Array(n);
    const chA = new Float32Array(n);
    const chB = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      timestamps[i] = i * dt;
      chA[i] = Math.sin(2 * Math.PI * 1000 * timestamps[i]!); // 1 kHz
      chB[i] = i % 200 < 100 ? 5.0 : 0.0; // 500 Hz
    }
    const periodicCapture: ParsedCapture = {
      timestamps,
      channels: [
        { name: "A", label: "Input A", derived: false, data: chA },
        { name: "B", label: "Input B", derived: false, data: chB },
      ],
      derivedChannels: [],
      warnings: [],
      metadata: {
        version: 1,
        flavor: "synthetic",
        timebaseRaw: "1.0 ms/Div",
        secondsPerDiv: 1e-3,
        timestamp14: "20261018120000",
        samples: n,
        deltaT: dt,
        channels: [
          {
            name: "A",
            label: "Input A",
            derived: false,
            samples: n,
            deltaT: dt,
            unit: "V",
          },
          {
            name: "B",
            label: "Input B",
            derived: false,
            samples: n,
            deltaT: dt,
            unit: "V",
          },
        ],
      },
    };

    useMeasurementsStore.getState().setOpen(true);
    useViewportStore.getState().setSelectedChannel("A");

    await act(async () => {
      root.render(<MeasurementsTable capture={periodicCapture} />);
    });

    // Channel A is 1 kHz sine wave
    expect(
      hostElement.querySelector("[data-testid='timing-period']")?.textContent,
    ).toBe("1.000 ms");
    expect(
      hostElement.querySelector("[data-testid='timing-frequency']")
        ?.textContent,
    ).toBe("1.000 kHz");
    expect(
      hostElement.querySelector("[data-testid='timing-duty-cycle']")
        ?.textContent,
    ).toBe("50.0 %");

    // Switch selected channel to Channel B (500 Hz square wave)
    await act(async () => {
      useViewportStore.getState().setSelectedChannel("B");
    });

    expect(
      hostElement.querySelector("[data-testid='timing-period']")?.textContent,
    ).toBe("2.000 ms");
    expect(
      hostElement.querySelector("[data-testid='timing-frequency']")
        ?.textContent,
    ).toBe("500.0 Hz");
  });

  it("gates timing measurements between C1 and C2 when active and falls back to visible window", async () => {
    const n = 1000;
    const fs = 100_000;
    const dt = 1 / fs;
    const timestamps = new Float32Array(n);
    const chA = new Float32Array(n);
    // Construct dual-frequency signal: first half 1 kHz (T=1ms), second half 2 kHz (T=0.5ms)
    for (let i = 0; i < n; i++) {
      timestamps[i] = i * dt;
      if (i < 500) {
        chA[i] = Math.sin(2 * Math.PI * 1000 * timestamps[i]!);
      } else {
        chA[i] = Math.sin(2 * Math.PI * 2000 * timestamps[i]!);
      }
    }
    const dualFreqCapture: ParsedCapture = {
      timestamps,
      channels: [{ name: "A", label: "Input A", derived: false, data: chA }],
      derivedChannels: [],
      warnings: [],
      metadata: {
        version: 1,
        flavor: "synthetic",
        timebaseRaw: "1.0 ms/Div",
        secondsPerDiv: 1e-3,
        timestamp14: "20261018120000",
        samples: n,
        deltaT: dt,
        channels: [
          {
            name: "A",
            label: "Input A",
            derived: false,
            samples: n,
            deltaT: dt,
            unit: "V",
          },
        ],
      },
    };

    useMeasurementsStore.getState().setOpen(true);
    useViewportStore.getState().setSelectedChannel("A");

    await act(async () => {
      root.render(<MeasurementsTable capture={dualFreqCapture} />);
    });

    // 1. Initial state: cursors inactive -> Visible Window.
    // Full window contains mixed 1 kHz and 2 kHz frequencies, failing periodicity check -> '--'
    expect(
      hostElement.querySelector("[data-testid='timing-gate-mode']")
        ?.textContent,
    ).toBe("Visible Window");
    const subtitle = hostElement.querySelector(
      ".amplitude-measurements-subtitle",
    );
    expect(subtitle?.textContent).toBe("(Visible Window)");
    expect(
      hostElement.querySelector("[data-testid='timing-period']")?.textContent,
    ).toBe("--");

    // 2. Gate C1 and C2 around first half (samples 50 to 450): strictly 1 kHz sine
    await act(async () => {
      useCursorStore.getState().setCursorActive("C1", true);
      useCursorStore.getState().setCursorActive("C2", true);
      useCursorStore.getState().setCursorPositions(50, 450, n);
    });

    expect(
      hostElement.querySelector("[data-testid='timing-gate-mode']")
        ?.textContent,
    ).toBe("Gated: C1–C2");
    // Amplitude subtitle remains '(Visible Window)' because amplitude rows are visible-window scoped
    expect(
      hostElement.querySelector(".amplitude-measurements-subtitle")
        ?.textContent,
    ).toBe("(Visible Window)");
    expect(
      hostElement.querySelector("[data-testid='timing-period']")?.textContent,
    ).toBe("1.000 ms");
    expect(
      hostElement.querySelector("[data-testid='timing-frequency']")
        ?.textContent,
    ).toBe("1.000 kHz");

    // 3. Move gate to second half (samples 550 to 950): strictly 2 kHz sine
    await act(async () => {
      useCursorStore.getState().setCursorPositions(550, 950, n);
    });

    expect(
      hostElement.querySelector("[data-testid='timing-period']")?.textContent,
    ).toBe("500.0 µs");
    expect(
      hostElement.querySelector("[data-testid='timing-frequency']")
        ?.textContent,
    ).toBe("2.000 kHz");

    // 4. Deactivate C2 -> reverts to Visible Window (mixed frequencies -> '--')
    await act(async () => {
      useCursorStore.getState().setCursorActive("C2", false);
    });

    expect(
      hostElement.querySelector("[data-testid='timing-gate-mode']")
        ?.textContent,
    ).toBe("Visible Window");
    expect(
      hostElement.querySelector(".amplitude-measurements-subtitle")
        ?.textContent,
    ).toBe("(Visible Window)");
    expect(
      hostElement.querySelector("[data-testid='timing-period']")?.textContent,
    ).toBe("--");
  });

  it("toggles between Visible-window and Full-record gating modes with expected labeling and values (Issue #280 AC3)", async () => {
    const capture = useCaptureStore.getState().capture;
    useMeasurementsStore.getState().setOpen(true);

    await act(async () => {
      root.render(<MeasurementsTable capture={capture} />);
    });

    const windowBtn = hostElement.querySelector(
      "[data-testid='gating-mode-visible']",
    ) as HTMLButtonElement;
    const fullBtn = hostElement.querySelector(
      "[data-testid='gating-mode-full']",
    ) as HTMLButtonElement;
    const gatingLabel = hostElement.querySelector(
      "[data-testid='measurements-gating-label']",
    );

    expect(windowBtn).not.toBeNull();
    expect(fullBtn).not.toBeNull();
    expect(windowBtn.classList.contains("active")).toBe(true);
    expect(fullBtn.classList.contains("active")).toBe(false);
    expect(gatingLabel?.textContent).toBe("(Visible Window)");

    // Zoom into Channel B samples 1 to 3 ([0, 5, 10])
    await act(async () => {
      useViewportStore.getState().setBounds({
        xMin: 1e-6,
        xMax: 3e-6,
      });
    });

    // In Visible Window mode, Vmax for Channel B is 10.00 V (samples 1..3)
    const rowB = hostElement.querySelector("[data-testid='measurement-row-b']");
    expect(
      rowB?.querySelector("[data-testid='measurement-vmax-b']")?.textContent,
    ).toBe("10.00 V");

    // Click 'Full' to switch to Full-record gating mode
    await act(async () => {
      fullBtn.click();
    });

    expect(windowBtn.classList.contains("active")).toBe(false);
    expect(fullBtn.classList.contains("active")).toBe(true);
    expect(gatingLabel?.textContent).toBe("(Full Record)");

    // In Full Record mode, Vmax for Channel B is 15.00 V (sample 4 at 15V is included despite zoom)
    expect(
      rowB?.querySelector("[data-testid='measurement-vmax-b']")?.textContent,
    ).toBe("15.00 V");

    // Click 'Window' to revert to Visible-window gating mode
    await act(async () => {
      windowBtn.click();
    });

    expect(windowBtn.classList.contains("active")).toBe(true);
    expect(fullBtn.classList.contains("active")).toBe(false);
    expect(gatingLabel?.textContent).toBe("(Visible Window)");
    expect(
      rowB?.querySelector("[data-testid='measurement-vmax-b']")?.textContent,
    ).toBe("10.00 V");
  });

  it("accumulates running statistics across viewport changes and resets with Clear action (Issue #280 AC1, AC2)", async () => {
    const capture = useCaptureStore.getState().capture;
    useMeasurementsStore.getState().setOpen(true);

    await act(async () => {
      root.render(<MeasurementsTable capture={capture} />);
    });

    const statsToggle = hostElement.querySelector(
      "[data-testid='stats-toggle']",
    ) as HTMLButtonElement;
    const clearBtn = hostElement.querySelector(
      "[data-testid='clear-stats-button']",
    ) as HTMLButtonElement;

    expect(statsToggle).not.toBeNull();
    expect(clearBtn).not.toBeNull();

    // Toggle stats table view
    await act(async () => {
      statsToggle.click();
    });

    const statsTable = hostElement.querySelector(
      "[data-testid='measurements-stats-table']",
    );
    expect(statsTable).not.toBeNull();

    // After initial load, Channel B Vmax has count = 1, current = 15.00 V
    const countCell = hostElement.querySelector(
      "[data-testid='stats-count-b-vmax']",
    );
    const currentCell = hostElement.querySelector(
      "[data-testid='stats-current-b-vmax']",
    );
    const minCell = hostElement.querySelector(
      "[data-testid='stats-min-b-vmax']",
    );
    const maxCell = hostElement.querySelector(
      "[data-testid='stats-max-b-vmax']",
    );

    expect(countCell?.textContent).toBe("1");
    expect(currentCell?.textContent).toBe("15.00 V");
    expect(minCell?.textContent).toBe("15.00 V");
    expect(maxCell?.textContent).toBe("15.00 V");

    // Zoom into samples 1..3 (Vmax drops to 10.00 V)
    await act(async () => {
      useViewportStore.getState().setBounds({
        xMin: 1e-6,
        xMax: 3e-6,
      });
    });

    // Count increments to 2, min is 10.00 V, max is 15.00 V, mean is 12.50 V
    expect(countCell?.textContent).toBe("2");
    expect(currentCell?.textContent).toBe("10.00 V");
    expect(minCell?.textContent).toBe("10.00 V");
    expect(maxCell?.textContent).toBe("15.00 V");
    expect(
      hostElement.querySelector("[data-testid='stats-mean-b-vmax']")
        ?.textContent,
    ).toBe("12.50 V");

    // Click 'Clear' button to reset accumulated statistics
    await act(async () => {
      clearBtn.click();
    });

    // Count resets to 0
    expect(
      hostElement.querySelector("[data-testid='stats-count-b-vmax']")
        ?.textContent,
    ).toBe("0");

    // Toggle back to regular table view
    await act(async () => {
      statsToggle.click();
    });

    expect(
      hostElement.querySelector("[data-testid='measurements-stats-table']"),
    ).toBeNull();
    expect(
      hostElement.querySelector("[data-testid='amplitude-measurements-table']"),
    ).not.toBeNull();
  });

  it("does not spuriously accumulate samples on panel reopen, theme change, or channel switch (F1)", async () => {
    const capture = useCaptureStore.getState().capture;
    useMeasurementsStore.getState().setOpen(true);

    await act(async () => {
      root.render(<MeasurementsTable capture={capture} />);
    });

    const statsToggle = hostElement.querySelector(
      "[data-testid='stats-toggle']",
    ) as HTMLButtonElement;

    // Toggle stats table view
    await act(async () => {
      statsToggle.click();
    });

    const countCell = hostElement.querySelector(
      "[data-testid='stats-count-b-vmax']",
    );
    expect(countCell?.textContent).toBe("1");

    // 1. Close panel and reopen: count must remain 1
    await act(async () => {
      useMeasurementsStore.getState().setOpen(false);
    });
    await act(async () => {
      useMeasurementsStore.getState().setOpen(true);
    });
    expect(
      hostElement.querySelector("[data-testid='stats-count-b-vmax']")
        ?.textContent,
    ).toBe("1");

    // 2. Change theme: count must remain 1
    await act(async () => {
      useThemeStore.getState().setTheme("light");
    });
    expect(
      hostElement.querySelector("[data-testid='stats-count-b-vmax']")
        ?.textContent,
    ).toBe("1");
    await act(async () => {
      useThemeStore.getState().setTheme("dark");
    });

    // 3. Switch selected channel: count must remain 1
    await act(async () => {
      useViewportStore.getState().setSelectedChannel("C");
    });
    expect(
      hostElement.querySelector("[data-testid='stats-count-b-vmax']")
        ?.textContent,
    ).toBe("1");

    // 4. Actual viewport zoom: count must increment to 2
    await act(async () => {
      useViewportStore.getState().setBounds({
        xMin: 1e-6,
        xMax: 2e-6,
      });
    });
    expect(
      hostElement.querySelector("[data-testid='stats-count-b-vmax']")
        ?.textContent,
    ).toBe("2");
  });

  it("handles Full record mode combined with active cursors without label conflict (F3)", async () => {
    const capture = useCaptureStore.getState().capture;
    useMeasurementsStore.getState().setOpen(true);

    await act(async () => {
      root.render(<MeasurementsTable capture={capture} />);
    });

    const fullBtn = hostElement.querySelector(
      "[data-testid='gating-mode-full']",
    ) as HTMLButtonElement;

    // Switch to Full Record mode
    await act(async () => {
      fullBtn.click();
    });

    const gatingLabel = hostElement.querySelector(
      "[data-testid='measurements-gating-label']",
    );
    expect(gatingLabel?.textContent).toBe("(Full Record)");

    // With cursors inactive, timing badge displays Full Record
    expect(
      hostElement.querySelector("[data-testid='timing-gate-mode']")
        ?.textContent,
    ).toBe("Full Record");

    // Activate C1 and C2 cursors
    await act(async () => {
      useCursorStore.getState().setCursorActive("C1", true);
      useCursorStore.getState().setCursorActive("C2", true);
      useCursorStore.getState().setCursorPositions(1, 3, 5);
    });

    // Amplitude header retains (Full Record), while timing badge clearly discloses Gated: C1–C2
    expect(gatingLabel?.textContent).toBe("(Full Record)");
    expect(
      hostElement.querySelector("[data-testid='timing-gate-mode']")
        ?.textContent,
    ).toBe("Gated: C1–C2");

    // Deactivate C2 -> timing badge reverts to Full Record
    await act(async () => {
      useCursorStore.getState().setCursorActive("C2", false);
    });
    expect(gatingLabel?.textContent).toBe("(Full Record)");
    expect(
      hostElement.querySelector("[data-testid='timing-gate-mode']")
        ?.textContent,
    ).toBe("Full Record");
  });

  it("accumulates new statistics when channel display transform or channel visibility changes (F-DEDUP-SCOPE-1)", async () => {
    const capture = useCaptureStore.getState().capture;
    useMeasurementsStore.getState().setOpen(true);

    await act(async () => {
      root.render(<MeasurementsTable capture={capture} />);
    });

    const statsToggle = hostElement.querySelector(
      "[data-testid='stats-toggle']",
    ) as HTMLButtonElement;

    // Toggle stats view
    await act(async () => {
      statsToggle.click();
    });

    const countCellB = hostElement.querySelector(
      "[data-testid='stats-count-b-vmax']",
    );
    expect(countCellB?.textContent).toBe("1");
    expect(
      hostElement.querySelector("[data-testid='stats-current-b-vmax']")
        ?.textContent,
    ).toBe("15.00 V");

    // 1. Invert Channel B -> Vmax becomes 5.00 V (raw [-5..15] inverted is [5..-15])
    await act(async () => {
      useChannelDisplayStore.getState().setInverted("B", true);
    });

    // Count increments to 2, min is 5.00 V, max is 15.00 V
    expect(
      hostElement.querySelector("[data-testid='stats-count-b-vmax']")
        ?.textContent,
    ).toBe("2");
    expect(
      hostElement.querySelector("[data-testid='stats-current-b-vmax']")
        ?.textContent,
    ).toBe("5.000 V");
    expect(
      hostElement.querySelector("[data-testid='stats-min-b-vmax']")
        ?.textContent,
    ).toBe("5.000 V");
    expect(
      hostElement.querySelector("[data-testid='stats-max-b-vmax']")
        ?.textContent,
    ).toBe("15.00 V");
  });

  it("accumulates new statistics when reference channel time-slip changes (F-REF-SIG-1)", async () => {
    const capture = useCaptureStore.getState().capture;
    const ref = createSyntheticCapture();
    useReferenceStore.setState({
      capture: ref,
      fileName: "ref.fvf",
      lanes: [
        new Float32Array([10, 10, 10, 10, 10]),
        new Float32Array([-5, 0, 5, 10, 15]),
      ],
      refActiveChannels: ["Ref-A", "Ref-B"],
      timeSlipSamples: 0,
      parseState: "success",
    });

    useMeasurementsStore.getState().setOpen(true);

    await act(async () => {
      root.render(<MeasurementsTable capture={capture} />);
    });

    const statsToggle = hostElement.querySelector(
      "[data-testid='stats-toggle']",
    ) as HTMLButtonElement;

    // Toggle stats view
    await act(async () => {
      statsToggle.click();
    });

    const countCellRefB = hostElement.querySelector(
      "[data-testid='stats-count-ref-b-vmax']",
    );
    expect(countCellRefB?.textContent).toBe("1");
    expect(
      hostElement.querySelector("[data-testid='stats-current-ref-b-vmax']")
        ?.textContent,
    ).toBe("15.00 V");

    // Change time-slip from 0 to 1 -> slipped lane shifts values
    await act(async () => {
      useReferenceStore.getState().setTimeSlip(1);
    });

    // Count increments to 2
    expect(
      hostElement.querySelector("[data-testid='stats-count-ref-b-vmax']")
        ?.textContent,
    ).toBe("2");
  });
});
