import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import WaveformToolbar from "../WaveformToolbar";
import Oscilloscope from "../../canvas/Oscilloscope";
import "../../../index.css";
import { useCaptureStore } from "../../../state/captureStore";
import { useChannelNamesStore } from "../../../state/channelNamesStore";
import { useCursorStore } from "../../../state/cursorStore";
import { usePaletteStore } from "../../../state/paletteStore";
import { useThemeStore } from "../../../state/themeStore";
import { useBadgePopoverStore } from "./anchoredPopover";
import { useCursorDisplayStore } from "../../../state/cursorDisplayStore";
import { useViewportStore } from "../../../state/viewportStore";
import {
  createViewportSnapshot,
  useZoomHistoryStore,
} from "../../../state/zoomHistoryStore";
import { useChannelDisplayStore } from "../../../state/channelDisplayStore";
import { CURSOR_MOVEMENT_SUMMARY } from "../../cursors/cursorHelp";
import type { ParsedCapture } from "../../../types/capture";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createTestCapture(): ParsedCapture {
  // 11 samples: 0 to 10 us (deltaT = 1 us)
  const timestamps = new Float32Array([
    0, 1e-6, 2e-6, 3e-6, 4e-6, 5e-6, 6e-6, 7e-6, 8e-6, 9e-6, 10e-6,
  ]);
  // Channel A: pulse with rising edges at index 2 and 6, falling at index 4 and 8
  const channelA = new Float32Array([0, 0, 5, 5, 0, 0, 5, 5, 0, 0, 0]);
  // Channel B: saturated signal with NaNs at index 3 and 7
  const channelB = new Float32Array([1, 2, 3, NaN, 3, 2, 3, NaN, 1, 0, 0]);
  // Channel C: wave with peak at index 0 and 6, valley at index 4
  const channelC = new Float32Array([10, 5, 2, 1, 0, 2, 8, 4, 2, 1, 0]);

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
      timestamp14: "20261020120000",
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
        {
          name: "C",
          label: "Input C",
          derived: false,
          samples: 11,
          deltaT: 1e-6,
          unit: "V",
        },
      ],
    },
  };
}

describe("CursorFeatureJumpSection (issue #314)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;
  let capture: ParsedCapture;

  const openCursorPopover = async (id: "c1" | "c2" = "c1") => {
    await act(async () => {
      const gear = hostElement.querySelector(
        `[data-testid='cursor-gear-${id}']`,
      ) as HTMLButtonElement;
      gear?.click();
      await new Promise((r) => setTimeout(r, 40));
    });
    return document.body.querySelector(
      "[data-testid='badge-config-popover']",
    ) as HTMLElement;
  };

  beforeEach(() => {
    useBadgePopoverStore.getState().setOpen(null);
    window.localStorage.clear();
    useCursorDisplayStore.getState().reset();
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
    useZoomHistoryStore.getState().reset();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
    useChannelNamesStore.setState({ fileKey: null, names: {} });
    useChannelDisplayStore.getState().setStackMode(false);

    capture = createTestCapture();
    useCaptureStore.setState({ capture });

    hostElement = document.createElement("div");
    hostElement.style.width = "1200px";
    hostElement.style.height = "500px";
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);

    act(() => {
      root.render(
        <div>
          <WaveformToolbar />
          <Oscilloscope capture={capture} />
        </div>,
      );
    });
  });

  afterEach(() => {
    useBadgePopoverStore.getState().setOpen(null);
    act(() => {
      root.unmount();
    });
    hostElement.remove();
    window.localStorage.clear();
    useCaptureStore.getState().reset();
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
    useZoomHistoryStore.getState().reset();
  });

  it("WaveformToolbar line 2 contains no feature search elements; FindNavControls and CSS rules removed", () => {
    expect(
      hostElement.querySelector("[data-testid='waveform-find-nav']"),
    ).toBeNull();
    expect(hostElement.querySelector(".waveform-find-nav")).toBeNull();
    expect(hostElement.querySelector(".waveform-find-chip")).toBeNull();
    expect(hostElement.querySelector(".waveform-find-status")).toBeNull();

    // Line 2 has stable buttons
    expect(
      hostElement.querySelector("[data-testid='reset-view-button']"),
    ).not.toBeNull();
    expect(
      hostElement.querySelector("[data-testid='zoom-history-back']"),
    ).not.toBeNull();
    expect(
      hostElement.querySelector("[data-testid='zoom-history-forward']"),
    ).not.toBeNull();
    expect(
      hostElement.querySelector("[data-testid='theme-toggle-button']"),
    ).not.toBeNull();
  });

  it("CursorFeatureJumpSection appears only when Channel source is bound to a specific channel present in capture", async () => {
    // Default binding is "all": section must NOT be rendered
    const c1Popover = await openCursorPopover("c1");
    expect(
      c1Popover.querySelector("[data-testid='cursor-feature-jump-section']"),
    ).toBeNull();

    // Bind C1 to channel A: section appears
    await act(async () => {
      (
        c1Popover.querySelector(
          "[data-testid='setting-binding-a']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(
      c1Popover.querySelector("[data-testid='cursor-feature-jump-section']"),
    ).not.toBeNull();

    // Bind back to "all": section disappears
    await act(async () => {
      (
        c1Popover.querySelector(
          "[data-testid='setting-binding-all']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(
      c1Popover.querySelector("[data-testid='cursor-feature-jump-section']"),
    ).toBeNull();
  });

  it("omits CursorFeatureJumpSection if persisted binding references a channel absent from current capture", async () => {
    // Persist binding to channel "D" which does not exist in createTestCapture() (channels A, B, C)
    useCursorDisplayStore.getState().setBinding("C1", "D");
    const c1Popover = await openCursorPopover("c1");
    expect(
      c1Popover.querySelector("[data-testid='cursor-feature-jump-section']"),
    ).toBeNull();
  });

  it("disables Prev and Next buttons with explanatory label when bound channel is hidden", async () => {
    // Bind C1 to Channel B
    useCursorDisplayStore.getState().setBinding("C1", "B");
    // Hide Channel B from activeChannels
    useViewportStore.setState({ activeChannels: ["A", "C"] });

    const c1Popover = await openCursorPopover("c1");
    const section = c1Popover.querySelector(
      "[data-testid='cursor-feature-jump-section']",
    );
    expect(section).not.toBeNull();

    const prevBtn = section?.querySelector<HTMLButtonElement>(
      "[data-testid='cursor-find-prev-btn']",
    );
    const nextBtn = section?.querySelector<HTMLButtonElement>(
      "[data-testid='cursor-find-next-btn']",
    );
    expect(prevBtn?.disabled).toBe(true);
    expect(nextBtn?.disabled).toBe(true);
    expect(prevBtn?.title).toContain("Channel B is hidden");
    expect(nextBtn?.title).toContain("Channel B is hidden");

    const srStatus = section?.querySelector(
      "[data-testid='cursor-find-status-sr']",
    );
    expect(srStatus?.textContent).toContain("Channel B is hidden");
  });

  it("persists per-cursor feature selection using M3 setting chips in cursorDisplayStore", async () => {
    useCursorDisplayStore.getState().setBinding("C1", "A");
    useCursorDisplayStore.getState().setBinding("C2", "B");

    const c1Popover = await openCursorPopover("c1");
    const peakChip = c1Popover.querySelector<HTMLButtonElement>(
      "[data-testid='setting-feature-peak']",
    );
    expect(peakChip?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      peakChip?.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(useCursorDisplayStore.getState().findFeatures.C1).toBe("peak");
    expect(useCursorDisplayStore.getState().findFeatures.C2).toBe("rising");

    // Close and open C2: C2 remains "rising"
    const c2Popover = await openCursorPopover("c2");
    expect(
      c2Popover
        .querySelector("[data-testid='setting-feature-rising']")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("starts search from viewport center when cursor is inactive and atomically activates it on jump", async () => {
    useCursorDisplayStore.getState().setBinding("C1", "A");
    useCursorDisplayStore.getState().setFindFeature("C1", "rising");

    // Cursor C1 is inactive initially
    expect(useCursorStore.getState().c1Active).toBe(false);

    // Zoomed in on [0, 4us] (center = 2us, index = 2)
    useViewportStore.getState().setBounds({ xMin: 0, xMax: 4e-6 });

    const c1Popover = await openCursorPopover("c1");
    const nextBtn = c1Popover.querySelector<HTMLButtonElement>(
      "[data-testid='cursor-find-next-btn']",
    )!;

    // Next rising edge forward from index 2 on Channel A is at index 6 (timestamp 6e-6)
    await act(async () => {
      nextBtn.click();
      await new Promise((r) => setTimeout(r, 40));
    });

    const cursorState = useCursorStore.getState();
    expect(cursorState.c1Active).toBe(true);
    expect(cursorState.selectedCursor).toBe("C1");
    expect(cursorState.c1SampleIndex).toBe(6);
  });

  it("supports sample-0 auto-activation without clobbering to 25%/75% default", async () => {
    // Channel B has saturated NaNs; put NaN at index 0
    capture.channels[1]!.data[0] = NaN;
    useCursorDisplayStore.getState().setBinding("C1", "B");
    useCursorDisplayStore.getState().setFindFeature("C1", "saturation");

    // Cursor C1 starts inactive; start search from index 2
    useCursorStore.setState({ c1Active: false });
    useViewportStore.getState().setBounds({ xMin: 0, xMax: 4e-6 });

    const c1Popover = await openCursorPopover("c1");
    const prevBtn = c1Popover.querySelector<HTMLButtonElement>(
      "[data-testid='cursor-find-prev-btn']",
    )!;
    expect(prevBtn.disabled).toBe(false);

    await act(async () => {
      prevBtn.click();
      await new Promise((r) => setTimeout(r, 40));
    });

    // Cursor C1 should jump to sample 0 and be activated without 25% default replacement
    expect(useCursorStore.getState().c1Active).toBe(true);
    expect(useCursorStore.getState().c1SampleIndex).toBe(0);
  });

  it("moves only the target cursor when Locked Δt is enabled without sliding partner", async () => {
    useCursorDisplayStore.getState().setBinding("C1", "A");
    useCursorDisplayStore.getState().setFindFeature("C1", "rising");
    useCursorDisplayStore.getState().setDeltaLocked(true);

    useCursorStore.setState({
      c1Active: true,
      c2Active: true,
      selectedCursor: "C1",
      c1SampleIndex: 0,
      c2SampleIndex: 8,
    });

    const c1Popover = await openCursorPopover("c1");
    const nextBtn = c1Popover.querySelector<HTMLButtonElement>(
      "[data-testid='cursor-find-next-btn']",
    )!;

    // Next rising edge from 0 on Channel A is at index 2
    await act(async () => {
      nextBtn.click();
      await new Promise((r) => setTimeout(r, 40));
    });

    // C1 jumped to index 2; C2 must remain at index 8!
    expect(useCursorStore.getState().c1SampleIndex).toBe(2);
    expect(useCursorStore.getState().c2SampleIndex).toBe(8);
  });

  it("centers viewport on found feature when zoomed in, pushes snapshot, and preserves Stack-mode lane bounds on Alt+Left", async () => {
    useCursorDisplayStore.getState().setBinding("C1", "A");
    useCursorDisplayStore.getState().setFindFeature("C1", "rising");
    useChannelDisplayStore.getState().setStackMode(true);

    // Zoomed in on [0, 4us] (span 4us, center 2us)
    const container = hostElement.querySelector(
      "[data-testid='oscilloscope-container']",
    ) as
      | (HTMLElement & {
          __uplot?: import("uplot");
          __preStack?: Map<string, { min: number; max: number }>;
        })
      | null;
    const uplot = container?.__uplot;
    if (uplot) {
      uplot.batch(() => {
        uplot.setScale("x", { min: 0, max: 4e-6 });
      });
      const initialZoomSnapshot = createViewportSnapshot(
        uplot,
        container.__preStack,
      );
      if (initialZoomSnapshot) {
        useZoomHistoryStore.getState().push(initialZoomSnapshot);
      }
    }
    useViewportStore.getState().setBounds({ xMin: 0, xMax: 4e-6 });
    useCursorStore.setState({ c1Active: true, c1SampleIndex: 2 });

    const c1Popover = await openCursorPopover("c1");
    const nextBtn = c1Popover.querySelector<HTMLButtonElement>(
      "[data-testid='cursor-find-next-btn']",
    )!;

    const initialHistoryLength = useZoomHistoryStore.getState().past.length;

    // Jump next: lands on rising edge at index 6 (timestamp 6e-6)
    await act(async () => {
      nextBtn.click();
      await new Promise((r) => setTimeout(r, 40));
    });

    // Center should be 6e-6, span 4e-6 -> [4e-6, 8e-6]
    const bounds = useViewportStore.getState();
    const center = ((bounds.xMin ?? 0) + (bounds.xMax ?? 0)) / 2;
    expect(center).toBeCloseTo(6e-6, 7);
    expect(bounds.xMin).toBeCloseTo(4e-6, 7);
    expect(bounds.xMax).toBeCloseTo(8e-6, 7);

    // Zoom history entry was pushed
    expect(useZoomHistoryStore.getState().past.length).toBeGreaterThan(
      initialHistoryLength,
    );

    // Trigger Alt+Left zoom history restore
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowLeft",
          altKey: true,
          bubbles: true,
        }),
      );
      await new Promise((r) => setTimeout(r, 40));
    });

    // Previous viewport restored
    const restored = useViewportStore.getState();
    expect(restored.xMin).toBeCloseTo(0, 7);
    expect(restored.xMax).toBeCloseTo(4e-6, 7);
  });

  it("leaves viewport unchanged and pushes no redundant history at full-capture view", async () => {
    useCursorDisplayStore.getState().setBinding("C1", "A");
    useCursorDisplayStore.getState().setFindFeature("C1", "rising");
    useCursorStore.setState({ c1Active: true, c1SampleIndex: 0 });

    // Full-capture view: [0, 10us]
    useViewportStore.getState().setBounds({ xMin: 0, xMax: 10e-6 });

    const historyBefore = useZoomHistoryStore.getState().past.length;

    const c1Popover = await openCursorPopover("c1");
    const nextBtn = c1Popover.querySelector<HTMLButtonElement>(
      "[data-testid='cursor-find-next-btn']",
    )!;

    await act(async () => {
      nextBtn.click();
      await new Promise((r) => setTimeout(r, 40));
    });

    // Viewport bounds remain full capture
    expect(useViewportStore.getState().xMin).toBeCloseTo(0, 7);
    expect(useViewportStore.getState().xMax).toBeCloseTo(10e-6, 7);

    // No redundant history entry was pushed
    expect(useZoomHistoryStore.getState().past.length).toBe(historyBefore);
  });

  it("disables Prev/Next when no further feature exists with zero layout shift and polite sr-only announcements", async () => {
    useCursorDisplayStore.getState().setBinding("C1", "A");
    useCursorDisplayStore.getState().setFindFeature("C1", "rising");
    useCursorStore.setState({ c1Active: true, c1SampleIndex: 6 }); // Last rising edge on Channel A

    const c1Popover = await openCursorPopover("c1");
    const prevBtn = c1Popover.querySelector<HTMLButtonElement>(
      "[data-testid='cursor-find-prev-btn']",
    )!;
    const nextBtn = c1Popover.querySelector<HTMLButtonElement>(
      "[data-testid='cursor-find-next-btn']",
    )!;

    // Next is disabled because no rising edge exists after index 6
    expect(nextBtn.disabled).toBe(true);
    expect(prevBtn.disabled).toBe(false);

    // No visible status message element rendered (guaranteeing 0px layout shift)
    expect(c1Popover.querySelector(".waveform-find-status")).toBeNull();

    // sr-only region conveys boundary reason
    const srStatus = c1Popover.querySelector(
      "[data-testid='cursor-find-status-sr']",
    )!;
    expect(srStatus.classList.contains("sr-only")).toBe(true);
    expect(srStatus.getAttribute("aria-live")).toBe("polite");
    expect(srStatus.textContent).toContain(
      "No further rising edge on channel A",
    );

    // Stepper buttons linked via aria-describedby
    expect(nextBtn.getAttribute("aria-describedby")).toBe(srStatus.id);
  });

  it("clears jump announcement when channel binding changes while popover remains open (F2 regression)", async () => {
    useCursorDisplayStore.getState().setBinding("C1", "A");
    useCursorDisplayStore.getState().setFindFeature("C1", "rising");
    useCursorStore.setState({ c1Active: true, c1SampleIndex: 0 });

    const c1Popover = await openCursorPopover("c1");
    const nextBtn = c1Popover.querySelector<HTMLButtonElement>(
      "[data-testid='cursor-find-next-btn']",
    )!;

    // Jump to index 2
    await act(async () => {
      nextBtn.click();
      await new Promise((r) => setTimeout(r, 40));
    });

    const srStatus = c1Popover.querySelector(
      "[data-testid='cursor-find-status-sr']",
    )!;
    expect(srStatus.textContent).toContain("Moved C1 to sample 2");

    // Change binding to Channel C while popover remains open
    await act(async () => {
      (
        c1Popover.querySelector(
          "[data-testid='setting-binding-c']",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 40));
    });

    // Stale "Moved C1 to sample 2" must be cleared and replaced with Channel C's status
    expect(srStatus.textContent).not.toContain("Moved C1 to sample");
    expect(srStatus.textContent).toContain("channel C");
  });

  it("keeps CURSOR_MOVEMENT_SUMMARY and cursor-movement-hint unchanged", async () => {
    const c1Popover = await openCursorPopover("c1");
    const hint = c1Popover.querySelector(
      "[data-testid='cursor-movement-hint']",
    );
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toBe(CURSOR_MOVEMENT_SUMMARY);
  });
});
