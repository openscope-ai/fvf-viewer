import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import WaveformToolbar from "./WaveformToolbar";
import "../../index.css";
import { useViewportStore } from "../../state/viewportStore";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useCursorStore } from "../../state/cursorStore";
import { useChannelDisplayStore } from "../../state/channelDisplayStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import { useMeasurementsStore } from "../../state/measurementsStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useBadgePopoverStore } from "./badgeConfig/anchoredPopover";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("WaveformToolbar (browser)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;

  // Issue #204: badges are compound groups; the body button keeps the
  // legacy data-testid while active/selected classes moved to the group.
  const badgeGroup = (testId: string): HTMLElement =>
    hostElement.querySelector(`[data-testid='${testId}']`)!.parentElement!;

  beforeEach(() => {
    useBadgePopoverStore.getState().setOpen(null);
    useViewportStore.getState().reset();
    useCursorStore.getState().reset();
    useChannelDisplayStore.getState().reset();
    useReferenceStore.getState().clear();
    window.localStorage.clear();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
    hostElement = document.createElement("div");
    hostElement.style.width = "900px";
    hostElement.style.height = "80px";
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
  });

  afterEach(() => {
    useBadgePopoverStore.getState().setOpen(null);
    useCursorStore.getState().reset();
    useChannelDisplayStore.getState().reset();
    useReferenceStore.getState().clear();
    act(() => {
      root.unmount();
    });
    hostElement.remove();
    useViewportStore.getState().reset();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
    window.localStorage.clear();
  });

  it("renders channel badges and the Reset View action", () => {
    act(() => {
      root.render(<WaveformToolbar channels={["A", "B", "C", "D"]} />);
    });

    const toolbar = hostElement.querySelector(
      "[data-testid='waveform-toolbar']",
    );
    expect(toolbar).not.toBeNull();
    expect(toolbar?.getAttribute("role")).toBe("toolbar");

    for (const name of ["A", "B", "C", "D"]) {
      const badge = hostElement.querySelector(
        `[data-testid='channel-badge-${name}']`,
      ) as HTMLButtonElement | null;
      expect(badge, `badge for channel ${name}`).not.toBeNull();
      expect(badge?.getAttribute("aria-pressed")).toBe("true");
    }

    const resetButton = hostElement.querySelector(
      "[data-testid='reset-view-button']",
    ) as HTMLButtonElement | null;
    expect(resetButton).not.toBeNull();
    expect(resetButton?.textContent).toContain("Reset View");
    expect(resetButton?.getAttribute("aria-label")).toContain("Reset View");
    expect(resetButton?.getAttribute("title")).toContain("Reset View");
  });

  it("AC: clicking channel badges toggles active state in viewport store", () => {
    act(() => {
      root.render(<WaveformToolbar channels={["A", "B", "C", "D"]} />);
    });

    // Explicit bounds: toggling channels must never touch them (stable scale)
    useViewportStore
      .getState()
      .setBounds({ xMin: -0.5, xMax: 0.5, yMin: -8, yMax: 8 });

    const badgeA = hostElement.querySelector(
      "[data-testid='channel-badge-A']",
    ) as HTMLButtonElement;
    expect(badgeA.getAttribute("aria-pressed")).toBe("true");

    const groupA = badgeGroup("channel-badge-A");
    expect(groupA.className).toContain("waveform-channel-badge--active");

    // Toggle Channel A off
    act(() => {
      badgeA.click();
    });
    expect(useViewportStore.getState().activeChannels.includes("A")).toBe(
      false,
    );
    expect(badgeA.getAttribute("aria-pressed")).toBe("false");
    expect(groupA.className).not.toContain("waveform-channel-badge--active");
    expect(useViewportStore.getState().activeChannels).toEqual(["B", "C", "D"]);

    // Toggling must not mutate the axis bounds
    const bounds = useViewportStore.getState();
    expect(bounds.xMin).toBe(-0.5);
    expect(bounds.xMax).toBe(0.5);
    expect(bounds.yMin).toBe(-8);
    expect(bounds.yMax).toBe(8);

    // Toggle Channel A back on
    act(() => {
      badgeA.click();
    });
    expect(useViewportStore.getState().activeChannels.includes("A")).toBe(true);
    expect(badgeA.getAttribute("aria-pressed")).toBe("true");
    expect(badgeGroup("channel-badge-A").className).toContain(
      "waveform-channel-badge--active",
    );
  });

  it("AC (#248): clicking Reset View triggers onResetView, clears every display transform, zeroes the File 2 slip, and resets bounds", () => {
    const onResetView = vi.fn();
    act(() => {
      root.render(
        <WaveformToolbar channels={["A", "B"]} onResetView={onResetView} />,
      );
    });

    // Dirty state: transforms on a visible, a hidden, and a reference
    // channel, a live File 2 slip, and a zoomed viewport.
    useViewportStore.getState().setActiveChannels(["A"]);
    useChannelDisplayStore.getState().setYScale("A", 200);
    useChannelDisplayStore.getState().setOffset("B", 3);
    useChannelDisplayStore.getState().setInverted("Ref-A", true);
    useReferenceStore.setState({
      capture: { channels: [] } as never,
      timeSlipSamples: 4.5,
    });
    useViewportStore
      .getState()
      .setBounds({ xMin: -0.02, xMax: 0.02, yMin: -1, yMax: 1 });
    expect(useViewportStore.getState().fitRequest).toBe(0);

    const resetButton = hostElement.querySelector(
      "[data-testid='reset-view-button']",
    ) as HTMLButtonElement;
    act(() => {
      resetButton.click();
    });

    expect(onResetView).toHaveBeenCalledTimes(1);

    // Every display transform — visible, hidden, reference — is gone.
    expect(useChannelDisplayStore.getState().keyConfigs).toEqual({});
    // The File 2 time slip is zeroed while a comparison is active.
    expect(useReferenceStore.getState().timeSlipSamples).toBe(0);

    const state = useViewportStore.getState();
    expect(state.xMin).toBeNull();
    expect(state.xMax).toBeNull();
    expect(state.yMin).toBeNull();
    expect(state.yMax).toBeNull();
    expect(state.fitRequest).toBe(1);

    // Repeat clicks keep requesting fits (monotonic counter) and stay
    // idempotent on the already-default transforms.
    act(() => {
      resetButton.click();
    });
    expect(onResetView).toHaveBeenCalledTimes(2);
    expect(useViewportStore.getState().fitRequest).toBe(2);
    expect(useChannelDisplayStore.getState().keyConfigs).toEqual({});
  });

  it("AC (#248): without an active comparison Reset View leaves the slip channel alone", () => {
    act(() => {
      root.render(<WaveformToolbar channels={["A"]} />);
    });
    expect(useReferenceStore.getState().capture).toBeNull();

    const resetButton = hostElement.querySelector(
      "[data-testid='reset-view-button']",
    ) as HTMLButtonElement;
    act(() => {
      resetButton.click();
    });

    // No File 2 capture -> the slip store is never touched (it would
    // already be reset by the comparison teardown paths).
    expect(useViewportStore.getState().fitRequest).toBe(1);
  });

  it("AC (#38): the theme toggle button switches between Dark OLED and Light theme", () => {
    act(() => {
      root.render(<WaveformToolbar channels={["A"]} />);
    });

    const themeButton = hostElement.querySelector(
      "[data-testid='theme-toggle-button']",
    ) as HTMLButtonElement;
    expect(themeButton).not.toBeNull();
    expect(useThemeStore.getState().theme).toBe("dark");
    expect(themeButton.getAttribute("aria-label")).toBe(
      "Toggle viewport theme (currently dark)",
    );
    expect(themeButton.textContent).toContain("Light Theme");

    act(() => {
      themeButton.click();
    });
    expect(useThemeStore.getState().theme).toBe("light");
    expect(themeButton.getAttribute("aria-label")).toBe(
      "Toggle viewport theme (currently light)",
    );
    expect(themeButton.textContent).toContain("Dark Theme");

    act(() => {
      themeButton.click();
    });
    expect(useThemeStore.getState().theme).toBe("dark");
  });

  it("AC (#38): cursor badge colors follow the active theme", () => {
    act(() => {
      root.render(<WaveformToolbar channels={["A"]} />);
    });

    // Issue #75: color is carried by the badge itself, which is styled only
    // while active — activate C1 to observe the theme-following color.
    act(() => {
      useCursorStore.getState().toggleCursor("C1", 1000);
    });
    act(() => {
      useThemeStore.getState().setTheme("light");
    });

    // Issue #204: identity is carried by the tonal capsule's --badge-color
    // custom property (mixed into the fill via color-mix in CSS).
    const group = badgeGroup("cursor-toggle-c1");
    expect(group.style.getPropertyValue("--badge-color")).toBe("#6A1B9A");
    expect(group.className).toContain("waveform-cursor-badge--active");
  });

  it("AC (Issue #145): Channel B badge uses the visible light default on the dark toolbar", () => {
    act(() => {
      root.render(<WaveformToolbar channels={["A", "B"]} />);
    });
    act(() => {
      useThemeStore.getState().setTheme("light");
    });
    // B is active but not selected; the effective identity color feeds
    // the tonal fill through the group's --badge-color property.
    const badgeB = hostElement.querySelector(
      "[data-testid='channel-badge-B']",
    ) as HTMLButtonElement;
    expect(badgeB).not.toBeNull();
    const groupB = badgeGroup("channel-badge-B");
    expect(groupB.style.getPropertyValue("--badge-color")).toBe("#1E90FF");
    // Regression: the old navy default was invisible here.
    expect(groupB.style.getPropertyValue("--badge-color")).not.toBe("#00008B");
  });

  it("AC (#204): badges are compound tonal capsules with body + gear targets", () => {
    act(() => {
      root.render(<WaveformToolbar channels={["A"]} />);
    });
    act(() => {
      useCursorStore.getState().toggleCursor("C1", 1000);
    });

    for (const [bodyId, groupId, label] of [
      ["channel-badge-A", "channel-badge-group-A", "Channel A"],
      ["cursor-toggle-c1", "cursor-badge-group-c1", "Cursor C1"],
    ] as const) {
      const body = hostElement.querySelector(
        `[data-testid='${bodyId}']`,
      ) as HTMLButtonElement;
      const group = hostElement.querySelector(
        `[data-testid='${groupId}']`,
      ) as HTMLElement;
      expect(body).not.toBeNull();
      expect(group).not.toBeNull();

      // Compound group: role=group with body + gear sibling buttons.
      expect(group.getAttribute("role")).toBe("group");
      expect(group.getAttribute("aria-label")).toBe(label);
      expect(body.className).toBe(
        bodyId.startsWith("channel-")
          ? "waveform-channel-badge-body"
          : "waveform-cursor-badge-body",
      );
      const gear = group.querySelector(
        `[data-testid='${bodyId.startsWith("channel-") ? "channel-gear" : "cursor-gear"}-${
          bodyId.startsWith("channel-") ? "A" : "c1"
        }']`,
      ) as HTMLButtonElement;
      expect(gear).not.toBeNull();
      expect(gear.className).toBe(
        bodyId.startsWith("channel-")
          ? "waveform-channel-badge-gear"
          : "waveform-cursor-badge-gear",
      );
      expect(gear.getAttribute("aria-haspopup")).toBe("dialog");
      expect(gear.getAttribute("aria-expanded")).toBe("false");

      // No dot/star elements remain (issue #75); body is a centered
      // typographic pill carrying exactly the label.
      expect(body.querySelector(".waveform-channel-badge-dot")).toBeNull();
      expect(
        body.querySelector(".waveform-cursor-selected-indicator"),
      ).toBeNull();
      expect(body.textContent).not.toContain("★");
      const style = window.getComputedStyle(body);
      expect(style.justifyContent).toBe("center");
      expect(body.textContent).toBe(bodyId.startsWith("channel-") ? "A" : "C1");
    }

    // Body still owns the toggle cycle (aria-pressed) and the cursor body
    // keeps its movement-controls tooltip (issue #133).
    const c1Body = hostElement.querySelector(
      "[data-testid='cursor-toggle-c1']",
    ) as HTMLButtonElement;
    expect(c1Body.getAttribute("aria-pressed")).toBe("true");
    expect(c1Body.title).toContain("Ctrl+Drag or Ctrl+Click to move");
    act(() => {
      useCursorStore.getState().toggleCursor("C1", 1000);
    });
    expect(c1Body.getAttribute("aria-pressed")).toBe("false");
    expect(badgeGroup("cursor-toggle-c1").className).not.toContain(
      "waveform-cursor-badge--active",
    );
  });

  it("issue #228: M3 split-action chips — 8px radius, divider, 48px hit targets, unified active/inactive paradigm", async () => {
    act(() => {
      root.render(<WaveformToolbar channels={["A", "B"]} />);
    });

    const groupA = badgeGroup("channel-badge-A");
    const bodyA = hostElement.querySelector(
      "[data-testid='channel-badge-A']",
    ) as HTMLButtonElement;
    const gearA = hostElement.querySelector(
      "[data-testid='channel-gear-A']",
    ) as HTMLButtonElement;
    const dividerA = groupA.querySelector(
      ".badge-split-divider",
    ) as HTMLElement;

    // M3 chip geometry: standard 8px radius (not a pill) on a ~32px
    // visible container.
    const groupStyle = window.getComputedStyle(groupA);
    expect(groupStyle.borderRadius).toBe("8px");
    expect(groupA.offsetHeight).toBe(32);

    // Split-action layout: a 1px divider at ~12% outline alpha separates
    // the two non-overlapping hit zones.
    expect(dividerA).not.toBeNull();
    const dividerStyle = window.getComputedStyle(dividerA);
    expect(dividerStyle.width).toBe("1px");
    expect(dividerStyle.backgroundColor).toBe("rgba(255, 255, 255, 0.12)");
    expect(dividerA.previousElementSibling).toBe(bodyA);
    expect(dividerA.nextElementSibling).toBe(gearA);

    // Both hit targets meet the 48x48 minimum via transparent bounds on
    // the 32px chip.
    expect(bodyA.offsetHeight).toBeGreaterThanOrEqual(48);
    expect(bodyA.offsetWidth).toBeGreaterThanOrEqual(48);
    expect(gearA.offsetHeight).toBeGreaterThanOrEqual(48);
    expect(gearA.offsetWidth).toBeGreaterThanOrEqual(48);

    // Independent M3 state layers exist per zone (8% hover / 12% press
    // overlays on the visible chip band).
    const bodyLayer = window.getComputedStyle(bodyA, "::before");
    const gearLayer = window.getComputedStyle(gearA, "::before");
    expect(bodyLayer.content).not.toBe("none");
    expect(gearLayer.content).not.toBe("none");
    expect(bodyLayer.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(gearLayer.backgroundColor).toBe("rgb(255, 255, 255)");

    // Unified active paradigm (visible channels start active):
    // surfaceContainerHigh + accent stroke; channel A is also the
    // selected channel, so its label stays white on the stronger 1.5px
    // ring by design.
    expect(groupA.className).toContain("waveform-channel-badge--active");
    expect(groupStyle.backgroundColor).toBe("rgb(42, 42, 42)");
    expect(window.getComputedStyle(bodyA).color).toBe("rgb(255, 255, 255)");
    expect(window.getComputedStyle(groupA).boxShadow).toContain(
      "rgb(255, 215, 0)",
    );

    // An active, unselected channel tints its label with the trace color
    // and lifts the gear to onSurfaceVariant (WCAG AA).
    const groupB = badgeGroup("channel-badge-B");
    const bodyB = hostElement.querySelector(
      "[data-testid='channel-badge-B']",
    ) as HTMLButtonElement;
    const gearB = hostElement.querySelector(
      "[data-testid='channel-gear-B']",
    ) as HTMLButtonElement;
    expect(groupB.className).toContain("waveform-channel-badge--active");
    expect(groupB.className).not.toContain("waveform-channel-badge--selected");
    expect(window.getComputedStyle(bodyB).color).toBe("rgb(0, 191, 255)");
    expect(window.getComputedStyle(gearB).color).toBe("rgb(196, 199, 197)");

    // Unified inactive paradigm: surfaceContainerLow + subtle outline,
    // label and gear dimmed to ~38% — identical for every badge (no
    // mixed outline/solid styles). (The body's first click selects a
    // visible channel, so hide B through the visibility store here.)
    await act(async () => {
      useViewportStore.setState({
        activeChannels: ["A"],
        selectedChannel: "A",
      });
      // The container eases its background/box-shadow over 200ms — let
      // the transition settle before reading computed values.
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    expect(groupB.className).not.toContain("--active");
    expect(groupB.className).not.toContain("--selected");
    expect(window.getComputedStyle(groupB).backgroundColor).toBe(
      "rgb(26, 26, 26)",
    );
    expect(window.getComputedStyle(bodyB).color).toBe(
      "rgba(255, 255, 255, 0.38)",
    );
    expect(window.getComputedStyle(gearB).color).toBe(
      "rgba(255, 255, 255, 0.38)",
    );

    // Cursor badges share the same chrome (cursor C1).
    await act(async () => {
      useCursorStore.getState().toggleCursor("C1", 1000);
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    const cursorGroup = badgeGroup("cursor-toggle-c1");
    expect(window.getComputedStyle(cursorGroup).borderRadius).toBe("8px");
    expect(cursorGroup.offsetHeight).toBe(32);
    expect(cursorGroup.className).toContain("waveform-cursor-badge--active");
    expect(window.getComputedStyle(cursorGroup).backgroundColor).toBe(
      "rgb(42, 42, 42)",
    );

    // AC6: the established behaviors survive on the new chrome — the
    // body cycle (selected + clicked → hidden) and the gear opens the
    // popover.
    expect(bodyA.getAttribute("aria-pressed")).toBe("true");
    act(() => {
      bodyA.click();
    });
    expect(bodyA.getAttribute("aria-pressed")).toBe("false");
    act(() => {
      gearA.click();
    });
    expect(gearA.getAttribute("aria-expanded")).toBe("true");
    // The popover renders through a portal into document.body.
    expect(
      document.body.querySelector("[data-testid='badge-config-popover']"),
    ).not.toBeNull();
  });

  it("AC (#204): gear opens the config popover; retired Colors panel is gone; badge colors follow overrides", () => {
    act(() => {
      root.render(<WaveformToolbar channels={["A"]} />);
    });

    // The standalone Colors button is retired with PaletteSettings.
    expect(
      hostElement.querySelector("[data-testid='palette-settings-button']"),
    ).toBeNull();

    const gear = hostElement.querySelector(
      "[data-testid='channel-gear-A']",
    ) as HTMLButtonElement;
    expect(gear.getAttribute("aria-expanded")).toBe("false");
    expect(
      document.body.querySelector("[data-testid='badge-config-popover']"),
    ).toBeNull();

    act(() => {
      gear.click();
    });
    expect(gear.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.body.querySelector("[data-testid='badge-config-popover']"),
    ).not.toBeNull();

    // Channel A badge identity reflects a custom override immediately
    // (tonal fill mixes from --badge-color).
    act(() => {
      usePaletteStore.getState().setCustomColor("A", "#123456");
    });
    const groupA = badgeGroup("channel-badge-A");
    expect(groupA.style.getPropertyValue("--badge-color")).toBe("#123456");

    // Per-key opacity feeds the same identity pipeline (100 = default).
    act(() => {
      usePaletteStore.getState().setKeyOpacity("A", 40);
    });
    expect(usePaletteStore.getState().keyConfigs.A).toEqual({
      color: "#123456",
      opacity: 40,
    });

    // Per-key ↺ removes the whole record (the global reset-all button is
    // gone; per-key reset covers the need).
    act(() => {
      usePaletteStore.getState().resetKey("A");
    });
    expect(usePaletteStore.getState().customColors).toEqual({});
  });

  it("AC4 (Issue #133): cursor toggle buttons include movement controls in their title tooltips", () => {
    act(() => {
      root.render(<WaveformToolbar channels={["A"]} />);
    });

    const btnC1 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c1']",
    ) as HTMLButtonElement;
    const btnC2 = hostElement.querySelector(
      "[data-testid='cursor-toggle-c2']",
    ) as HTMLButtonElement;

    expect(btnC1).not.toBeNull();
    expect(btnC1.title).toContain("Toggle cursor C1");
    expect(btnC1.title).toContain("Ctrl+Drag or Ctrl+Click to move");
    expect(btnC1.title).toContain("Ctrl+Wheel or Ctrl+Arrow keys to step");

    expect(btnC2).not.toBeNull();
    expect(btnC2.title).toContain("Toggle cursor C2");
    expect(btnC2.title).toContain("Ctrl+Drag or Ctrl+Click to move");
    expect(btnC2.title).toContain("Ctrl+Wheel or Ctrl+Arrow keys to step");
  });

  it("issue #334 (AC1-AC5): when long custom channel names cause action buttons to wrap, wrapped lines stay grouped with consistent 12px gaps, centered on their line at any viewport width, and clickable", async () => {
    await page.viewport(1920, 900);
    hostElement.style.height = "auto";
    useChannelNamesStore.getState().setFileKey("wrap-test.fvf::20261029120000");

    // 1. Short/default channel names on a wide desktop viewport (1920px): single-line layout (AC4)
    hostElement.style.width = "1920px";
    act(() => {
      root.render(<WaveformToolbar channels={["A", "B", "C", "D"]} />);
    });

    const toolbar = hostElement.querySelector(
      "[data-testid='waveform-toolbar']",
    ) as HTMLElement;
    const actionsGroup = hostElement.querySelector(
      "[data-testid='waveform-toolbar-actions']",
    ) as HTMLElement;
    expect(actionsGroup).not.toBeNull();
    expect(window.getComputedStyle(toolbar).justifyContent).toBe(
      "space-between",
    );
    expect(window.getComputedStyle(actionsGroup).justifyContent).toBe("center");

    const actionItems = Array.from(actionsGroup.children) as HTMLElement[];
    expect(actionItems.length).toBe(6);

    const channelsGroup = hostElement.querySelector(
      ".waveform-toolbar-channels",
    ) as HTMLElement;
    const cursorsGroup = hostElement.querySelector(
      "[data-testid='waveform-toolbar-cursors']",
    ) as HTMLElement;
    const unwrappedGroupRects = [channelsGroup, cursorsGroup, actionsGroup].map(
      (el) => el.getBoundingClientRect(),
    );
    const unwrappedFirstCenterY =
      (unwrappedGroupRects[0]!.top + unwrappedGroupRects[0]!.bottom) / 2;
    for (const r of unwrappedGroupRects) {
      const centerY = (r.top + r.bottom) / 2;
      expect(Math.abs(centerY - unwrappedFirstCenterY)).toBeLessThanOrEqual(4);
    }
    const unwrappedActionRects = actionItems.map((el) =>
      el.getBoundingClientRect(),
    );
    // Consecutive gaps inside the action buttons group on the unwrapped single line are uniform (~12px)
    for (let i = 1; i < unwrappedActionRects.length; i += 1) {
      const gap =
        unwrappedActionRects[i]!.left - unwrappedActionRects[i - 1]!.right;
      expect(gap).toBeGreaterThanOrEqual(10);
      expect(gap).toBeLessThanOrEqual(14);
    }

    // 2. Long custom channel names causing action buttons to wrap across multiple viewport widths (AC1, AC2, AC3)
    act(() => {
      useChannelNamesStore.getState().setName("A", "PrimaryGridPhaseAVoltage");
      useChannelNamesStore.getState().setName("B", "PrimaryGridPhaseBVoltage");
      useChannelNamesStore.getState().setName("C", "PrimaryGridPhaseCVoltage");
      useChannelNamesStore.getState().setName("D", "NeutralReturnCurrentSense");
    });

    for (const width of [1920, 1600, 1440, 1280, 1100, 960, 820]) {
      await page.viewport(width, 900);
      hostElement.style.width = `${width}px`;
      const toolbarRect = toolbar.getBoundingClientRect();
      const channelsRect = channelsGroup.getBoundingClientRect();
      const actionsRect = actionsGroup.getBoundingClientRect();

      // At these widths with 4 x 24-char custom channel names, the action buttons group wraps below channels
      expect(
        actionsRect.top,
        `expected action buttons to wrap below channels at width ${width}px`,
      ).toBeGreaterThanOrEqual(channelsRect.bottom);

      const itemRects = actionItems.map((el) => el.getBoundingClientRect());

      // Group action buttons into wrapped lines by vertical center proximity
      const lines: DOMRect[][] = [];
      for (const rect of itemRects) {
        const cy = (rect.top + rect.bottom) / 2;
        const existingLine = lines.find((line) => {
          const lineCy = (line[0]!.top + line[0]!.bottom) / 2;
          return Math.abs(cy - lineCy) <= 10;
        });
        if (existingLine) {
          existingLine.push(rect);
        } else {
          lines.push([rect]);
        }
      }

      for (const line of lines) {
        // AC1: Adjacent action buttons on the same wrapped line have consistent 12px gap (never space-between stretched)
        for (let i = 1; i < line.length; i += 1) {
          const gap = line[i]!.left - line[i - 1]!.right;
          expect(
            gap,
            `gap between action buttons on wrapped line at width ${width}px`,
          ).toBeGreaterThanOrEqual(10);
          expect(
            gap,
            `gap between action buttons on wrapped line at width ${width}px`,
          ).toBeLessThanOrEqual(14);
        }

        // AC2: When the action buttons group occupies its wrapped line, each line of action buttons is centered on its line
        const cursorsRect = cursorsGroup.getBoundingClientRect();
        const sharesLineWithCursors =
          Math.abs(
            (cursorsRect.top + cursorsRect.bottom) / 2 -
              (line[0]!.top + line[0]!.bottom) / 2,
          ) <= 10;
        if (!sharesLineWithCursors) {
          const lineLeft = line[0]!.left - toolbarRect.left;
          const lineRight = toolbarRect.right - line[line.length - 1]!.right;
          expect(
            Math.abs(lineLeft - lineRight),
            `centering of wrapped action button line at width ${width}px (left=${lineLeft}, right=${lineRight})`,
          ).toBeLessThanOrEqual(2);
        }
      }
    }

    // 3. AC5: All action buttons remain fully visible and clickable in the wrapped state
    const stackBtn = hostElement.querySelector(
      "[data-testid='stack-mode-stack']",
    ) as HTMLButtonElement;
    const resetBtn = hostElement.querySelector(
      "[data-testid='reset-view-button']",
    ) as HTMLButtonElement;
    const themeBtn = hostElement.querySelector(
      "[data-testid='theme-toggle-button']",
    ) as HTMLButtonElement;
    const measBtn = hostElement.querySelector(
      "[data-testid='measurements-toggle-button']",
    ) as HTMLButtonElement;
    const csvBtn = hostElement.querySelector(
      "[data-testid='csv-export-button']",
    ) as HTMLButtonElement;
    const pngBtn = hostElement.querySelector(
      "[data-testid='png-export-button']",
    ) as HTMLButtonElement;

    for (const btn of [stackBtn, resetBtn, themeBtn, measBtn, csvBtn, pngBtn]) {
      expect(btn).not.toBeNull();
      const rect = btn.getBoundingClientRect();
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
    }

    act(() => {
      stackBtn.click();
    });
    expect(useChannelDisplayStore.getState().stackMode).toBe(true);

    act(() => {
      themeBtn.click();
    });
    expect(useThemeStore.getState().theme).toBe("light");

    act(() => {
      measBtn.click();
    });
    expect(useMeasurementsStore.getState().isOpen).toBe(true);
    act(() => {
      measBtn.click();
    });
    expect(useMeasurementsStore.getState().isOpen).toBe(false);

    useChannelNamesStore.getState().setFileKey(null);
  });
});
