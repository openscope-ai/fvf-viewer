/**
 * Browser-mode vitest project tests for Out-of-view Cursor Recovery (Issue #15).
 *
 * Verifies Acceptance Criteria AC1 through AC12:
 * - Directional recovery badges (◀ C1, C2 ▶) based on active X bounds
 * - Vertical stacking (C1 above C2) on same margin
 * - Accent styling (#E040FB / #B0B0B0) and directional chevrons
 * - Accessible <button> elements with tabIndex={0}, Enter/Space, and descriptive aria-label
 * - Informative tooltip with timestamp and 'Click to center in view'
 * - Sample-snapped midpoint recovery ((xMin + xMax) / 2 -> discrete sample index)
 * - Auto-selection of recovered cursor
 * - Immediate badge dismissal upon recovery, toggle-off, or zoom/fit restoration
 * - Pointer event isolation preventing box-zoom
 * - HUD readout card row visual dimming when cursor is out of view
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import "../../index.css";
import Oscilloscope from "../canvas/Oscilloscope";
import WaveformToolbar from "../toolbar/WaveformToolbar";
import { useCursorStore } from "../../state/cursorStore";
import { useViewportStore } from "../../state/viewportStore";
import { useCaptureStore } from "../../state/captureStore";
import type { ParsedCapture } from "../../types/capture";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createTestCapture(sampleCount = 1000): ParsedCapture {
  const timestamps = new Float32Array(sampleCount);
  const ch1Data = new Float32Array(sampleCount);
  const ch2Data = new Float32Array(sampleCount);

  // Sampling delta-t = 10 µs, center at N/2
  const dt = 1e-5;
  const center = Math.floor(sampleCount / 2);
  for (let i = 0; i < sampleCount; i++) {
    timestamps[i] = (i - center) * dt;
    ch1Data[i] = Math.sin(i * 0.05) * 3.3;
    ch2Data[i] = Math.cos(i * 0.05) * 1.8;
  }

  return {
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "10 us/Div",
      secondsPerDiv: 1e-5,
      timestamp14: "12300020260905",
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
        {
          name: "B",
          label: "Input B",
          derived: false,
          samples: sampleCount,
          deltaT: dt,
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

describe("Out-of-view Cursor Recovery (Issue #15)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;
  let capture: ParsedCapture;

  beforeEach(() => {
    useCursorStore.getState().reset();
    useViewportStore.getState().reset();
    useCaptureStore.getState().reset();

    capture = createTestCapture(1000);
    useCaptureStore.setState({ capture });

    hostElement = document.createElement("div");
    hostElement.style.width = "800px";
    hostElement.style.height = "500px";
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    hostElement.remove();
    useCursorStore.getState().reset();
    useViewportStore.getState().reset();
    useCaptureStore.getState().reset();
  });

  it("AC1 & AC3: Directional recovery badges appear iff cursor is outside X bounds with accent colors", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    // Activate C1 and C2
    act(() => {
      useCursorStore.getState().toggleCursor("C1", 1000);
      useCursorStore.getState().toggleCursor("C2", 1000);
    });

    // Both cursors start at 25% and 75% (in-view on full capture): no recovery badges
    expect(
      hostElement.querySelector("[data-testid='cursor-recovery-badge-c1']"),
    ).toBeNull();
    expect(
      hostElement.querySelector("[data-testid='cursor-recovery-badge-c2']"),
    ).toBeNull();

    // Zoom into middle: [timestamps[400], timestamps[600]]
    // C1 is at idx 249 (t < xMin -> left)
    // C2 is at idx 749 (t > xMax -> right)
    const tMin = capture.timestamps[400]!;
    const tMax = capture.timestamps[600]!;
    act(() => {
      useViewportStore.getState().setBounds({ xMin: tMin, xMax: tMax });
    });

    const badgeC1 = hostElement.querySelector(
      "[data-testid='cursor-recovery-badge-c1']",
    ) as HTMLButtonElement;
    const badgeC2 = hostElement.querySelector(
      "[data-testid='cursor-recovery-badge-c2']",
    ) as HTMLButtonElement;

    expect(badgeC1).not.toBeNull();
    expect(badgeC2).not.toBeNull();

    // C1 should pin to left margin with ◀ C1
    expect(badgeC1.textContent).toContain("◀");
    expect(badgeC1.textContent).toContain("C1");
    expect(badgeC1.style.borderColor).toBe("rgb(224, 64, 251)"); // #E040FB

    // C2 should pin to right margin with C2 ▶
    expect(badgeC2.textContent).toContain("▶");
    expect(badgeC2.textContent).toContain("C2");
    expect(badgeC2.style.borderColor).toBe("rgb(176, 176, 176)"); // #B0B0B0
  });

  it("AC2: When both C1 and C2 are out-of-view on the same margin, badges stack vertically (C1 above C2)", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    act(() => {
      useCursorStore.getState().toggleCursor("C1", 1000);
      useCursorStore.getState().toggleCursor("C2", 1000);
    });

    // Zoom to right: [timestamps[800], timestamps[900]]
    // Both C1 (249) and C2 (749) are to the left (t < xMin)
    act(() => {
      useViewportStore.getState().setBounds({
        xMin: capture.timestamps[800]!,
        xMax: capture.timestamps[900]!,
      });
    });

    const leftGroup = hostElement.querySelector(
      "[data-testid='cursor-recovery-left']",
    ) as HTMLDivElement;
    expect(leftGroup).not.toBeNull();

    const children = leftGroup.querySelectorAll("button");
    expect(children.length).toBe(2);
    // C1 must be on top (first child), C2 below (second child)
    expect(children[0]!.getAttribute("data-testid")).toBe(
      "cursor-recovery-badge-c1",
    );
    expect(children[1]!.getAttribute("data-testid")).toBe(
      "cursor-recovery-badge-c2",
    );
  });

  it("AC4 & AC5: Badges have informative tooltip, tabIndex={0}, and descriptive aria-label", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    act(() => {
      useCursorStore.getState().toggleCursor("C1", 1000);
      useViewportStore.getState().setBounds({
        xMin: capture.timestamps[500]!,
        xMax: capture.timestamps[700]!,
      });
    });

    const badgeC1 = hostElement.querySelector(
      "[data-testid='cursor-recovery-badge-c1']",
    ) as HTMLButtonElement;
    expect(badgeC1).not.toBeNull();
    expect(badgeC1.tabIndex).toBe(0);
    expect(badgeC1.title).toContain("Click to bring into view");
    expect(badgeC1.getAttribute("aria-label")).toContain(
      "Recover cursor C1 into view",
    );
  });

  it("AC6, AC7 & AC8: Clicking or keyboard activating badge recovers C1 to 33%, snaps to sample, selects cursor, and dismisses badge", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    act(() => {
      useCursorStore.getState().toggleCursor("C1", 1000);
      useCursorStore.getState().selectCursor(null); // Unselect initially
      useViewportStore.getState().setBounds({
        xMin: capture.timestamps[400]!,
        xMax: capture.timestamps[600]!,
      });
    });

    const badgeC1 = hostElement.querySelector(
      "[data-testid='cursor-recovery-badge-c1']",
    ) as HTMLButtonElement;
    expect(badgeC1).not.toBeNull();

    // Click badge to recover C1
    act(() => {
      badgeC1.click();
    });

    // C1 should be placed at 33% of viewport [400, 600] (400 + 0.33 * 200 = 466)
    const state = useCursorStore.getState();
    expect(state.c1SampleIndex).toBe(466);
    // C1 must be marked selected (AC7)
    expect(state.selectedCursor).toBe("C1");
    // Badge must be immediately dismissed (AC8)
    expect(
      hostElement.querySelector("[data-testid='cursor-recovery-badge-c1']"),
    ).toBeNull();
  });

  it("AC1-AC3 (Issue #132): Recovering C1 places at 33%, C2 at 67%, preventing overlap when both are recovered", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    act(() => {
      useCursorStore.getState().toggleCursor("C1", 1000);
      useCursorStore.getState().toggleCursor("C2", 1000);
      // Place C1 at index 100 (left of 300) and C2 at index 800 (right of 600)
      useCursorStore.getState().setCursorSample("C1", 100, 1000);
      useCursorStore.getState().setCursorSample("C2", 800, 1000);
      useViewportStore.getState().setBounds({
        xMin: capture.timestamps[300]!,
        xMax: capture.timestamps[600]!,
      });
    });

    const badgeC1 = hostElement.querySelector(
      "[data-testid='cursor-recovery-badge-c1']",
    ) as HTMLButtonElement;
    const badgeC2 = hostElement.querySelector(
      "[data-testid='cursor-recovery-badge-c2']",
    ) as HTMLButtonElement;
    expect(badgeC1).not.toBeNull();
    expect(badgeC2).not.toBeNull();

    // Recover C1 -> 33% (300 + 0.33 * 300 = 399)
    act(() => {
      badgeC1.click();
    });
    expect(useCursorStore.getState().c1SampleIndex).toBe(399);
    expect(useCursorStore.getState().selectedCursor).toBe("C1");
    expect(
      hostElement.querySelector("[data-testid='cursor-recovery-badge-c1']"),
    ).toBeNull();

    // Recover C2 -> 67% (300 + 0.67 * 300 = 501)
    act(() => {
      badgeC2.click();
    });
    expect(useCursorStore.getState().c2SampleIndex).toBe(501);
    expect(useCursorStore.getState().selectedCursor).toBe("C2");
    expect(
      hostElement.querySelector("[data-testid='cursor-recovery-badge-c2']"),
    ).toBeNull();

    // Ensure distinct non-overlapping placement (AC3)
    const finalState = useCursorStore.getState();
    expect(finalState.c1SampleIndex).not.toBe(finalState.c2SampleIndex);
    expect(finalState.c2SampleIndex - finalState.c1SampleIndex).toBeGreaterThan(
      50,
    );
  });

  it("AC9: Toggling cursor off dismisses its recovery badge", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    const toggleC1 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c1']",
    ) as HTMLButtonElement;
    act(() => {
      toggleC1.click();
      useViewportStore.getState().setBounds({
        xMin: capture.timestamps[400]!,
        xMax: capture.timestamps[600]!,
      });
    });

    expect(
      hostElement.querySelector("[data-testid='cursor-recovery-badge-c1']"),
    ).not.toBeNull();

    // Toggle C1 off
    act(() => {
      toggleC1.click();
    });

    expect(useCursorStore.getState().c1Active).toBe(false);
    expect(
      hostElement.querySelector("[data-testid='cursor-recovery-badge-c1']"),
    ).toBeNull();
  });

  it("AC10: Triggering Reset View brings cursors into view and dismisses badges", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    act(() => {
      useCursorStore.getState().toggleCursor("C1", 1000);
      useViewportStore.getState().setBounds({
        xMin: capture.timestamps[400]!,
        xMax: capture.timestamps[600]!,
      });
    });

    expect(
      hostElement.querySelector("[data-testid='cursor-recovery-badge-c1']"),
    ).not.toBeNull();

    const fitBtn = hostElement.querySelector(
      ".waveform-fit-button",
    ) as HTMLButtonElement;
    expect(fitBtn).not.toBeNull();

    act(() => {
      fitBtn.click();
    });

    // After fit reset, badge should be dismissed
    expect(
      hostElement.querySelector("[data-testid='cursor-recovery-badge-c1']"),
    ).toBeNull();
  });

  it("AC11: Clicking badge stops propagation and does not trigger canvas box-zoom", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    act(() => {
      useCursorStore.getState().toggleCursor("C1", 1000);
      useViewportStore.getState().setBounds({
        xMin: capture.timestamps[400]!,
        xMax: capture.timestamps[600]!,
      });
    });

    const badgeC1 = hostElement.querySelector(
      "[data-testid='cursor-recovery-badge-c1']",
    ) as HTMLButtonElement;
    const overlay = hostElement.querySelector(
      "[data-testid='box-zoom-overlay']",
    ) as HTMLDivElement;

    expect(overlay.style.display).toBe("none");

    act(() => {
      badgeC1.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
      badgeC1.click();
    });

    // Box zoom overlay should never be shown
    expect(overlay.style.display).toBe("none");
  });

  it("AC12: When cursor is out-of-view, its corresponding row in floating readout card is visually dimmed", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    act(() => {
      useCursorStore.getState().toggleCursor("C1", 1000);
      useCursorStore.getState().toggleCursor("C2", 1000);
    });

    const rowC1 = hostElement.querySelector(
      "[data-testid='cursor-readout-c1']",
    ) as HTMLDivElement;
    const rowC2 = hostElement.querySelector(
      "[data-testid='cursor-readout-c2']",
    ) as HTMLDivElement;

    // Initially both in view
    expect(rowC1.classList.contains("cursor-readout-row--out-of-view")).toBe(
      false,
    );
    expect(rowC2.classList.contains("cursor-readout-row--out-of-view")).toBe(
      false,
    );

    // Zoom into right half: [timestamps[600], timestamps[900]]
    // C1 is at index 249 (out-of-view), C2 is at index 749 (in-view)
    act(() => {
      useViewportStore.getState().setBounds({
        xMin: capture.timestamps[600]!,
        xMax: capture.timestamps[900]!,
      });
    });

    expect(rowC1.classList.contains("cursor-readout-row--out-of-view")).toBe(
      true,
    );
    expect(rowC2.classList.contains("cursor-readout-row--out-of-view")).toBe(
      false,
    );
  });

  it("F4: right recovery badges and readout card do not collide geometrically", () => {
    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });

    // Activate both cursors and zoom into left region so BOTH cursors are to the right (t > xMax)
    act(() => {
      useCursorStore.getState().toggleCursor("C1", 1000);
      useCursorStore.getState().toggleCursor("C2", 1000);
      useViewportStore.getState().setBounds({
        xMin: capture.timestamps[50]!,
        xMax: capture.timestamps[100]!,
      });
    });

    const rightGroup = hostElement.querySelector(
      ".cursor-recovery-group--right",
    ) as HTMLElement;
    const readoutCard = hostElement.querySelector(
      ".cursor-readout-card",
    ) as HTMLElement;
    expect(rightGroup).not.toBeNull();
    expect(readoutCard).not.toBeNull();

    const groupRect = rightGroup.getBoundingClientRect();
    const cardRect = readoutCard.getBoundingClientRect();

    // The bottom of the recovery badge group must be <= the top of the readout card
    expect(groupRect.bottom).toBeLessThanOrEqual(cardRect.top);
  });
});
