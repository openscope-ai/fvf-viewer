import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import WaveformToolbar from "./WaveformToolbar";
import "../../index.css";
import { useViewportStore } from "../../state/viewportStore";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useCursorStore } from "../../state/cursorStore";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("WaveformToolbar (browser)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

    // Toggle Channel A off
    act(() => {
      badgeA.click();
    });
    expect(useViewportStore.getState().activeChannels.includes("A")).toBe(
      false,
    );
    expect(badgeA.getAttribute("aria-pressed")).toBe("false");
    expect(badgeA.className).not.toContain("waveform-channel-badge--active");
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
    expect(badgeA.className).toContain("waveform-channel-badge--active");
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
    const c1Badge = hostElement.querySelector(
      "[data-testid='cursor-toggle-c1']",
    ) as HTMLButtonElement;
    act(() => {
      useThemeStore.getState().setTheme("light");
    });

    // Issue #75: the leading color dot is gone; identity is carried by the
    // badge's own border/text color. CSSOM normalizes hex to rgb().
    const border = c1Badge.style.borderColor;
    expect(border === "rgb(106, 27, 154)" || border === "#6A1B9A").toBe(true);
  });

  it("AC (Issue #145): Channel B badge uses the visible light default on the dark toolbar", () => {
    act(() => {
      root.render(<WaveformToolbar channels={["A", "B"]} />);
    });
    act(() => {
      useThemeStore.getState().setTheme("light");
    });
    // B is active but not selected, so the badge text carries the
    // theme default directly on the dark toolbar chrome.
    const badgeB = hostElement.querySelector(
      "[data-testid='channel-badge-B']",
    ) as HTMLButtonElement;
    expect(badgeB).not.toBeNull();
    expect(badgeB.style.color).toBe("rgb(30, 144, 255)");
    // Regression: the old navy default was invisible here.
    expect(badgeB.style.color).not.toBe("rgb(0, 0, 139)");
  });

  it("AC (#75): badges are centered pills without leading dots or trailing stars", () => {
    act(() => {
      root.render(<WaveformToolbar channels={["A"]} />);
    });
    act(() => {
      useCursorStore.getState().toggleCursor("C1", 1000);
    });

    for (const testId of ["channel-badge-A", "cursor-toggle-c1"]) {
      const badge = hostElement.querySelector(
        `[data-testid='${testId}']`,
      ) as HTMLButtonElement;
      expect(badge).not.toBeNull();
      // No dot/star elements remain (issue #75)
      expect(badge.querySelector(".waveform-channel-badge-dot")).toBeNull();
      expect(
        badge.querySelector(".waveform-cursor-selected-indicator"),
      ).toBeNull();
      expect(badge.textContent).not.toContain("★");
      // Centered typographic pill
      const style = window.getComputedStyle(badge);
      expect(style.justifyContent).toBe("center");
      expect(style.minWidth).toBe("38px");
      expect(style.paddingLeft).toBe(style.paddingRight);
    }

    // No phantom gap: the inactive channel badge (dot removed) keeps a
    // single centered text node.
    const badgeA = hostElement.querySelector(
      "[data-testid='channel-badge-A']",
    ) as HTMLButtonElement;
    expect(badgeA.textContent).toBe("A");

    // AC2/AC3 across states: measure while active, toggle off, re-measure —
    // the pill geometry must not shift when the dot is absent.
    const assertCentered = (badge: HTMLButtonElement) => {
      const style = window.getComputedStyle(badge);
      expect(style.justifyContent).toBe("center");
      expect(style.minWidth).toBe("38px");
      expect(style.paddingLeft).toBe(style.paddingRight);
    };
    const c1AfterToggle = hostElement.querySelector(
      "[data-testid='cursor-toggle-c1']",
    ) as HTMLButtonElement;
    assertCentered(c1AfterToggle);
    act(() => {
      useCursorStore.getState().toggleCursor("C1", 1000);
    });
    const c1Inactive = hostElement.querySelector(
      "[data-testid='cursor-toggle-c1']",
    ) as HTMLButtonElement;
    expect(c1Inactive.style.borderColor).toBe("");
    assertCentered(c1Inactive);
    expect(c1Inactive.textContent).toBe("C1");

    // AC5: selected cursor keeps fill/text/glow signifiers (no star).
    act(() => {
      useCursorStore.getState().toggleCursor("C2", 1000);
      useCursorStore.getState().selectCursor("C2");
    });
    const c2Selected = hostElement.querySelector(
      "[data-testid='cursor-toggle-c2']",
    ) as HTMLButtonElement;
    expect(c2Selected.style.backgroundColor).not.toBe("");
    // CSSOM normalizes hex colors to rgb(); accept both serializations
    expect(
      c2Selected.style.color === "rgb(255, 255, 255)" ||
        c2Selected.style.color === "#ffffff",
    ).toBe(true);
    expect(c2Selected.style.boxShadow).not.toBe("");
    expect(c2Selected.textContent).toBe("C2");
    assertCentered(c2Selected);
  });

  it("AC1 (#40): palette settings panel toggles and badge colors follow overrides", () => {
    act(() => {
      root.render(<WaveformToolbar channels={["A"]} />);
    });

    const settingsButton = hostElement.querySelector(
      "[data-testid='palette-settings-button']",
    ) as HTMLButtonElement;
    expect(settingsButton).not.toBeNull();
    expect(settingsButton.getAttribute("aria-expanded")).toBe("false");
    expect(
      hostElement.querySelector("[data-testid='palette-settings-panel']"),
    ).toBeNull();

    act(() => {
      settingsButton.click();
    });
    expect(settingsButton.getAttribute("aria-expanded")).toBe("true");
    expect(
      hostElement.querySelector("[data-testid='palette-settings-panel']"),
    ).not.toBeNull();

    // Channel A badge border/text reflect a custom override immediately
    // (issue #75: no leading dot; the badge itself carries the color)
    act(() => {
      usePaletteStore.getState().setCustomColor("A", "#123456");
    });
    const badgeA = hostElement.querySelector(
      "[data-testid='channel-badge-A']",
    ) as HTMLElement;
    const badgeBorder = badgeA.style.borderColor;
    expect(
      badgeBorder === "rgb(18, 52, 86)" || badgeBorder === "#123456",
      `unexpected badge border color: ${badgeBorder}`,
    ).toBe(true);

    // Reset to Default Palette removes the override
    act(() => {
      (
        hostElement.querySelector(
          "[data-testid='palette-reset-all']",
        ) as HTMLButtonElement
      ).click();
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
