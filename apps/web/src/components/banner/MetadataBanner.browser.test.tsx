import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseCaptureBuffer } from "../../workers/workerClient";
import MetadataBanner from "./MetadataBanner";
import { DropPageHeader } from "../ingestion/FileIngestion";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import "../../index.css";

import fourChUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin?url";
import deOneChUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-de-eingang-1ch-3000-comma-decimal.fvf.bin?url";
import twoChMinUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-2ch-10000-1min-div.fvf.bin?url";
import nonSeqAbdUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/nonsequential-abd-3ch-10000-20ms-div.fvf.bin?url";
import derivedMathUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/derived-mathematik-2ch-3000-10ms-div.fvf.bin?url";
import mixedCurrentUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/accepted-en-2ch-current-offcenter-1s-div.fvf.bin?url";
import env500Url from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/extreme-envelope-4ch-500-10ms-div.fvf.bin?url";
import env250kUrl from "../../../../../crates/fvf-wasm/tests/fixtures/synthetic/extreme-envelope-1ch-250000-10ms-div.fvf.bin?url";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function fetchFixture(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  expect(response.ok, `fetching fixture ${url}`).toBe(true);
  return response.arrayBuffer();
}

describe("MetadataBanner browser integration (real worker round-trip)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    hostElement = document.createElement("div");
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
  });

  afterEach(() => {
    act(() => {
      useChannelNamesStore.getState().clearName("A");
      root.unmount();
    });
    hostElement.remove();
  });

  it("issue #239: '+ Compare' renders beside 'Open file…' with identical chrome and fires onCompareFile", async () => {
    const buffer = await fetchFixture(fourChUrl);
    const capture = await parseCaptureBuffer(buffer);
    const onCompareFile = vi.fn();

    await act(async () => {
      root.render(
        <MetadataBanner
          capture={capture}
          fileName="four-channel.fvf"
          onOpenFile={() => {}}
          onCompareFile={onCompareFile}
        />,
      );
    });

    const openButton = hostElement.querySelector(
      ".banner-open-btn",
    ) as HTMLButtonElement;
    const compareButton = hostElement.querySelector(
      "[data-testid='compare-file-button']",
    ) as HTMLButtonElement;

    expect(compareButton).not.toBeNull();
    expect(compareButton.textContent).toContain("+ Compare");
    // Identical chrome: same class list, immediately after Open file….
    expect(compareButton.className).toBe(openButton.className);
    expect(openButton.nextElementSibling).toBe(compareButton);

    await act(async () => {
      compareButton.click();
    });
    expect(onCompareFile).toHaveBeenCalledTimes(1);
  });

  it("triggers onOpenFile callback when 'Open file…' button is clicked", async () => {
    const buffer = await fetchFixture(fourChUrl);
    const capture = await parseCaptureBuffer(buffer);
    const onOpenFile = vi.fn();

    await act(async () => {
      root.render(
        <MetadataBanner
          capture={capture}
          fileName="four-channel.fvf"
          onOpenFile={onOpenFile}
        />,
      );
    });

    const button = hostElement.querySelector(
      ".banner-open-btn",
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.textContent).toBe("Open file…");

    await act(async () => {
      button.click();
    });

    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });

  it("matches manifest expectations for 4ch EN 10,000 points 10ms/div", async () => {
    const buffer = await fetchFixture(fourChUrl);
    const capture = await parseCaptureBuffer(buffer);

    await act(async () => {
      root.render(
        <MetadataBanner capture={capture} fileName="accepted-en-4ch.fvf" />,
      );
    });

    const text = hostElement.textContent || "";
    expect(text).toContain("accepted-en-4ch.fvf");
    expect(text).toContain("2026-01-01 12:00:00");
    expect(text).toContain("10 ms/Div");
    expect(text).toContain("4 channels (A, B, C, D)");
    expect(text).toContain("10,000 samples");
    expect(text).toContain("Trigger");
    expect(text).toContain("0 s");
    expect(text).not.toContain("(stored axis)");
    expect(text).toContain("A: 200 V/Div");
    expect(text).toContain("D: 200 V/Div");
    expect(text).not.toContain("Input");
  });

  it("surfaces verbatim current units from the mixed-unit fixture", async () => {
    const buffer = await fetchFixture(mixedCurrentUrl);
    const capture = await parseCaptureBuffer(buffer);

    await act(async () => {
      root.render(
        <MetadataBanner capture={capture} fileName="mixed-current.fvf" />,
      );
    });

    const text = hostElement.textContent || "";
    expect(text).toContain("mixed-current.fvf");
    expect(text).toContain("1 s/Div");
    expect(text).toContain("2 channels (A, B)");
    expect(text).toContain("A: 50 A/Div");
    expect(text).toContain("B: 100 mA/Div");
    expect(text).not.toContain("Input");
  });

  it("matches manifest expectations for 1ch DE comma decimal 3,000 points 0,1 s/div", async () => {
    const buffer = await fetchFixture(deOneChUrl);
    const capture = await parseCaptureBuffer(buffer);

    await act(async () => {
      root.render(
        <MetadataBanner capture={capture} fileName="accepted-de-1ch.fvf" />,
      );
    });

    const text = hostElement.textContent || "";
    expect(text).toContain("accepted-de-1ch.fvf");
    expect(text).toContain("2026-01-01 12:00:00");
    expect(text).toContain("0,1 s/Div");
    expect(text).toContain("1 channel (A)");
    expect(text).toContain("3,000 samples");
    expect(text).toContain("Trigger");
    expect(text).toContain("0 s");
    expect(text).not.toContain("(stored axis)");
    expect(text).not.toContain("Input");
  });

  it("matches manifest expectations for 2ch EN minute roll-mode 10,000 points 1 min/div", async () => {
    const buffer = await fetchFixture(twoChMinUrl);
    const capture = await parseCaptureBuffer(buffer);

    await act(async () => {
      root.render(
        <MetadataBanner capture={capture} fileName="accepted-en-2ch-min.fvf" />,
      );
    });

    const text = hostElement.textContent || "";
    expect(text).toContain("accepted-en-2ch-min.fvf");
    expect(text).toContain("2026-01-01 12:00:00");
    expect(text).toContain("1 min/Div");
    expect(text).toContain("2 channels (A, B)");
    expect(text).toContain("10,000 samples");
    expect(text).toContain("Trigger");
    expect(text).toContain("0 s");
    expect(text).not.toContain("(stored axis)");
    expect(text).not.toContain("Input");
  });

  it("matches manifest expectations for nonsequential ABD 3ch 10,000 points 20ms/div", async () => {
    const buffer = await fetchFixture(nonSeqAbdUrl);
    const capture = await parseCaptureBuffer(buffer);

    await act(async () => {
      root.render(
        <MetadataBanner capture={capture} fileName="nonsequential-abd.fvf" />,
      );
    });

    const text = hostElement.textContent || "";
    expect(text).toContain("nonsequential-abd.fvf");
    expect(text).toContain("2026-01-01 12:00:00");
    expect(text).toContain("20 ms/Div");
    expect(text).toContain("3 channels (A, B, D)");
    expect(text).toContain("10,000 samples");
    expect(text).toContain("Trigger");
    expect(text).toContain("0 s");
    expect(text).not.toContain("(stored axis)");
    expect(text).not.toContain("Input");
  });

  it("matches manifest expectations for derived Mathematik channel (1 physical + 1 derived)", async () => {
    const buffer = await fetchFixture(derivedMathUrl);
    const capture = await parseCaptureBuffer(buffer);

    await act(async () => {
      root.render(
        <MetadataBanner capture={capture} fileName="derived-math.fvf" />,
      );
    });

    const text = hostElement.textContent || "";
    expect(text).toContain("derived-math.fvf");
    expect(text).toContain("2026-01-01 12:00:00");
    expect(text).toContain("10 ms/Div");
    expect(text).toContain("1 channel (A)");
    expect(text).toContain("3,000 samples");
    expect(text).toContain("Mathematik A");
    expect(text).toContain("Trigger");
    expect(text).toContain("0 s");
    expect(text).not.toContain("(stored axis)");
    expect(text).not.toContain("Input");
  });

  it("matches manifest expectations for 500-point lower envelope extreme", async () => {
    const buffer = await fetchFixture(env500Url);
    const capture = await parseCaptureBuffer(buffer);

    await act(async () => {
      root.render(
        <MetadataBanner capture={capture} fileName="extreme-500.fvf" />,
      );
    });

    const text = hostElement.textContent || "";
    expect(text).toContain("extreme-500.fvf");
    expect(text).toContain("2026-01-01 12:00:00");
    expect(text).toContain("10 ms/Div");
    expect(text).toContain("4 channels (A, B, C, D)");
    expect(text).toContain("500 samples");
    expect(text).toContain("Trigger");
    expect(text).toContain("0 s");
    expect(text).not.toContain("(stored axis)");
    expect(text).not.toContain("Input");
  });

  it("matches manifest expectations for 250,000-point upper envelope extreme", async () => {
    const buffer = await fetchFixture(env250kUrl);
    const capture = await parseCaptureBuffer(buffer);

    await act(async () => {
      root.render(
        <MetadataBanner capture={capture} fileName="extreme-250k.fvf" />,
      );
    });

    const text = hostElement.textContent || "";
    expect(text).toContain("extreme-250k.fvf");
    expect(text).toContain("2026-01-01 12:00:00");
    expect(text).toContain("10 ms/Div");
    expect(text).toContain("1 channel (A)");
    expect(text).toContain("250,000 samples");
    expect(text).toContain("Trigger");
    expect(text).toContain("0 s");
    expect(text).not.toContain("(stored axis)");
    expect(text).not.toContain("Input");
  });

  it("issue #151: banner shows the brand logo and an icon-only GitHub repository link", async () => {
    const buffer = await fetchFixture(fourChUrl);
    const capture = await parseCaptureBuffer(buffer);

    await act(async () => {
      root.render(<MetadataBanner capture={capture} fileName="branded.fvf" />);
    });

    const logo = hostElement.querySelector(
      "[data-testid='brand-lockup-logo']",
    ) as HTMLImageElement;
    expect(logo).not.toBeNull();
    expect(logo.getAttribute("src")).toBe("/logo.svg");

    const github = hostElement.querySelector(
      "[data-testid='banner-github']",
    ) as HTMLAnchorElement;
    expect(github).not.toBeNull();
    expect(github.getAttribute("href")).toBe(
      "https://github.com/openscope-ai/fvf-viewer",
    );
    expect(github.getAttribute("target")).toBe("_blank");
    expect(github.getAttribute("rel")).toContain("noopener");
    expect(github.getAttribute("rel")).toContain("noreferrer");
    expect(github.getAttribute("aria-label")).toBe("GitHub repository");
    expect((github.textContent ?? "").trim()).toBe("");
    expect(github.querySelector("svg.github-icon")).not.toBeNull();

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

    // Metadata readouts remain present and unobstructed next to the brand
    // elements.
    const text = hostElement.textContent || "";
    expect(text).toContain("branded.fvf");
    expect(text).toContain("4 channels (A, B, C, D)");
    expect(text).toContain("Trigger");

    // Two-row layout (issue #207): the GitHub link lives in the header row,
    // not in the wrapping metric fields.
    const topRow = github.closest(".banner-top-row") as HTMLElement | null;
    expect(topRow).not.toBeNull();
    expect(topRow!.contains(logo)).toBe(true);
    const metrics = hostElement.querySelector(".banner-metrics") as HTMLElement;
    expect(topRow!.contains(metrics)).toBe(false);
  });

  it("issue #151: 'Open file…' control stays functional beside the brand elements", async () => {
    const buffer = await fetchFixture(fourChUrl);
    const capture = await parseCaptureBuffer(buffer);
    const onOpenFile = vi.fn();

    await act(async () => {
      root.render(
        <MetadataBanner
          capture={capture}
          fileName="branded.fvf"
          onOpenFile={onOpenFile}
        />,
      );
    });

    const button = hostElement.querySelector(
      ".banner-open-btn",
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    await act(async () => {
      button.click();
    });
    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });

  it("color-codes channel letters in both CHANNELS and VERTICAL sections (AC2, AC3)", async () => {
    const buffer = await fetchFixture(mixedCurrentUrl);
    const capture = await parseCaptureBuffer(buffer);

    await act(async () => {
      root.render(
        <MetadataBanner capture={capture} fileName="mixed-current.fvf" />,
      );
    });

    const channelsField = hostElement.querySelector(
      "[data-field='channels']",
    ) as HTMLElement;
    expect(channelsField).not.toBeNull();
    const channelSpans = channelsField.querySelectorAll(
      ".banner-channel-names span",
    );
    expect(channelSpans).toHaveLength(2);
    expect(channelSpans[0]?.textContent).toBe("A");
    expect(channelSpans[1]?.textContent).toBe("B");
    expect((channelSpans[0] as HTMLElement).style.color).toBeTruthy();
    expect((channelSpans[1] as HTMLElement).style.color).toBeTruthy();

    const verticalField = hostElement.querySelector(
      "[data-field='vertical']",
    ) as HTMLElement;
    expect(verticalField).not.toBeNull();
    const verticalSpans = verticalField.querySelectorAll(
      ".banner-field-value span",
    );
    expect(verticalSpans).toHaveLength(2);
    expect(verticalSpans[0]?.textContent).toBe("A");
    expect(verticalSpans[1]?.textContent).toBe("B");
    expect((verticalSpans[0] as HTMLElement).style.color).toBeTruthy();
    expect((verticalSpans[1] as HTMLElement).style.color).toBeTruthy();
  });

  it("places custom channel names in letter tooltips only, never inline (AC4)", async () => {
    const buffer = await fetchFixture(mixedCurrentUrl);
    const capture = await parseCaptureBuffer(buffer);

    useChannelNamesStore.getState().setName("A", "Grid Inverter");

    await act(async () => {
      root.render(
        <MetadataBanner capture={capture} fileName="mixed-current.fvf" />,
      );
    });

    const text = hostElement.textContent || "";
    expect(text).not.toContain("Grid Inverter");
    expect(text).toContain("2 channels (A, B)");

    const channelsField = hostElement.querySelector(
      "[data-field='channels']",
    ) as HTMLElement;
    const chA = channelsField.querySelector(
      ".banner-channel-names span",
    ) as HTMLElement;
    expect(chA.title).toContain("Grid Inverter");

    const verticalField = hostElement.querySelector(
      "[data-field='vertical']",
    ) as HTMLElement;
    const vA = verticalField.querySelector(
      ".banner-field-value span",
    ) as HTMLElement;
    expect(vA.title).toContain("Grid Inverter");
  });

  it("moves non-uniform per-channel sample counts to tooltips only (AC5)", async () => {
    const buffer = await fetchFixture(fourChUrl);
    const capture = await parseCaptureBuffer(buffer);

    // Make channel B have a different sample count
    const nonUniformCapture = {
      ...capture,
      metadata: {
        ...capture.metadata,
        channels: capture.metadata.channels.map((ch) =>
          ch.name === "B" ? { ...ch, samples: 5000 } : ch,
        ),
      },
    };

    await act(async () => {
      root.render(
        <MetadataBanner
          capture={nonUniformCapture}
          fileName="non-uniform.fvf"
        />,
      );
    });

    // SAMPLES section must not itemize non-uniform per-channel counts
    const samplesField = hostElement.querySelector("[data-field='samples']");
    expect(samplesField).toBeNull();

    // Tooltips on letters contain the sample count
    const channelsField = hostElement.querySelector(
      "[data-field='channels']",
    ) as HTMLElement;
    const channelSpans = channelsField.querySelectorAll(
      ".banner-channel-names span",
    );
    expect((channelSpans[0] as HTMLElement).title).toContain("10,000 samples");
    expect((channelSpans[1] as HTMLElement).title).toContain("5,000 samples");
  });

  it("AC3 (issue #131): surfaces channel vertical metadata (canonical per-division, window, saturated, custom name) in CHANNELS letter tooltips", async () => {
    const buffer = await fetchFixture(mixedCurrentUrl);
    const capture = await parseCaptureBuffer(buffer);

    useChannelNamesStore.getState().setName("A", "Grid Inverter");

    await act(async () => {
      root.render(
        <MetadataBanner capture={capture} fileName="mixed-current.fvf" />,
      );
    });

    const channelsField = hostElement.querySelector(
      "[data-field='channels']",
    ) as HTMLElement;
    const channelSpans = channelsField.querySelectorAll(
      ".banner-channel-names span",
    );
    const chA = channelSpans[0] as HTMLElement;
    const chB = channelSpans[1] as HTMLElement;

    // Channel A: custom name + canonical per-division + stored window
    expect(chA.title).toContain("Grid Inverter");
    expect(chA.title).toContain("50 A/Div");
    expect(chA.title).toContain("[-250, 150] A");

    // Channel B: canonical per-division + stored window
    expect(chB.title).toContain("100 mA/Div");
    expect(chB.title).toContain("[-0.3, 0.5] A");
  });

  it("renders TRIGGER section with same graphical style and vertical alignment as SAMPLES/TIMEBASE (Issue #122 AC1-AC3)", async () => {
    const buffer = await fetchFixture(fourChUrl);
    const capture = await parseCaptureBuffer(buffer);

    await act(async () => {
      root.render(
        <MetadataBanner capture={capture} fileName="accepted-en-4ch.fvf" />,
      );
    });

    const triggerField = hostElement.querySelector(
      "[data-field='trigger']",
    ) as HTMLElement;
    expect(triggerField).not.toBeNull();
    expect(triggerField.className).toContain("banner-field");
    expect(triggerField.className).toContain("banner-field-trigger");

    // AC1: identical element structure as SAMPLES/TIMEBASE (label + value)
    const label = triggerField.querySelector(
      ".banner-field-label",
    ) as HTMLElement;
    const value = triggerField.querySelector(
      ".banner-field-value",
    ) as HTMLElement;
    expect(label).not.toBeNull();
    expect(label.textContent).toBe("Trigger");
    expect(value).not.toBeNull();

    // AC2: Inline copy is '0 s' with no '(stored axis)' suffix
    expect(value.textContent).toBe("0 s");
    expect(triggerField.textContent).not.toContain("(stored axis)");

    // AC3: The tooltip carries the trigger-reference explanation
    expect(triggerField.title).toContain(
      "t = 0 marks the acquisition trigger reference",
    );
    expect(triggerField.title).toContain("stored time axis");
  });

  it("AC1-AC3 (Issue #134): waveform information banner has increased spacing between sections, adequate spacing between vertical items, and responsive wrapping", async () => {
    const buffer = await fetchFixture(fourChUrl);
    const capture = await parseCaptureBuffer(buffer);

    await act(async () => {
      root.render(
        <MetadataBanner capture={capture} fileName="accepted-en-4ch.fvf" />,
      );
    });

    const metricsEl = hostElement.querySelector(
      ".banner-metrics",
    ) as HTMLElement;
    expect(metricsEl).not.toBeNull();
    const metricsStyle = window.getComputedStyle(metricsEl);

    // AC1: Increased horizontal spacing between sections (28px)
    expect(metricsStyle.columnGap).toBe("28px");

    // AC2: Adequate spacing between individual channel items in VERTICAL section
    const verticalSpans = hostElement.querySelectorAll(
      "[data-field='vertical'] .banner-field-value span",
    );
    expect(verticalSpans).toHaveLength(4);
    expect(verticalSpans[0]?.textContent).toBe("A");
    expect(verticalSpans[1]?.textContent).toBe("B");
    expect(verticalSpans[2]?.textContent).toBe("C");
    expect(verticalSpans[3]?.textContent).toBe("D");
    const v2Style = window.getComputedStyle(verticalSpans[1] as HTMLElement);
    expect(v2Style.marginLeft).toBe("14px");

    // AC3: Responsive wrapping & clean vertical alignment
    expect(metricsStyle.flexWrap).toBe("wrap");
    expect(metricsStyle.alignItems).toBe("center");
  });

  it("issue #207: renders two rows — brand/filename/Open file + GitHub in the header row, metric fields below", async () => {
    const buffer = await fetchFixture(fourChUrl);
    const capture = await parseCaptureBuffer(buffer);

    await act(async () => {
      root.render(
        <MetadataBanner
          capture={capture}
          fileName="two-rows.fvf"
          onOpenFile={() => {}}
        />,
      );
    });

    const topRow = hostElement.querySelector(".banner-top-row") as HTMLElement;
    expect(topRow).not.toBeNull();

    // Top row: logo, filename, "Open file…", GitHub link.
    expect(
      topRow.querySelector("[data-testid='brand-lockup-logo']"),
    ).not.toBeNull();
    expect(topRow.querySelector(".banner-filename")?.textContent).toBe(
      "two-rows.fvf",
    );
    expect(topRow.querySelector(".banner-open-btn")?.textContent).toBe(
      "Open file…",
    );
    expect(
      topRow.querySelector("[data-testid='banner-github']"),
    ).not.toBeNull();

    // Bottom row: the waveform-information fields, outside the header row.
    const metrics = hostElement.querySelector(".banner-metrics") as HTMLElement;
    expect(metrics).not.toBeNull();
    expect(topRow.contains(metrics)).toBe(false);
    expect(metrics.querySelector("[data-field='date']")).not.toBeNull();
    expect(metrics.querySelector("[data-field='trigger']")).not.toBeNull();

    // Spacing only — no visible horizontal rule between the rows.
    expect(hostElement.querySelector(".metadata-banner hr")).toBeNull();
    const topRowStyle = window.getComputedStyle(topRow);
    expect(parseFloat(topRowStyle.borderBottomWidth)).toBe(0);
    const bannerStyle = window.getComputedStyle(
      hostElement.querySelector(".metadata-banner") as HTMLElement,
    );
    expect(parseFloat(bannerStyle.rowGap)).toBeGreaterThan(0);
  });

  it("issue #207: pins the GitHub link top-right, aligned with the logo, across viewport widths", async () => {
    const buffer = await fetchFixture(fourChUrl);
    const capture = await parseCaptureBuffer(buffer);

    await act(async () => {
      root.render(
        <MetadataBanner capture={capture} fileName="pinned-github.fvf" />,
      );
    });

    const banner = hostElement.querySelector(".metadata-banner") as HTMLElement;
    const logo = hostElement.querySelector(
      "[data-testid='brand-lockup-logo']",
    ) as HTMLElement;
    const github = hostElement.querySelector(
      "[data-testid='banner-github']",
    ) as HTMLElement;
    const metrics = hostElement.querySelector(".banner-metrics") as HTMLElement;

    for (const width of [1684, 1280, 960]) {
      hostElement.style.width = `${width}px`;
      const bannerRect = banner.getBoundingClientRect();
      const logoRect = logo.getBoundingClientRect();
      const githubRect = github.getBoundingClientRect();
      const metricsRect = metrics.getBoundingClientRect();

      // Vertically aligned with the brand logo (center lines coincide).
      const logoCenter = logoRect.top + logoRect.height / 2;
      const githubCenter = githubRect.top + githubRect.height / 2;
      expect(Math.abs(githubCenter - logoCenter)).toBeLessThan(3);

      // Pinned to the top-right corner of the banner (inside its padding).
      expect(githubRect.right).toBeGreaterThan(bannerRect.right - 26);

      // Stays in the header row above the metric fields — never wrapped
      // below them, regardless of how far the metrics row wraps.
      expect(githubRect.bottom).toBeLessThanOrEqual(metricsRect.top + 1);
      expect(githubRect.top).toBeLessThan(metricsRect.top);
    }
  });

  it("issue #208: banner lockup is pixel-identical to the landing lockup (shared component)", async () => {
    const buffer = await fetchFixture(fourChUrl);
    const capture = await parseCaptureBuffer(buffer);

    await act(async () => {
      root.render(<MetadataBanner capture={capture} fileName="lockup.fvf" />);
    });

    // One shared brand component: the banner lockup carries the same markup
    // and classes as the landing page lockup (BrandLockup).
    const lockup = hostElement.querySelector(
      "[data-testid='brand-lockup']",
    ) as HTMLElement;
    expect(lockup).not.toBeNull();

    const logo = lockup.querySelector(".brand-lockup-logo") as HTMLImageElement;
    expect(logo.getAttribute("src")).toBe("/logo.svg");
    const logoRect = logo.getBoundingClientRect();
    expect(logoRect.width).toBeCloseTo(32, 0);
    expect(logoRect.height).toBeCloseTo(32, 0);

    const wordmark = lockup.querySelector(
      "[data-testid='brand-lockup-wordmark']",
    ) as HTMLElement;
    expect(wordmark.textContent).toBe("fvf • viewer");
    const wordmarkStyle = window.getComputedStyle(wordmark);
    expect(wordmarkStyle.fontFamily).toContain("Geist");
    expect(wordmarkStyle.fontWeight).toBe("600");
    expect(parseFloat(wordmarkStyle.fontSize)).toBeCloseTo(17.6, 1);

    const dot = wordmark.querySelector(".brand-dot") as HTMLElement;
    expect(window.getComputedStyle(dot).color).toBe("rgb(252, 198, 3)");
  });

  it("issue #208: clicking the lockup returns to landing — callback fires, button is keyboard-activatable with a focus ring", async () => {
    const buffer = await fetchFixture(fourChUrl);
    const capture = await parseCaptureBuffer(buffer);
    const onReturnToLanding = vi.fn();

    await act(async () => {
      root.render(
        <MetadataBanner
          capture={capture}
          fileName="back.fvf"
          onReturnToLanding={onReturnToLanding}
        />,
      );
    });

    const lockup = hostElement.querySelector(
      "[data-testid='brand-lockup']",
    ) as HTMLButtonElement;

    // A native button: keyboard-activatable by construction (Enter/Space).
    expect(lockup.tagName).toBe("BUTTON");
    expect(lockup.getAttribute("aria-label")).toBe(
      "fvf • viewer — back to the file drop page",
    );

    // Visible focus ring on keyboard focus. Headless programmatic focus()
    // does not reliably match the :focus-visible heuristic, so assert the
    // shipped focus-ring rule itself (keyboard-focus-only selector).
    const hasFocusRing = Array.from(document.styleSheets).some((sheet) => {
      try {
        return Array.from(sheet.cssRules ?? []).some(
          (rule) =>
            rule instanceof CSSStyleRule &&
            rule.selectorText?.includes(".brand-lockup-button:focus-visible") &&
            rule.style.outlineStyle === "solid" &&
            parseFloat(rule.style.outlineWidth) >= 2,
        );
      } catch {
        return false;
      }
    });
    expect(hasFocusRing).toBe(true);

    await act(async () => {
      lockup.click();
    });
    expect(onReturnToLanding).toHaveBeenCalledTimes(1);
  });

  it("issue #208: thin divider separates lockup from the dimmed, smaller filename", async () => {
    const buffer = await fetchFixture(fourChUrl);
    const capture = await parseCaptureBuffer(buffer);

    await act(async () => {
      root.render(
        <MetadataBanner
          capture={capture}
          fileName="divider.fvf"
          onReturnToLanding={() => {}}
        />,
      );
    });

    const lockup = hostElement.querySelector(
      "[data-testid='brand-lockup']",
    ) as HTMLElement;
    const divider = hostElement.querySelector(".banner-divider") as HTMLElement;
    const filename = hostElement.querySelector(
      ".banner-filename",
    ) as HTMLElement;
    expect(divider).not.toBeNull();

    // DOM order: lockup, divider, filename inside the primary group.
    const group = hostElement.querySelector(
      ".banner-primary-group",
    ) as HTMLElement;
    const children = Array.from(group.children);
    expect(children.indexOf(lockup)).toBeLessThan(children.indexOf(divider));
    expect(children.indexOf(divider)).toBeLessThan(children.indexOf(filename));

    // Thin vertical divider with a consistent gap on both sides (the
    // primary group's 14px column gap).
    const dividerRect = divider.getBoundingClientRect();
    const lockupRect = lockup.getBoundingClientRect();
    const filenameRect = filename.getBoundingClientRect();
    expect(dividerRect.width).toBeCloseTo(1, 0);
    const gapBefore = dividerRect.left - lockupRect.right;
    const gapAfter = filenameRect.left - dividerRect.right;
    expect(gapBefore).toBeCloseTo(14, 0);
    expect(gapAfter).toBeCloseTo(14, 0);

    // Filename: slightly dimmer and slightly smaller than before, still
    // monospace with ellipsis overflow.
    const style = window.getComputedStyle(filename);
    expect(style.color).toBe("rgb(204, 204, 204)");
    expect(parseFloat(style.fontSize)).toBeCloseTo(13.76, 1);
    expect(style.fontFamily).toContain("monospace");
    expect(style.textOverflow).toBe("ellipsis");
  });

  it("issue #216: banner lockup is pixel-identical to the landing lockup at the same viewport offset, with no button chrome", async () => {
    const buffer = await fetchFixture(fourChUrl);
    const capture = await parseCaptureBuffer(buffer);

    // The app shows each header on its own page state, both at the top of
    // the shell. Pin both test hosts to the viewport origin so the two
    // lockups' viewport rects are directly comparable.
    hostElement.style.position = "absolute";
    hostElement.style.top = "0";
    hostElement.style.left = "0";
    const landingHost = document.createElement("div");
    landingHost.style.position = "absolute";
    landingHost.style.top = "0";
    landingHost.style.left = "0";
    document.body.appendChild(landingHost);
    const landingRoot = createRoot(landingHost);

    await act(async () => {
      landingRoot.render(<DropPageHeader />);
    });
    await act(async () => {
      root.render(
        <MetadataBanner
          capture={capture}
          fileName="offset.fvf"
          onReturnToLanding={() => {}}
        />,
      );
    });

    const landingLockup = landingHost.querySelector(
      "[data-testid='brand-lockup']",
    ) as HTMLElement;
    const bannerLockup = hostElement.querySelector(
      "[data-testid='brand-lockup']",
    ) as HTMLElement;
    expect(landingLockup.tagName).toBe("DIV");
    expect(bannerLockup.tagName).toBe("BUTTON");

    // The button reset's selectors match the class the component emits, so
    // the reset (and its focus-visible ring) applies to the banner button.
    expect(bannerLockup.classList.contains("brand-lockup-button")).toBe(true);

    // Identical bounding-box dimensions ...
    const landingRect = landingLockup.getBoundingClientRect();
    const bannerRect = bannerLockup.getBoundingClientRect();
    expect(bannerRect.width).toBeCloseTo(landingRect.width, 5);
    expect(bannerRect.height).toBeCloseTo(landingRect.height, 5);

    // ... identical viewport offset (top-left corner) — navigating between
    // the pages via the logo produces no visible jump ...
    expect(bannerRect.top).toBeCloseTo(landingRect.top, 5);
    expect(bannerRect.left).toBeCloseTo(landingRect.left, 5);

    // ... and identical computed background/border/padding: the button
    // carries none of the browser's default chrome.
    const landingStyle = window.getComputedStyle(landingLockup);
    const bannerStyle = window.getComputedStyle(bannerLockup);
    expect(bannerStyle.backgroundColor).toBe(landingStyle.backgroundColor);
    expect(bannerStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(bannerStyle.backgroundImage).toBe(landingStyle.backgroundImage);
    expect(bannerStyle.backgroundImage).toBe("none");
    for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
      expect(bannerStyle[`border${side}Width`]).toBe(
        landingStyle[`border${side}Width`],
      );
      expect(bannerStyle[`padding${side}`]).toBe(
        landingStyle[`padding${side}`],
      );
      expect(bannerStyle[`padding${side}`]).toBe("0px");
    }

    await act(async () => {
      landingRoot.unmount();
    });
    landingHost.remove();
  });

  it("issue #207: banner GitHub icon renders at ~28px", async () => {
    const buffer = await fetchFixture(fourChUrl);
    const capture = await parseCaptureBuffer(buffer);

    await act(async () => {
      root.render(<MetadataBanner capture={capture} fileName="icon.fvf" />);
    });

    const icon = hostElement.querySelector(
      ".banner-github .github-icon",
    ) as SVGElement;
    expect(icon).not.toBeNull();
    const rect = icon.getBoundingClientRect();
    expect(rect.width).toBeCloseTo(28, 0);
    expect(rect.height).toBeCloseTo(28, 0);
  });
});
