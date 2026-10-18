import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import CsvExportButton from "./CsvExportButton";
import { useCaptureStore } from "../../state/captureStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useCsvExportStore } from "../../state/csvExportStore";
import { useBadgePopoverStore } from "../toolbar/badgeConfig/anchoredPopover";
import type { ParsedCapture } from "../../types/capture";

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
});
