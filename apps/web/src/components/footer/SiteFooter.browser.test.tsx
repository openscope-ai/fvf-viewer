import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "../../App";
import { SITE_DISCLAIMER } from "./disclaimer";
import { useCaptureStore } from "../../state/captureStore";
import fourChUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeMediaQueryList {
  matches: boolean;
  dispatch(matches: boolean): void;
}

function installFakeMatchMedia(initialMatches: boolean): FakeMediaQueryList {
  type ChangeListener = (event: { matches: boolean }) => void;
  const listeners = new Set<ChangeListener>();
  const state = { matches: initialMatches };
  const mediaQuery: Record<string, unknown> = {
    get matches() {
      return state.matches;
    },
    media: "(max-width: 1023px)",
    onchange: null,
    addEventListener(type: string, listener: ChangeListener) {
      if (type === "change") listeners.add(listener);
    },
    removeEventListener(type: string, listener: ChangeListener) {
      if (type === "change") listeners.delete(listener);
    },
    dispatch(matches: boolean) {
      state.matches = matches;
      for (const listener of [...listeners]) listener({ matches });
    },
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mediaQuery as unknown as MediaQueryList),
  );
  return mediaQuery as unknown as FakeMediaQueryList;
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

describe("SiteFooter (browser, issue #19)", () => {
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
    useCaptureStore.getState().reset();
    vi.unstubAllGlobals();
  });

  it("renders the approved disclaimer verbatim on the app view", async () => {
    installFakeMatchMedia(false); // wide (desktop) view

    await act(async () => {
      root.render(<App />);
    });

    const footer = hostElement.querySelector("[data-testid='site-footer']");
    expect(footer).not.toBeNull();
    const rendered = footer?.querySelector(
      ".site-footer-disclaimer",
    )?.textContent;
    expect(rendered).toBe(SITE_DISCLAIMER);
    // Anchored to the approved overview §4.3 wording (first line checks).
    expect(SITE_DISCLAIMER).toBe(
      "FVF Viewer is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Fluke Corporation. Fluke and ScopeMeter are registered trademarks of Fluke Corporation.",
    );
  });

  it("appears on every app view and stays visible behind the roadblock", async () => {
    const mediaQuery = installFakeMatchMedia(true); // narrow → roadblock view

    await act(async () => {
      root.render(<App />);
    });

    // Roadblock view: compact footer rendered inside the overlay dialog.
    const overlay = hostElement.querySelector(
      "[data-testid='desktop-roadblock']",
    );
    expect(overlay).not.toBeNull();
    const overlayFooter = overlay?.querySelector("[data-testid='site-footer']");
    expect(overlayFooter).not.toBeNull();
    expect(
      overlayFooter?.querySelector(".site-footer-disclaimer")?.textContent,
    ).toBe(SITE_DISCLAIMER);
    expect(overlayFooter?.className).toContain("site-footer--compact");

    // Crossing to the desktop view: the page-level footer renders.
    await act(async () => {
      mediaQuery.dispatch(false);
    });
    const shell = hostElement.querySelector("main.shell");
    expect(shell).not.toBeNull();
    const pageFooter = shell?.parentElement?.querySelector(
      ":scope > [data-testid='site-footer']",
    );
    expect(pageFooter).not.toBeNull();
    expect(
      pageFooter?.querySelector(".site-footer-disclaimer")?.textContent,
    ).toBe(SITE_DISCLAIMER);

    // And back to the roadblock view again.
    await act(async () => {
      mediaQuery.dispatch(true);
    });
    expect(
      hostElement
        .querySelector("[data-testid='desktop-roadblock']")
        ?.querySelector("[data-testid='site-footer']"),
    ).not.toBeNull();
  });

  it("stays visible and non-overlapping with a capture loaded (F1/F2 regression)", async () => {
    installFakeMatchMedia(false); // wide desktop view

    await useCaptureStore
      .getState()
      .parseBuffer(await (await fetch(fourChUrl)).arrayBuffer(), "four.fvf");
    expect(useCaptureStore.getState().capture).not.toBeNull();

    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    const footer = hostElement.querySelector(
      "[data-testid='site-footer']",
    ) as HTMLElement;
    expect(footer).not.toBeNull();
    expect(footer.checkVisibility()).toBe(true);
    const footerRect = footer.getBoundingClientRect();
    expect(footerRect.height).toBeGreaterThan(0);
    // Visible inside the frame: the footer sits at the bottom edge.
    const frame = hostElement.querySelector(".app-frame") as HTMLElement;
    const frameRect = frame.getBoundingClientRect();
    expect(Math.abs(footerRect.bottom - frameRect.bottom)).toBeLessThanOrEqual(
      2,
    );

    // Geometry: nothing opaque covers the footer (F1 regression).
    const scope = hostElement.querySelector(".oscilloscope-container");
    expect(scope).not.toBeNull();
    expect(overlaps(footerRect, scope!.getBoundingClientRect())).toBe(false);
    const ingestion = hostElement.querySelector(".ingestion-container");
    expect(overlaps(footerRect, ingestion!.getBoundingClientRect())).toBe(
      false,
    );

    // Same guarantee on the empty-state view.
    await act(async () => {
      useCaptureStore.getState().reset();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const hero = hostElement.querySelector(".hero-dropzone");
    expect(hero).not.toBeNull();
    const footerRect2 = (
      hostElement.querySelector("[data-testid='site-footer']") as HTMLElement
    ).getBoundingClientRect();
    expect(overlaps(footerRect2, hero!.getBoundingClientRect())).toBe(false);
  });
});
