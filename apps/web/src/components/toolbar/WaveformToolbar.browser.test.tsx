import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import WaveformToolbar from "./WaveformToolbar";
import "../../index.css";
import { useViewportStore } from "../../state/viewportStore";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useCursorStore } from "../../state/cursorStore";
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
    act(() => {
      root.unmount();
    });
    hostElement.remove();
    useViewportStore.getState().reset();
    useThemeStore.getState().setTheme("dark");
    usePaletteStore.getState().resetPalette();
    window.localStorage.clear();
  });

  it("renders channel badges and the Fit Waveform (100%) action", () => {
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

    const fitButton = hostElement.querySelector(
      "[data-testid='fit-waveform-button']",
    ) as HTMLButtonElement | null;
    expect(fitButton).not.toBeNull();
    expect(fitButton?.textContent).toContain("Fit Waveform (100%)");
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

  it("AC: clicking Fit Waveform triggers onFit callback and resets bounds", () => {
    const onFit = vi.fn();
    act(() => {
      root.render(<WaveformToolbar channels={["A", "B"]} onFit={onFit} />);
    });

    useViewportStore
      .getState()
      .setBounds({ xMin: -0.02, xMax: 0.02, yMin: -1, yMax: 1 });
    expect(useViewportStore.getState().fitRequest).toBe(0);

    const fitButton = hostElement.querySelector(
      "[data-testid='fit-waveform-button']",
    ) as HTMLButtonElement;
    act(() => {
      fitButton.click();
    });

    expect(onFit).toHaveBeenCalledTimes(1);

    const state = useViewportStore.getState();
    expect(state.xMin).toBeNull();
    expect(state.xMax).toBeNull();
    expect(state.yMin).toBeNull();
    expect(state.yMax).toBeNull();
    expect(state.fitRequest).toBe(1);

    // Repeat clicks keep requesting fits (monotonic counter)
    act(() => {
      fitButton.click();
    });
    expect(onFit).toHaveBeenCalledTimes(2);
    expect(useViewportStore.getState().fitRequest).toBe(2);
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
});
