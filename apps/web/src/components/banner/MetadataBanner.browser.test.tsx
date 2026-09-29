import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseCaptureBuffer } from "../../workers/workerClient";
import MetadataBanner from "./MetadataBanner";
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
      "[data-testid='banner-logo']",
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

    // Responsive behavior: the banner keeps its wrapping layout.
    const banner = hostElement.querySelector(".metadata-banner") as HTMLElement;
    const bannerStyle = window.getComputedStyle(banner);
    expect(bannerStyle.flexWrap).toBe("wrap");
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
});
