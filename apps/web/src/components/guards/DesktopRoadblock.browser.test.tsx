import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "../../App";
import { detectSharePlatform } from "./DesktopRoadblock";
import { useCaptureStore } from "../../state/captureStore";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SHARE_BUTTON_LABEL = "Share";
const LINK_COPIED_LABEL = "Link Copied ✓";
const SHARE_TEXT =
  "Open FVF Viewer on your desktop — precision waveform analysis";

interface FakeMediaQueryList {
  matches: boolean;
  dispatch(matches: boolean): void;
  queryCalls: string[];
}

function installFakeMatchMedia(initialMatches: boolean): FakeMediaQueryList {
  type ChangeListener = (event: { matches: boolean }) => void;
  const listeners = new Set<ChangeListener>();
  const state = { matches: initialMatches };
  const queryCalls: string[] = [];
  const fakeQuery = "(max-width: 1023px)";
  const mediaQuery: Record<string, unknown> = {
    get matches() {
      return state.matches;
    },
    media: fakeQuery,
    onchange: null,
    addListener(listener: ChangeListener) {
      listeners.add(listener);
    },
    removeListener(listener: ChangeListener) {
      listeners.delete(listener);
    },
    addEventListener(type: string, listener: ChangeListener) {
      queryCalls.push(`add:${type}`);
      if (type === "change") listeners.add(listener);
    },
    removeEventListener(type: string, listener: ChangeListener) {
      queryCalls.push(`remove:${type}`);
      if (type === "change") listeners.delete(listener);
    },
    dispatch(matches: boolean) {
      state.matches = matches;
      for (const listener of [...listeners]) listener({ matches });
    },
  };
  const matchMedia = vi.fn((query: string) => {
    queryCalls.push(query);
    return mediaQuery as unknown as MediaQueryList;
  });
  vi.stubGlobal("matchMedia", matchMedia);
  return mediaQuery as unknown as FakeMediaQueryList;
}

function patchNavigator(prop: "share" | "clipboard", value: unknown): void {
  Object.defineProperty(window.navigator, prop, {
    value,
    configurable: true,
    writable: true,
  });
}

function unpatchNavigator(prop: "share" | "clipboard"): void {
  delete (window.navigator as unknown as Record<string, unknown>)[prop];
}

describe("DesktopRoadblock browser integration (issue #16)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useCaptureStore.getState().reset();
    hostElement = document.createElement("div");
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    hostElement.remove();
    unpatchNavigator("share");
    unpatchNavigator("clipboard");
    vi.unstubAllGlobals();
    vi.useRealTimers();
    useCaptureStore.getState().reset();
  });

  it("at 1023px shows the overlay with inert shell; at 1024px renders none; live crossing keeps the app mounted", async () => {
    const mediaQuery = installFakeMatchMedia(false); // wide viewport (>= 1024px)

    await act(async () => {
      root.render(<App />);
    });

    // 1024px (wide): no overlay in the DOM at all
    expect(
      hostElement.querySelector("[data-testid='desktop-roadblock']"),
    ).toBeNull();
    const shell = hostElement.querySelector("main.shell");
    expect(shell).not.toBeNull();
    expect((shell as HTMLElement).inert).toBe(false);

    // Live crossing to 1023px without reload: overlay appears, shell inert
    await act(async () => {
      mediaQuery.dispatch(true);
    });
    const overlay = hostElement.querySelector(
      "[data-testid='desktop-roadblock']",
    );
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute("role")).toBe("dialog");
    expect(overlay?.getAttribute("aria-modal")).toBe("true");
    expect(shell?.hasAttribute("inert")).toBe(true);

    // Overlay is a sibling of <main> — not inert itself
    expect(overlay?.closest("main")).toBeNull();

    // Crossing back to 1024px: overlay removed, inert lifted, same shell element
    await act(async () => {
      mediaQuery.dispatch(false);
    });
    expect(
      hostElement.querySelector("[data-testid='desktop-roadblock']"),
    ).toBeNull();
    expect(shell?.hasAttribute("inert")).toBe(false);
    expect(hostElement.querySelector("main.shell")).toBe(shell);
  });

  it("renders the #179 layout: brand lockup above the title, new copy, Share + icon, no disclaimer", async () => {
    installFakeMatchMedia(true); // narrow viewport (< 1024px)

    await act(async () => {
      root.render(<App />);
    });

    const overlay = hostElement.querySelector(
      "[data-testid='desktop-roadblock']",
    ) as HTMLElement;

    // README-style brand header (issue #191): logo on top, the app name
    // directly below in a large font — the dialog heading. The former
    // "Desktop Required" title is gone entirely.
    expect(overlay.textContent).not.toContain("Desktop Required");
    const brand = overlay.querySelector("[data-testid='roadblock-brand']");
    expect(brand).not.toBeNull();
    const logo = brand?.querySelector("img.roadblock-brand-logo");
    expect(logo).not.toBeNull();
    const name = overlay.querySelector("h1.roadblock-brand-name");
    expect(name?.textContent?.replace(/\s+/g, " ")).toBe("fvf • viewer");
    expect(
      (logo as HTMLElement).compareDocumentPosition(name as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The dialog's accessible name comes from the app-name heading.
    const labelledBy = overlay.getAttribute("aria-labelledby");
    expect(labelledBy).toBe("desktop-roadblock-title");
    expect(document.getElementById(labelledBy!)).toBe(name);
    expect(name?.className).toContain("roadblock-brand-name");

    // Approved #179 copy.
    expect(overlay.querySelector(".roadblock-message")?.textContent).toBe(
      "This app is designed for multi-channel waveform analysis on wide screens.",
    );
    expect(overlay.querySelector(".roadblock-hint")?.textContent).toBe(
      "Open this page on a screen wider than 1024px, or try rotating your device.",
    );

    // Share button: "Share" text preceded by a share icon glyph.
    const shareButton = overlay.querySelector(
      "[data-testid='desktop-roadblock-share']",
    ) as HTMLButtonElement;
    expect(shareButton.textContent?.replace(/\s+/g, " ").trim()).toBe("Share");
    const icon = shareButton.querySelector("svg.share-icon");
    expect(icon).not.toBeNull();
    // The icon glyph precedes the label text node.
    const labelSpan = shareButton.querySelector("span");
    expect(labelSpan?.textContent).toBe("Share");
    expect(
      icon!.compareDocumentPosition(labelSpan as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The bottom disclaimer is not part of the narrow layout (#179).
    expect(overlay.querySelector("[data-testid='site-footer']")).toBeNull();
    expect(overlay.textContent).not.toContain("Fluke");
  });

  it("detects the platform to pick the share icon glyph (iOS vs others)", () => {
    // iPhone/iPad/iPod user agents pick share-ios…
    expect(
      detectSharePlatform({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      }),
    ).toBe("ios");
    expect(
      detectSharePlatform({ userAgent: "Mozilla/5.0 (iPad; CPU OS 16_6)" }),
    ).toBe("ios");
    // …including iPadOS desktop-mode Macintosh UAs with touch points.
    expect(
      detectSharePlatform({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        maxTouchPoints: 5,
      }),
    ).toBe("ios");
    // Android and everyone else (desktops) pick share-android.
    expect(
      detectSharePlatform({
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130",
      }),
    ).toBe("android");
    expect(
      detectSharePlatform({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130",
        maxTouchPoints: 0,
      }),
    ).toBe("other");
    expect(
      detectSharePlatform({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        maxTouchPoints: 0,
      }),
    ).toBe("other");
    // A desktop Chromium test runner reports the android glyph by default.
    expect(["android", "other"]).toContain(detectSharePlatform());
  });

  it("keeps app state alive across crossings and never dismisses via Escape or backdrop click", async () => {
    installFakeMatchMedia(true); // narrow viewport (< 1024px)

    await act(async () => {
      root.render(<App />);
    });

    const shell = hostElement.querySelector("main.shell");
    const overlayBefore = hostElement.querySelector(
      "[data-testid='desktop-roadblock']",
    );
    expect(overlayBefore).not.toBeNull();

    // Escape key: non-dismissable (no handler)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(hostElement.querySelector("[data-testid='desktop-roadblock']")).toBe(
      overlayBefore,
    );

    // Backdrop click: non-dismissable (no close control exists either)
    await act(async () => {
      (overlayBefore as HTMLElement).click();
    });
    expect(hostElement.querySelector("[data-testid='desktop-roadblock']")).toBe(
      overlayBefore,
    );
    expect(hostElement.querySelector(".roadblock-close")).toBeNull();

    // No reload happened: the same <main> instance persists, app state intact
    expect(hostElement.querySelector("main.shell")).toBe(shell);
    expect(useCaptureStore.getState().parseState).toBe("idle");
  });

  it("moves focus to the share button on appear and restores prior focus on disappear", async () => {
    const mediaQuery = installFakeMatchMedia(false);

    await act(async () => {
      root.render(<App />);
    });

    const shell = hostElement.querySelector("main.shell") as HTMLElement;
    await act(async () => {
      shell.focus();
    });
    expect(document.activeElement).toBe(shell);

    await act(async () => {
      mediaQuery.dispatch(true);
    });
    const shareButton = hostElement.querySelector(
      "[data-testid='desktop-roadblock-share']",
    );
    expect(shareButton).not.toBeNull();
    expect(document.activeElement).toBe(shareButton);

    await act(async () => {
      mediaQuery.dispatch(false);
    });
    expect(document.activeElement).toBe(shell);
  });

  it("falls back to main.shell focus when only <body> held focus before the overlay (F1 regression)", async () => {
    const mediaQuery = installFakeMatchMedia(false);

    await act(async () => {
      root.render(<App />);
    });
    expect(document.activeElement).toBe(document.body);

    await act(async () => {
      mediaQuery.dispatch(true);
    });
    const shareButton = hostElement.querySelector(
      "[data-testid='desktop-roadblock-share']",
    );
    expect(document.activeElement).toBe(shareButton);

    await act(async () => {
      mediaQuery.dispatch(false);
    });
    expect(document.activeElement).toBe(
      hostElement.querySelector("main.shell"),
    );
  });

  it("invokes navigator.share with the { title, text, url } payload on supporting browsers", async () => {
    installFakeMatchMedia(true);
    const shareStub = vi.fn(() => Promise.resolve());
    patchNavigator("share", shareStub);

    await act(async () => {
      root.render(<App />);
    });

    const shareButton = hostElement.querySelector(
      "[data-testid='desktop-roadblock-share']",
    ) as HTMLButtonElement;
    expect(shareButton.textContent).toBe(SHARE_BUTTON_LABEL);

    await act(async () => {
      shareButton.click();
    });

    expect(shareStub).toHaveBeenCalledTimes(1);
    expect(shareStub).toHaveBeenCalledWith({
      title: "FVF Viewer",
      text: SHARE_TEXT,
      url: window.location.href,
    });
    // The OS share sheet is the feedback — no copied morph, no manual URL
    expect(shareButton.textContent).toBe(SHARE_BUTTON_LABEL);
    expect(
      hostElement.querySelector("[data-testid='desktop-roadblock-url']"),
    ).toBeNull();
  });

  it("treats share sheet dismissal (AbortError) as a silent no-op", async () => {
    installFakeMatchMedia(true);
    const shareStub = vi.fn(() =>
      Promise.reject(new DOMException("dismissed", "AbortError")),
    );
    const writeText = vi.fn(() => Promise.resolve());
    patchNavigator("share", shareStub);
    patchNavigator("clipboard", { writeText });

    await act(async () => {
      root.render(<App />);
    });
    const shareButton = hostElement.querySelector(
      "[data-testid='desktop-roadblock-share']",
    ) as HTMLButtonElement;

    await act(async () => {
      shareButton.click();
    });

    expect(shareStub).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(shareButton.textContent).toBe(SHARE_BUTTON_LABEL);
    expect(
      hostElement.querySelector("[data-testid='desktop-roadblock-url']"),
    ).toBeNull();
  });

  it("falls back to clipboard when share is unavailable: morphs to 'Link Copied' for 2s with an aria-live announcement", async () => {
    installFakeMatchMedia(true);
    const writeText = vi.fn(() => Promise.resolve());
    patchNavigator("share", undefined);
    patchNavigator("clipboard", { writeText });

    await act(async () => {
      root.render(<App />);
    });
    const shareButton = hostElement.querySelector(
      "[data-testid='desktop-roadblock-share']",
    ) as HTMLButtonElement;
    const liveRegion = hostElement.querySelector(
      "[role='status'][aria-live='polite']",
    );
    expect(liveRegion).not.toBeNull();

    vi.useFakeTimers();
    try {
      await act(async () => {
        shareButton.click();
      });

      expect(writeText).toHaveBeenCalledWith(window.location.href);
      expect(shareButton.textContent).toBe(LINK_COPIED_LABEL);
      expect(liveRegion?.textContent).toContain("Link copied to clipboard");

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(shareButton.textContent).toBe(SHARE_BUTTON_LABEL);
      expect(
        hostElement.querySelector("[data-testid='desktop-roadblock-url']"),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to clipboard when share rejects with a non-abort error", async () => {
    installFakeMatchMedia(true);
    const shareStub = vi.fn(() =>
      Promise.reject(new DOMException("denied", "NotAllowedError")),
    );
    const writeText = vi.fn(() => Promise.resolve());
    patchNavigator("share", shareStub);
    patchNavigator("clipboard", { writeText });

    await act(async () => {
      root.render(<App />);
    });
    const shareButton = hostElement.querySelector(
      "[data-testid='desktop-roadblock-share']",
    ) as HTMLButtonElement;

    await act(async () => {
      shareButton.click();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(shareButton.textContent).toBe(LINK_COPIED_LABEL);
  });

  it("reveals the URL as selectable text when clipboard also fails", async () => {
    installFakeMatchMedia(true);
    patchNavigator("share", undefined);
    patchNavigator("clipboard", {
      writeText: vi.fn(() =>
        Promise.reject(new DOMException("denied", "NotAllowedError")),
      ),
    });

    await act(async () => {
      root.render(<App />);
    });
    const shareButton = hostElement.querySelector(
      "[data-testid='desktop-roadblock-share']",
    ) as HTMLButtonElement;

    await act(async () => {
      shareButton.click();
    });

    const manualUrl = hostElement.querySelector(
      "[data-testid='desktop-roadblock-url']",
    );
    expect(manualUrl).not.toBeNull();
    expect(manualUrl?.textContent).toBe(window.location.href);
    expect(manualUrl?.className).toContain("roadblock-url");
    expect(hostElement.textContent).toContain("copy it manually");
  });
});
