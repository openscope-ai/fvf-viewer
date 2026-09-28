import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import CsvExportButton from "./CsvExportButton";
import { useCaptureStore } from "../../state/captureStore";
import type { ParsedCapture } from "../../types/capture";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function syntheticCapture(samples = 5): ParsedCapture {
  const channels = ["Input A", "Input B"].map((label, channelIndex) => ({
    name: label.replace(/^Input /, ""),
    label,
    derived: false,
    data: Float32Array.from({ length: samples }, (_, sample) =>
      Math.fround(sample + channelIndex * 0.5 - 2),
    ),
  }));
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
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click");

  beforeEach(() => {
    useCaptureStore.setState({
      capture: syntheticCapture(),
      fileName: "capture.fvf",
      parseState: "success",
      error: null,
    });
    hostElement = document.createElement("div");
    document.body.appendChild(hostElement);
    root = createRoot(hostElement);
    anchorClick.mockClear();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    hostElement.remove();
    useCaptureStore.getState().reset();
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
