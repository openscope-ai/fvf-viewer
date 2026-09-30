import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import fourChUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import twoChMinUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-2ch-10000-1min-div.fvf.bin?url";
import { useCaptureStore } from "../../state/captureStore";
import App from "../../App";
import "../../index.css";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function fetchFixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching fixture ${url}`).toBe(true);
  return response.arrayBuffer();
}

async function createFixtureFile(url: string, fileName: string): Promise<File> {
  const buffer = await fetchFixture(url);
  return new File([buffer], fileName);
}

function simulateDrop(target: Element, file: File): void {
  const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(dropEvent, "dataTransfer", {
    value: {
      files: [file],
    },
  });
  target.dispatchEvent(dropEvent);
}

function simulateDragEnter(target: Element): void {
  const event = new Event("dragenter", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { dropEffect: "copy" },
  });
  target.dispatchEvent(event);
}

async function waitForStoreCondition(
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for store predicate");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function flushRaf(): Promise<void> {
  await new Promise((resolve) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setTimeout(resolve, 80);
      }),
    ),
  );
}

async function dropFileAndWait(
  target: Element,
  file: File,
  condition: () => boolean,
): Promise<void> {
  await act(async () => {
    simulateDrop(target, file);
    await waitForStoreCondition(condition);
    await flushRaf();
  });
}

describe("FileIngestion browser integration (production ingestion path)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useCaptureStore.getState().reset();
    hostElement = document.createElement("div");
    hostElement.style.width = "1000px";
    hostElement.style.height = "700px";
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flushRaf();
    });
    hostElement.remove();
    useCaptureStore.getState().reset();
  });

  it("empty-state hero drop zone: loads capture via parse worker, collapses hero, renders banner and oscilloscope", async () => {
    await act(async () => {
      root.render(<App />);
    });

    const hero = hostElement.querySelector("[data-testid='hero-dropzone']");
    expect(hero).not.toBeNull();
    expect(hostElement.querySelector(".metadata-banner")).toBeNull();
    expect(hostElement.querySelector(".oscilloscope-container")).toBeNull();

    const file = await createFixtureFile(fourChUrl, "test-4ch.fvf");

    await dropFileAndWait(
      hero!,
      file,
      () => useCaptureStore.getState().parseState === "success",
    );

    // Hero has collapsed
    expect(
      hostElement.querySelector("[data-testid='hero-dropzone']"),
    ).toBeNull();

    // Banner and oscilloscope are now rendered
    const banner = hostElement.querySelector(".metadata-banner");
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("test-4ch.fvf");
    expect(banner?.textContent).toContain("4 channels");

    const osc = hostElement.querySelector(".oscilloscope-container");
    expect(osc).not.toBeNull();
  });

  it("issue #208: clicking the banner lockup discards the capture and returns to a clean landing page without confirmation", async () => {
    await act(async () => {
      root.render(<App />);
    });

    // Load a capture through the real ingestion path.
    const hero = hostElement.querySelector("[data-testid='hero-dropzone']");
    const file = await createFixtureFile(fourChUrl, "return-to-landing.fvf");
    await dropFileAndWait(
      hero!,
      file,
      () => useCaptureStore.getState().parseState === "success",
    );
    expect(hostElement.querySelector(".metadata-banner")).not.toBeNull();

    // Clicking the shared brand lockup in the banner returns to the landing
    // (file-drop) page immediately — no confirmation step.
    const lockup = hostElement.querySelector(
      "[data-testid='brand-lockup']",
    ) as HTMLButtonElement;
    expect(lockup).not.toBeNull();
    expect(lockup.tagName).toBe("BUTTON");

    await act(async () => {
      lockup.click();
      await flushRaf();
    });

    // Clean drop page: banner and oscilloscope gone, hero back, store empty.
    expect(hostElement.querySelector(".metadata-banner")).toBeNull();
    expect(hostElement.querySelector(".oscilloscope-container")).toBeNull();
    expect(
      hostElement.querySelector("[data-testid='hero-dropzone']"),
    ).not.toBeNull();
    expect(
      hostElement.querySelector("[data-testid='drop-header']"),
    ).not.toBeNull();
    expect(useCaptureStore.getState().capture).toBeNull();
    expect(useCaptureStore.getState().parseState).toBe("idle");
  });

  it("native file picker: asserts accept='.fvf', hero activation, and banner 'Open file…' button", async () => {
    await act(async () => {
      root.render(<App />);
    });

    const input = hostElement.querySelector(
      "[data-testid='file-picker-input']",
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.getAttribute("accept")).toBe(".fvf");

    // Hero activation via click triggers file input
    const inputClickSpy = vi.spyOn(input, "click");
    const hero = hostElement.querySelector(
      "[data-testid='hero-dropzone']",
    ) as HTMLElement;

    await act(async () => {
      hero.click();
    });
    expect(inputClickSpy).toHaveBeenCalledTimes(1);

    // Hero keyboard activation (Enter key)
    await act(async () => {
      hero.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(inputClickSpy).toHaveBeenCalledTimes(2);

    // Hero keyboard activation (Space key)
    await act(async () => {
      hero.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true }),
      );
    });
    expect(inputClickSpy).toHaveBeenCalledTimes(3);

    // Simulate selecting a file via native file input change event
    const file = await createFixtureFile(twoChMinUrl, "picker-loaded.fvf");
    await act(async () => {
      Object.defineProperty(input, "files", {
        value: [file],
        writable: true,
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await waitForStoreCondition(
        () => useCaptureStore.getState().parseState === "success",
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    // Verify loaded capture
    const banner = hostElement.querySelector(".metadata-banner");
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("picker-loaded.fvf");
    expect(banner?.textContent).toContain("2 channels");

    // Test banner 'Open file…' button triggers input.click()
    const openBtn = hostElement.querySelector(
      ".banner-open-btn",
    ) as HTMLButtonElement;
    expect(openBtn).not.toBeNull();

    await act(async () => {
      openBtn.click();
    });
    expect(inputClickSpy).toHaveBeenCalledTimes(4);
  });

  it("Capture Replacement (double-drop): shows replacement overlay and replaces capture on drop", async () => {
    const file1 = await createFixtureFile(fourChUrl, "first-capture.fvf");
    const file2 = await createFixtureFile(twoChMinUrl, "second-capture.fvf");

    await act(async () => {
      root.render(<App />);
    });

    const container = hostElement.querySelector(
      "[data-testid='ingestion-container']",
    ) as HTMLElement;

    // First drop: 4ch fixture
    await dropFileAndWait(
      container,
      file1,
      () => useCaptureStore.getState().parseState === "success",
    );

    expect(
      hostElement.querySelector(".metadata-banner")?.textContent,
    ).toContain("4 channels");

    // Drag over shell: overlay appears
    await act(async () => {
      simulateDragEnter(container);
      await flushRaf();
    });

    const overlay = hostElement.querySelector(
      "[data-testid='shell-drop-overlay']",
    );
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("Drop to replace capture");

    // Second drop: 2ch fixture replaces capture
    await dropFileAndWait(
      container,
      file2,
      () =>
        useCaptureStore.getState().parseState === "success" &&
        useCaptureStore.getState().fileName === "second-capture.fvf",
    );

    // Overlay is gone, banner reflects second capture
    expect(
      hostElement.querySelector("[data-testid='shell-drop-overlay']"),
    ).toBeNull();
    const updatedBanner = hostElement.querySelector(".metadata-banner");
    expect(updatedBanner?.textContent).toContain("second-capture.fvf");
    expect(updatedBanner?.textContent).toContain("2 channels");
  });

  it("stale-parse ticket guard: rapid double-drop guarantees the newest drop wins", async () => {
    await act(async () => {
      root.render(<App />);
    });

    const container = hostElement.querySelector(
      "[data-testid='ingestion-container']",
    ) as HTMLElement;

    const fileSlow = await createFixtureFile(twoChMinUrl, "slow.fvf");
    const fileFast = await createFixtureFile(fourChUrl, "fast.fvf");

    // Rapid double drop: dispatch two drops in immediate succession
    await act(async () => {
      simulateDrop(container, fileSlow);
      simulateDrop(container, fileFast);
      await waitForStoreCondition(
        () =>
          useCaptureStore.getState().parseState === "success" &&
          useCaptureStore.getState().fileName === "fast.fvf",
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    // Verify only the newest capture landed
    const state = useCaptureStore.getState();
    expect(state.fileName).toBe("fast.fvf");
    expect(state.capture?.channels.length).toBe(4);
    expect(
      hostElement.querySelector(".metadata-banner")?.textContent,
    ).toContain("fast.fvf");
    expect(
      hostElement.querySelector(".metadata-banner")?.textContent,
    ).toContain("4 channels");
  });

  it("issue #210: sample CTA shows the filled yellow rotated hand icon and a persistently underlined, still-muted label", async () => {
    await act(async () => {
      root.render(<App />);
    });

    const sampleButton = hostElement.querySelector(
      "[data-testid='hero-sample-button']",
    ) as HTMLButtonElement;
    expect(sampleButton.textContent).toBe(
      "Test fvf • viewer with a 100k sample synthetic capture",
    );

    // Filled yellow hand icon before the text, rotated 90° clockwise
    // (finger pointing at the text). Issue #217 sizes it to 1.25em of the
    // CTA label's font-size; the muted tertiary treatment is unchanged.
    const icon = sampleButton.querySelector(".hero-sample-icon") as SVGElement;
    expect(icon).not.toBeNull();
    const iconStyle = window.getComputedStyle(icon);
    expect(iconStyle.color).toBe("rgb(252, 198, 3)");
    expect(iconStyle.transform).toBe("matrix(0, 1, -1, 0, 0, 0)");
    const iconRect = icon.getBoundingClientRect();
    const buttonStyle = window.getComputedStyle(sampleButton);
    expect(iconRect.height).toBeCloseTo(
      parseFloat(buttonStyle.fontSize) * 1.25,
      0,
    );

    // Persistent underline with the current offset; muted font/color/size
    // unchanged (tertiary to the drop zone).
    const label = sampleButton.querySelector(
      ".hero-sample-label",
    ) as HTMLElement;
    const labelStyle = window.getComputedStyle(label);
    expect(labelStyle.textDecorationLine).toContain("underline");
    expect(labelStyle.textUnderlineOffset).toBe("3px");
    expect(labelStyle.color).toBe("rgb(122, 122, 122)");
    expect(parseFloat(labelStyle.fontSize)).toBeCloseTo(
      parseFloat(buttonStyle.fontSize),
      1,
    );
    expect(labelStyle.fontWeight).toBe("400");
  });

  it("issue #217: hand glyph is ~25% larger than the label font and stays vertically centered with it", async () => {
    await act(async () => {
      root.render(<App />);
    });

    const sampleButton = hostElement.querySelector(
      "[data-testid='hero-sample-button']",
    ) as HTMLButtonElement;
    const icon = sampleButton.querySelector(".hero-sample-icon") as SVGElement;
    const label = sampleButton.querySelector(
      ".hero-sample-label",
    ) as HTMLElement;

    // Relative size: 1.25em of the CTA label's font-size (~25% larger than
    // the original 1em font-height sizing).
    const fontSize = parseFloat(window.getComputedStyle(sampleButton).fontSize);
    const iconRect = icon.getBoundingClientRect();
    expect(iconRect.width).toBeCloseTo(fontSize * 1.25, 0);
    expect(iconRect.height).toBeCloseTo(fontSize * 1.25, 0);

    // Vertical alignment comes from the CTA's flex centering: the glyph's
    // vertical center sits on the label's (rotation preserves the center).
    const labelRect = label.getBoundingClientRect();
    const centerDelta = Math.abs(
      iconRect.top +
        iconRect.height / 2 -
        (labelRect.top + labelRect.height / 2),
    );
    expect(centerDelta).toBeLessThanOrEqual(1.5);

    // Still tertiary to the drop zone: muted color, regular weight, and
    // the persistent underline are unchanged.
    const labelStyle = window.getComputedStyle(label);
    expect(labelStyle.color).toBe("rgb(122, 122, 122)");
    expect(labelStyle.fontWeight).toBe("400");
    expect(labelStyle.textDecorationLine).toContain("underline");
  });

  it("issue #193: hero sample control loads the shipped sample through the production parse path", async () => {
    await act(async () => {
      root.render(<App />);
    });

    const sampleButton = hostElement.querySelector(
      "[data-testid='hero-sample-button']",
    ) as HTMLButtonElement;
    expect(sampleButton).not.toBeNull();
    expect(sampleButton.textContent).toBe(
      "Test fvf • viewer with a 100k sample synthetic capture",
    );

    // Activation stays local: neither click nor keyboard activation of the
    // sample control may open the native file picker.
    const input = hostElement.querySelector(
      "[data-testid='file-picker-input']",
    ) as HTMLInputElement;
    const inputClickSpy = vi.spyOn(input, "click");

    await act(async () => {
      sampleButton.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(inputClickSpy).not.toHaveBeenCalled();

    await act(async () => {
      sampleButton.click();
      await waitForStoreCondition(
        () =>
          useCaptureStore.getState().parseState === "success" &&
          useCaptureStore.getState().fileName === "fvf-sample.fvf",
      );
      await flushRaf();
    });
    expect(inputClickSpy).not.toHaveBeenCalled();

    // Loaded exactly like an uploaded capture: hero collapsed, banner shows
    // the sample file name and the full four-channel showcase structure.
    expect(
      hostElement.querySelector("[data-testid='hero-dropzone']"),
    ).toBeNull();
    const banner = hostElement.querySelector(".metadata-banner");
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("fvf-sample.fvf");
    expect(banner?.textContent).toContain("4 channels");

    const state = useCaptureStore.getState();
    expect(state.capture?.warnings ?? []).toEqual([]);
    // Showcase structure survives the worker boundary: four physical
    // channels with the mixed V/A unit scales from the sample spec.
    expect(state.capture?.channels.map((channel) => channel.name)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(state.capture?.metadata.channels.map((info) => info.unit)).toEqual([
      "V",
      "A",
      "V",
      "V",
    ]);
    expect(state.capture?.metadata.channels[0]?.samples).toBe(100_000);
    expect(hostElement.querySelector(".oscilloscope-container")).not.toBeNull();
  });

  it("issue #142: drop page renders brand header, animated hero logo, privacy notice, and no Fluke badge", async () => {
    await act(async () => {
      root.render(<App />);
    });

    // Brand header: logo + wordmark upper left, icon-only GitHub link upper right
    const header = hostElement.querySelector("[data-testid='drop-header']");
    expect(header).not.toBeNull();
    expect(
      header?.querySelector(".brand-lockup-logo")?.getAttribute("src"),
    ).toBe("/logo.svg");
    const brand = header?.querySelector(".brand-text");
    expect(brand?.textContent).toBe("fvf • viewer");
    expect(brand?.className).toContain("brand-text");

    const github = header?.querySelector(
      "[data-testid='drop-header-github']",
    ) as HTMLAnchorElement;
    expect(github).not.toBeNull();
    expect(github.getAttribute("href")).toBe(
      "https://github.com/openscope-ai/fvf-viewer",
    );
    expect(github.getAttribute("target")).toBe("_blank");
    expect(github.getAttribute("rel")).toContain("noopener");
    expect(github.getAttribute("rel")).toContain("noreferrer");
    expect(github.getAttribute("aria-label")).toBe("GitHub repository");
    // Icon-only: no text label, just the SVG glyph
    expect((github.textContent ?? "").trim()).toBe("");
    expect(github.querySelector("svg.github-icon")).not.toBeNull();

    // Issue #207: the GitHub icon unifies at ~28px on the landing page too.
    const landingIcon = github.querySelector(
      "svg.github-icon",
    ) as SVGSVGElement;
    const landingIconRect = landingIcon.getBoundingClientRect();
    expect(landingIconRect.width).toBeCloseTo(28, 0);
    expect(landingIconRect.height).toBeCloseTo(28, 0);

    // GitHub badge two-tone (issue #181): white-filled circle, black cat.
    const githubPaths = (
      github.querySelector("svg.github-icon") as SVGSVGElement
    ).querySelectorAll("path");
    expect(githubPaths.length).toBe(3);
    const circle = githubPaths[0]!;
    expect(circle.getAttribute("fill")).toBe("#ffffff");
    expect(circle.getAttribute("stroke")).toBeNull();
    for (const catPath of [githubPaths[1]!, githubPaths[2]!]) {
      expect(catPath.getAttribute("stroke")).toBe("#000000");
    }

    // Animated hero logo replaces the legacy graphic
    const heroLogo = hostElement.querySelector(
      "[data-testid='hero-logo']",
    ) as HTMLImageElement;
    expect(heroLogo).not.toBeNull();
    expect(heroLogo.getAttribute("src")).toBe("/logo-animated.svg");
    const size = heroLogo.getBoundingClientRect().width;
    expect(size).toBeGreaterThanOrEqual(80);
    expect(size).toBeLessThanOrEqual(88);

    // Local-processing notice present
    expect(
      hostElement.querySelector("[data-testid='hero-privacy']")?.textContent,
    ).toContain("locally in your browser");

    // Fluke product reference removed from the drop surface (footer keeps the
    // legal disclaimer)
    const hero = hostElement.querySelector("[data-testid='hero-dropzone']");
    expect(hero?.textContent).not.toContain("Fluke ScopeMeter");
    expect(hostElement.querySelector(".hero-badge")).toBeNull();
  });

  it("issue #142: brand header disappears once a capture is loaded", async () => {
    await act(async () => {
      root.render(<App />);
    });
    expect(
      hostElement.querySelector("[data-testid='drop-header']"),
    ).not.toBeNull();

    const file = await createFixtureFile(fourChUrl, "branded.fvf");
    const hero = hostElement.querySelector("[data-testid='hero-dropzone']")!;
    await dropFileAndWait(
      hero,
      file,
      () => useCaptureStore.getState().parseState === "success",
    );

    expect(hostElement.querySelector("[data-testid='drop-header']")).toBeNull();
    expect(hostElement.querySelector(".metadata-banner")).not.toBeNull();
  });

  it("production ingestion path renders without import.meta.env.DEV gating", async () => {
    await act(async () => {
      root.render(<App />);
    });

    // Ingestion container and hero dropzone are present unconditionally
    expect(
      hostElement.querySelector("[data-testid='ingestion-container']"),
    ).not.toBeNull();
    expect(
      hostElement.querySelector("[data-testid='hero-dropzone']"),
    ).not.toBeNull();

    // Dev harness element is permanently absent
    expect(hostElement.querySelector(".dev-harness")).toBeNull();
  });
});
