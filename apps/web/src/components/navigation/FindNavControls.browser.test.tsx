import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FindNavControls } from "./FindNavControls";
import { useCaptureStore } from "../../state/captureStore";
import { useViewportStore } from "../../state/viewportStore";
import { useCursorStore } from "../../state/cursorStore";
import type { ParsedCapture } from "../../types/capture";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createTestCapture(): ParsedCapture {
  // 11 samples: 0 to 10 us
  const timestamps = new Float32Array([
    0, 1e-6, 2e-6, 3e-6, 4e-6, 5e-6, 6e-6, 7e-6, 8e-6, 9e-6, 10e-6,
  ]);
  // Channel A: pulse wave with rising edges at index 2 and 6, falling at 4 and 8
  const channelA = new Float32Array([0, 0, 5, 5, 0, 0, 5, 5, 0, 0, 0]);
  // Channel B: saturated signal with NaNs at index 3 and 7
  const channelB = new Float32Array([1, 2, 3, NaN, 3, 2, 3, NaN, 1, 0, 0]);

  return {
    timestamps,
    channels: [
      { name: "A", label: "Input A", derived: false, data: channelA },
      { name: "B", label: "Input B", derived: false, data: channelB },
    ],
    derivedChannels: [],
    warnings: [],
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "1.0 us/Div",
      secondsPerDiv: 1e-6,
      timestamp14: "20261018120000",
      samples: 11,
      deltaT: 1e-6,
      channels: [
        {
          name: "A",
          label: "Input A",
          derived: false,
          samples: 11,
          deltaT: 1e-6,
          unit: "V",
        },
        {
          name: "B",
          label: "Input B",
          derived: false,
          samples: 11,
          deltaT: 1e-6,
          unit: "V",
        },
      ],
    },
  };
}

describe("FindNavControls (browser)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();

    hostElement = document.createElement("div");
    hostElement.style.width = "800px";
    hostElement.style.height = "60px";
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
    useCursorStore.getState().reset();
  });

  it("renders disabled controls when no capture is loaded", () => {
    act(() => {
      root.render(<FindNavControls />);
    });

    const prevBtn = hostElement.querySelector<HTMLButtonElement>(
      "[data-testid='find-prev-btn']",
    );
    const nextBtn = hostElement.querySelector<HTMLButtonElement>(
      "[data-testid='find-next-btn']",
    );
    const select = hostElement.querySelector<HTMLSelectElement>(
      "[data-testid='find-feature-select']",
    );

    expect(prevBtn?.disabled).toBe(true);
    expect(nextBtn?.disabled).toBe(true);
    expect(select?.disabled).toBe(true);
  });

  it("navigates rising edges and centers viewport with polite feedback when bounds reached", () => {
    const capture = createTestCapture();
    useCaptureStore.setState({ capture });
    // Zoomed in on [0, 4us] (span 4us, center 2us)
    useViewportStore.getState().setBounds({ xMin: 0, xMax: 4e-6 });

    act(() => {
      root.render(<FindNavControls />);
    });

    const nextBtn = hostElement.querySelector<HTMLButtonElement>(
      "[data-testid='find-next-btn']",
    )!;

    // Viewport midpoint is 2e-6 (index 2). Next rising edge is at index 6 (timestamp 6e-6).
    act(() => {
      nextBtn.click();
    });

    // Viewport centered on 6e-6 with 4us span -> [4e-6, 8e-6]
    const bounds1 = useViewportStore.getState();
    const center1 = ((bounds1.xMin ?? 0) + (bounds1.xMax ?? 0)) / 2;
    expect(center1).toBeCloseTo(6e-6, 7);
    expect(bounds1.xMin).toBeCloseTo(4e-6, 7);
    expect(bounds1.xMax).toBeCloseTo(8e-6, 7);

    // Clicking next again from 6e-6: no further rising edge exists
    const beforeMin = bounds1.xMin;
    const beforeMax = bounds1.xMax;

    act(() => {
      nextBtn.click();
    });

    // Viewport remains unchanged
    const bounds2 = useViewportStore.getState();
    expect(bounds2.xMin).toBe(beforeMin);
    expect(bounds2.xMax).toBe(beforeMax);

    // Status message communicating no further feature found is rendered
    const statusMsg = hostElement.querySelector(
      "[data-testid='find-status-message']",
    );
    expect(statusMsg).not.toBeNull();
    expect(statusMsg?.textContent).toContain("No further rising edge found");
  });

  it("synchronizes cursor C1 when active during next/previous navigation", () => {
    const capture = createTestCapture();
    useCaptureStore.setState({ capture });
    useViewportStore.getState().setBounds({ xMin: 0, xMax: 10e-6 });

    // Activate cursor C1 at sample index 0
    useCursorStore.getState().toggleCursor("C1", 11);
    useCursorStore.getState().setCursorSample("C1", 0, 11);

    act(() => {
      root.render(<FindNavControls />);
    });

    const nextBtn = hostElement.querySelector<HTMLButtonElement>(
      "[data-testid='find-next-btn']",
    )!;
    const prevBtn = hostElement.querySelector<HTMLButtonElement>(
      "[data-testid='find-prev-btn']",
    )!;

    // Next rising edge from C1 (0) -> index 2
    act(() => {
      nextBtn.click();
    });
    expect(useCursorStore.getState().c1SampleIndex).toBe(2);

    // Next rising edge from C1 (2) -> index 6
    act(() => {
      nextBtn.click();
    });
    expect(useCursorStore.getState().c1SampleIndex).toBe(6);

    // Prev rising edge from C1 (6) -> index 2
    act(() => {
      prevBtn.click();
    });
    expect(useCursorStore.getState().c1SampleIndex).toBe(2);

    // Prev rising edge from C1 (2) -> none before index 2
    act(() => {
      prevBtn.click();
    });
    expect(useCursorStore.getState().c1SampleIndex).toBe(2);

    const statusMsg = hostElement.querySelector(
      "[data-testid='find-status-message']",
    );
    expect(statusMsg?.textContent).toContain("No further rising edge found");
  });

  it("navigates saturated (NaN) samples without errors", () => {
    const capture = createTestCapture();
    useCaptureStore.setState({ capture });
    useViewportStore.getState().setSelectedChannel("B");
    useCursorStore.getState().toggleCursor("C1", 11);
    useCursorStore.getState().setCursorSample("C1", 0, 11);

    act(() => {
      root.render(<FindNavControls />);
    });

    const select = hostElement.querySelector<HTMLSelectElement>(
      "[data-testid='find-feature-select']",
    )!;
    const nextBtn = hostElement.querySelector<HTMLButtonElement>(
      "[data-testid='find-next-btn']",
    )!;

    // Change feature to saturation
    act(() => {
      select.value = "saturation";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Next saturation from 0 -> index 3
    act(() => {
      nextBtn.click();
    });
    expect(useCursorStore.getState().c1SampleIndex).toBe(3);

    // Next saturation from 3 -> index 7
    act(() => {
      nextBtn.click();
    });
    expect(useCursorStore.getState().c1SampleIndex).toBe(7);

    // Next saturation from 7 -> none
    act(() => {
      nextBtn.click();
    });
    expect(useCursorStore.getState().c1SampleIndex).toBe(7);

    const statusMsg = hostElement.querySelector(
      "[data-testid='find-status-message']",
    );
    expect(statusMsg?.textContent).toContain(
      "No further saturated sample found",
    );
  });

  it("navigates peaks and valleys correctly", () => {
    const capture = createTestCapture();
    useCaptureStore.setState({ capture });
    useViewportStore.getState().setSelectedChannel("A");
    useCursorStore.getState().toggleCursor("C1", 11);
    useCursorStore.getState().setCursorSample("C1", 0, 11);

    act(() => {
      root.render(<FindNavControls />);
    });

    const select = hostElement.querySelector<HTMLSelectElement>(
      "[data-testid='find-feature-select']",
    )!;
    const nextBtn = hostElement.querySelector<HTMLButtonElement>(
      "[data-testid='find-next-btn']",
    )!;

    // Select peak
    act(() => {
      select.value = "peak";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Next peak from 0 -> index 3 (top of pulse)
    act(() => {
      nextBtn.click();
    });
    expect(useCursorStore.getState().c1SampleIndex).toBe(3);

    // Next peak from 3 -> index 7
    act(() => {
      nextBtn.click();
    });
    expect(useCursorStore.getState().c1SampleIndex).toBe(7);

    // Select valley
    act(() => {
      select.value = "valley";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const prevBtn = hostElement.querySelector<HTMLButtonElement>(
      "[data-testid='find-prev-btn']",
    )!;

    // Previous valley from 7 -> index 5
    act(() => {
      prevBtn.click();
    });
    expect(useCursorStore.getState().c1SampleIndex).toBe(5);
  });
});
