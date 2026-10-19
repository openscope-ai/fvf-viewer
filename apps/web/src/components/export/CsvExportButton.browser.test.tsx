import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import CsvExportButton from "./CsvExportButton";
import PngSnapshotButton from "./PngSnapshotButton";
import { useCaptureStore } from "../../state/captureStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useCsvExportStore } from "../../state/csvExportStore";
import { useBadgePopoverStore } from "../toolbar/badgeConfig/anchoredPopover";
import { useSnapshotStore } from "./snapshotStore";
import type { ParsedCapture } from "../../types/capture";
import "../../index.css";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function syntheticCapture(samples = 5, prefix = "Input"): ParsedCapture {
  const channels = [`${prefix} A`, `${prefix} B`].map(
    (label, channelIndex) => ({
      name: label.replace(/^Input /, ""),
      label,
      derived: false,
      data: Float32Array.from({ length: samples }, (_, sample) =>
        Math.fround(sample + channelIndex * 0.5 - 2),
      ),
    }),
  );
  return {
    timestamps: Float32Array.from({ length: samples }, (_, sample) =>
      Math.fround((sample - samples / 2) * 1e-6),
    ),
    channels,
    derivedChannels: [],
    warnings: [],
    metadata: {
      version: 1,
      flavor: "synthetic",
      timebaseRaw: "500.0 us/Div",
      secondsPerDiv: 500e-6,
      timestamp14: "",
      samples,
      deltaT: 1e-6,
      channels: channels.map((channel) => ({
        name: channel.name,
        label: channel.label,
        derived: false,
        samples,
        deltaT: 1e-6,
      })),
    },
  };
}

describe("CsvExportButton (browser)", () => {
  let hostElement: HTMLDivElement;
  let root: Root;
  const revokedUrls = new Set<string>();
  let createdUrl: string | null = null;
  let anchorClick: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    useCaptureStore.setState({
      capture: syntheticCapture(),
      fileName: "capture.fvf",
      parseState: "success",
      error: null,
    });
    useReferenceStore.getState().clear();
    useCsvExportStore.getState().reset();
    useBadgePopoverStore.getState().setOpen(null);

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
    useReferenceStore.getState().clear();
    useCsvExportStore.getState().reset();
    useBadgePopoverStore.getState().setOpen(null);
    if (createdUrl) URL.revokeObjectURL(createdUrl);
    createdUrl = null;
    revokedUrls.clear();
    vi.restoreAllMocks();
  });

  it("downloads a CSV Blob whose content matches the capture (chunked export)", async () => {
    let exportedBlob: Blob | MediaSource | null = null;
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      (blob: Blob | MediaSource) => {
        exportedBlob = blob;
        createdUrl = `blob:test-${createdUrl === null ? 0 : 1}`;
        return createdUrl;
      },
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
      revokedUrls.add(url);
    });

    await act(async () => {
      root.render(<CsvExportButton />);
    });

    const button = hostElement.querySelector(
      "[data-testid='csv-export-button']",
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Export CSV");

    await act(async () => {
      button.click();
    });

    expect(anchorClick).toHaveBeenCalledTimes(1);
    const anchor = anchorClick.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toMatch(/^capture-\d{8}-\d{6}\.csv$/);
    expect(revokedUrls.has(createdUrl ?? "")).toBe(true); // object URL revoked after download

    expect(exportedBlob).toBeInstanceOf(Blob);
    const csv = await (exportedBlob as unknown as Blob).text();
    const lines = csv.split("\r\n").filter((line) => line.length > 0);
    const dataRows = lines.filter((line) => !line.startsWith("#"));
    expect(dataRows[0]).toBe("sample,time_s,Input A,Input B");
    expect(dataRows).toHaveLength(6); // header row + 5 samples
    const fields = dataRows[1]!.split(",");
    expect(Math.fround(parseFloat(fields[2]!))).toBe(
      useCaptureStore.getState().capture!.channels[0]!.data[0]!,
    );
  });

  it("opens options popover and exports with semicolon delimiter", async () => {
    let exportedBlob: Blob | MediaSource | null = null;
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      (blob: Blob | MediaSource) => {
        exportedBlob = blob;
        createdUrl = `blob:test-${createdUrl === null ? 0 : 1}`;
        return createdUrl;
      },
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
      revokedUrls.add(url);
    });

    await act(async () => {
      root.render(<CsvExportButton />);
    });

    const gear = hostElement.querySelector(
      "[data-testid='csv-export-gear']",
    ) as HTMLButtonElement;
    expect(gear).not.toBeNull();

    await act(async () => {
      gear.click();
    });

    const popover = document.querySelector(
      "[data-testid='csv-export-popover']",
    );
    expect(popover).not.toBeNull();

    const semicolonChip = document.querySelector(
      "[data-testid='csv-delimiter-semicolon']",
    ) as HTMLButtonElement;
    expect(semicolonChip).not.toBeNull();

    await act(async () => {
      semicolonChip.click();
    });

    expect(useCsvExportStore.getState().settings.delimiter).toBe("semicolon");

    const exportButton = hostElement.querySelector(
      "[data-testid='csv-export-button']",
    ) as HTMLButtonElement;
    await act(async () => {
      exportButton.click();
    });

    expect(exportedBlob).toBeInstanceOf(Blob);
    const csv = await (exportedBlob as unknown as Blob).text();
    const lines = csv.split("\r\n").filter((line) => line.length > 0);
    const dataRows = lines.filter((line) => !line.startsWith("#"));
    expect(dataRows[0]).toBe("sample;time_s;Input A;Input B");
  });

  it("in compare mode, defaults to composite CSV export and supports dataset selection", async () => {
    const ref = syntheticCapture(5, "Ref");
    useReferenceStore.setState({
      capture: ref,
      fileName: "ref.fvf",
      lanes: [
        new Float32Array([1, 2, 3, 4, 5]),
        new Float32Array([2, 3, 4, 5, 6]),
      ],
      timeSlipSamples: 0,
      parseState: "success",
    });

    let exportedBlob: Blob | MediaSource | null = null;
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      (blob: Blob | MediaSource) => {
        exportedBlob = blob;
        createdUrl = `blob:test-${createdUrl === null ? 0 : 1}`;
        return createdUrl;
      },
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
      revokedUrls.add(url);
    });

    await act(async () => {
      root.render(<CsvExportButton />);
    });

    // 1. Primary button click in compare mode -> default composite export
    const button = hostElement.querySelector(
      "[data-testid='csv-export-button']",
    ) as HTMLButtonElement;
    await act(async () => {
      button.click();
      await new Promise((r) => setTimeout(r, 20));
    });

    const anchor = anchorClick.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toMatch(
      /^capture-vs-ref-composite-\d{8}-\d{6}\.csv$/,
    );

    const csv = await (exportedBlob as unknown as Blob).text();
    const lines = csv.split("\r\n").filter((line) => line.length > 0);
    expect(lines).toContain("# FVF Viewer CSV export (composite time-aligned)");
    const dataRows = lines.filter((line) => !line.startsWith("#"));
    expect(dataRows[0]).toBe(
      "sample,time_s,[File 1] Input A,[File 1] Input B,[File 2] Ref A,[File 2] Ref B",
    );

    // 2. Open popover and switch dataset to 'File 1 only'
    const gear = hostElement.querySelector(
      "[data-testid='csv-export-gear']",
    ) as HTMLButtonElement;
    await act(async () => {
      gear.click();
    });

    const primaryDatasetChip = document.querySelector(
      "[data-testid='csv-dataset-primary']",
    ) as HTMLButtonElement;
    expect(primaryDatasetChip).not.toBeNull();

    await act(async () => {
      primaryDatasetChip.click();
    });

    await act(async () => {
      button.click();
      await new Promise((r) => setTimeout(r, 20));
    });

    const anchorPrimary = anchorClick.mock.instances[1] as HTMLAnchorElement;
    expect(anchorPrimary.download).toMatch(/^capture-\d{8}-\d{6}\.csv$/);
  });

  it("stays disabled without a parsed capture", async () => {
    useCaptureStore.setState({ capture: null, parseState: "idle" });
    await act(async () => {
      root.render(<CsvExportButton />);
    });
    const button = hostElement.querySelector(
      "[data-testid='csv-export-button']",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await act(async () => {
      button.click();
    });
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it("AC1-AC5 (#310): layout parity with PNG export popover (hero, body, section present for both popovers, close button focus, no dead classes)", async () => {
    useSnapshotStore.setState({
      exporter: async () => new Blob(["test"]),
    });

    await act(async () => {
      root.render(
        <div style={{ display: "flex", gap: "8px", padding: "16px" }}>
          <CsvExportButton />
          <PngSnapshotButton />
        </div>,
      );
    });

    const csvGear = hostElement.querySelector(
      "[data-testid='csv-export-gear']",
    ) as HTMLButtonElement;
    const pngGear = hostElement.querySelector(
      "[data-testid='png-export-gear']",
    ) as HTMLButtonElement;
    expect(csvGear).not.toBeNull();
    expect(pngGear).not.toBeNull();

    // 1. Open CSV popover and assert hero, body, section
    await act(async () => {
      csvGear.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    const csvPopover = document.querySelector(
      "[data-testid='csv-export-popover']",
    ) as HTMLElement;
    expect(csvPopover).not.toBeNull();

    const csvHero = csvPopover.querySelector(
      ".badge-popover-hero",
    ) as HTMLElement;
    expect(csvHero).not.toBeNull();
    const csvTitle = csvHero.querySelector(
      ".badge-static-title",
    ) as HTMLElement;
    expect(csvTitle.textContent).toBe("CSV export");
    const csvSummary = csvHero.querySelector(
      "[data-testid='csv-export-summary']",
    ) as HTMLElement;
    expect(csvSummary).not.toBeNull();
    expect(csvSummary.textContent).toBe("Delimiter & dataset configuration");
    const csvCloseBtn = csvHero.querySelector(
      "[data-testid='csv-popover-close']",
    ) as HTMLButtonElement;
    expect(csvCloseBtn).not.toBeNull();

    const csvBody = csvPopover.querySelector(
      ".badge-popover-body",
    ) as HTMLElement;
    expect(csvBody).not.toBeNull();
    expect(window.getComputedStyle(csvBody).paddingLeft).toBe("14px");
    expect(window.getComputedStyle(csvBody).paddingRight).toBe("14px");

    const csvSection = csvBody.querySelector(
      "[data-testid='csv-export-section']",
    ) as HTMLElement;
    expect(csvSection).not.toBeNull();
    expect(csvSection.className).toContain("badge-settings-section");

    // No dead classes or inline minWidth
    expect(csvPopover.querySelector(".badge-popover-content")).toBeNull();
    expect(csvPopover.querySelector(".csv-export-content")).toBeNull();
    for (const el of Array.from(csvPopover.querySelectorAll("*"))) {
      expect((el as HTMLElement).style.minWidth).toBe("");
    }

    const csvDomain = csvSection.querySelector(
      ".csv-export-domain",
    ) as HTMLElement;
    expect(csvDomain).not.toBeNull();
    expect(window.getComputedStyle(csvDomain).width).toBe("86px");
    const commaChip = csvSection.querySelector(
      "[data-testid='csv-delimiter-comma']",
    ) as HTMLButtonElement;
    expect(commaChip.className).toContain("badge-opacity-chip");
    expect(commaChip.className).toContain("badge-setting-chip");
    expect(commaChip.getAttribute("aria-pressed")).toBe("true");

    // Close button dismisses CSV popover and returns focus to csvGear
    await act(async () => {
      csvCloseBtn.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(
      document.querySelector("[data-testid='csv-export-popover']"),
    ).toBeNull();
    expect(document.activeElement).toBe(csvGear);

    // 2. Open PNG popover and assert hero, body, section
    await act(async () => {
      pngGear.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    const pngPopover = document.querySelector(
      "[data-testid='png-export-popover']",
    ) as HTMLElement;
    expect(pngPopover).not.toBeNull();

    const pngHero = pngPopover.querySelector(
      ".badge-popover-hero",
    ) as HTMLElement;
    expect(pngHero).not.toBeNull();
    const pngTitle = pngHero.querySelector(
      ".badge-static-title",
    ) as HTMLElement;
    expect(pngTitle.textContent).toBe("PNG export");
    const pngSummary = pngHero.querySelector(
      "[data-testid='png-export-summary']",
    ) as HTMLElement;
    expect(pngSummary).not.toBeNull();
    expect(pngSummary.textContent).toBe("Snapshot & print configuration");
    const pngCloseBtn = pngHero.querySelector(
      "[data-testid='png-popover-close']",
    ) as HTMLButtonElement;
    expect(pngCloseBtn).not.toBeNull();

    const pngBody = pngPopover.querySelector(
      ".badge-popover-body",
    ) as HTMLElement;
    expect(pngBody).not.toBeNull();
    expect(window.getComputedStyle(pngBody).paddingLeft).toBe("14px");
    expect(window.getComputedStyle(pngBody).paddingRight).toBe("14px");

    const pngSection = pngBody.querySelector(
      "[data-testid='png-export-section']",
    ) as HTMLElement;
    expect(pngSection).not.toBeNull();
    expect(pngSection.className).toContain("badge-settings-section");

    const pngDomain = pngSection.querySelector(
      ".png-export-domain",
    ) as HTMLElement;
    expect(pngDomain).not.toBeNull();
    expect(window.getComputedStyle(pngDomain).width).toBe("86px");

    // Close button dismisses PNG popover and returns focus to pngGear
    await act(async () => {
      pngCloseBtn.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(
      document.querySelector("[data-testid='png-export-popover']"),
    ).toBeNull();
    expect(document.activeElement).toBe(pngGear);

    // 3. Assert direct structural parity between CSV and PNG popovers
    expect(csvHero.className).toBe(pngHero.className);
    expect(csvBody.className).toBe(pngBody.className);
    expect(csvSection.className).toBe(pngSection.className);
  });

  it("AC3 (#310): compare mode renders both Delimiter and Dataset sections cleanly inside hero/body structure", async () => {
    const ref = syntheticCapture(5, "Ref");
    useReferenceStore.setState({
      capture: ref,
      fileName: "ref.fvf",
      lanes: [
        new Float32Array([1, 2, 3, 4, 5]),
        new Float32Array([2, 3, 4, 5, 6]),
      ],
      timeSlipSamples: 0,
      parseState: "success",
    });

    await act(async () => {
      root.render(<CsvExportButton />);
    });

    const gear = hostElement.querySelector(
      "[data-testid='csv-export-gear']",
    ) as HTMLButtonElement;
    await act(async () => {
      gear.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    const popover = document.querySelector(
      "[data-testid='csv-export-popover']",
    ) as HTMLElement;
    expect(popover).not.toBeNull();
    expect(popover.querySelector(".badge-popover-hero")).not.toBeNull();
    expect(
      popover.querySelector("[data-testid='csv-popover-close']"),
    ).not.toBeNull();
    expect(popover.querySelector(".badge-popover-body")).not.toBeNull();
    expect(
      popover.querySelector("[data-testid='csv-delimiter-comma']"),
    ).not.toBeNull();
    expect(
      popover.querySelector("[data-testid='csv-dataset-composite']"),
    ).not.toBeNull();
    expect(
      popover.querySelector("[data-testid='csv-dataset-primary']"),
    ).not.toBeNull();
    expect(
      popover.querySelector("[data-testid='csv-dataset-reference']"),
    ).not.toBeNull();
  });

  it("AC6 (#310): captures screenshots of open CSV and PNG popovers in single-file and compare mode", async () => {
    await page.viewport(1280, 800);

    await act(async () => {
      useSnapshotStore.setState({
        exporter: async () => new Blob(["test"]),
      });
      useReferenceStore.setState({
        capture: null,
        fileName: null,
        lanes: [],
        timeSlipSamples: 0,
        parseState: "idle",
      });
    });

    await act(async () => {
      root.render(
        <div style={{ display: "flex", gap: "16px", padding: "60px 80px" }}>
          <CsvExportButton />
          <PngSnapshotButton />
        </div>,
      );
    });

    const csvGear = hostElement.querySelector(
      "[data-testid='csv-export-gear']",
    ) as HTMLButtonElement;
    const pngGear = hostElement.querySelector(
      "[data-testid='png-export-gear']",
    ) as HTMLButtonElement;

    // 1. Single-file mode: CSV popover
    await act(async () => {
      csvGear.click();
      await new Promise((r) => setTimeout(r, 100));
    });
    const csvPopover = document.querySelector(
      "[data-testid='csv-export-popover']",
    ) as HTMLElement;
    expect(csvPopover).not.toBeNull();
    await page.screenshot({
      element: csvPopover,
      path: "../../../../../.github/assets/pr-310-csv-single.png",
    });

    // 2. Single-file mode: PNG popover
    await act(async () => {
      pngGear.click();
      await new Promise((r) => setTimeout(r, 100));
    });
    const pngPopover = document.querySelector(
      "[data-testid='png-export-popover']",
    ) as HTMLElement;
    expect(pngPopover).not.toBeNull();
    await page.screenshot({
      element: pngPopover,
      path: "../../../../../.github/assets/pr-310-png-single.png",
    });

    // 3. Compare mode
    const ref = syntheticCapture(5, "Ref");
    await act(async () => {
      useReferenceStore.setState({
        capture: ref,
        fileName: "ref.fvf",
        lanes: [
          new Float32Array([1, 2, 3, 4, 5]),
          new Float32Array([2, 3, 4, 5, 6]),
        ],
        timeSlipSamples: 0,
        parseState: "success",
      });
    });

    // Compare mode: CSV popover
    await act(async () => {
      csvGear.click();
      await new Promise((r) => setTimeout(r, 100));
    });
    const csvComparePopover = document.querySelector(
      "[data-testid='csv-export-popover']",
    ) as HTMLElement;
    expect(csvComparePopover).not.toBeNull();
    await page.screenshot({
      element: csvComparePopover,
      path: "../../../../../.github/assets/pr-310-csv-compare.png",
    });

    // Compare mode: PNG popover
    await act(async () => {
      pngGear.click();
      await new Promise((r) => setTimeout(r, 100));
    });
    const pngComparePopover = document.querySelector(
      "[data-testid='png-export-popover']",
    ) as HTMLElement;
    expect(pngComparePopover).not.toBeNull();
    await page.screenshot({
      element: pngComparePopover,
      path: "../../../../../.github/assets/pr-310-png-compare.png",
    });
  });
});
