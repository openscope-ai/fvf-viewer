import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "../../App";
import { useCaptureStore } from "../../state/captureStore";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SHARE_BUTTON_LABEL = "Share Link to Desktop";
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

  it("keeps app state alive across crossings and never dismisses via Escape or backdrop click", async () => {
    installFakeMatchMedia(true); // narrow viewport (1023px)

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
