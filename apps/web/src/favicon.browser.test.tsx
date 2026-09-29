/**
 * Issue #152: favicon carries the finalized FVF Viewer logo design — the
 * gold (#fcc603) distorted sine wave over a muted reticle on a charcoal
 * squircle tile — with a multi-resolution .ico fallback (64/48/32/16).
 *
 * The tile is the contrast mechanism: the icon keeps its own dark
 * background on both light and dark browser tab themes instead of the
 * issue #88 transparent-wave + prefers-color-scheme approach.
 */

import { describe, expect, it } from "vitest";
import svgText from "../public/favicon.svg?raw";
import icoUrl from "../public/favicon.ico?url";

function parseFaviconSvg(): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  expect(doc.querySelector("svg")).not.toBeNull();
  return doc;
}

describe("Favicon assets (finalized logo design)", () => {
  it("AC1: squircle tile + reticle + single gold distorted sine wave match the logo design", () => {
    const doc = parseFaviconSvg();

    // Charcoal squircle tile with rounded corners (the logo container)
    const rects = doc.querySelectorAll("rect");
    expect(rects.length).toBeGreaterThanOrEqual(1);
    const tile = rects[0]!;
    expect(tile.getAttribute("rx")).not.toBeNull();

    // Muted reticle: two zero-crossing gridline strokes
    const lines = doc.querySelectorAll("line");
    expect(lines.length).toBe(2);

    // Exactly one waveform path (the distorted sine), round-capped
    const paths = doc.querySelectorAll("path");
    expect(paths.length).toBe(1);
    const wavePath = paths[0]!;
    expect(wavePath.getAttribute("fill")).toBe("none");
    expect(wavePath.getAttribute("stroke")).toBe("#fcc603");
    expect(wavePath.getAttribute("stroke-linecap")).toBe("round");
    expect(wavePath.getAttribute("stroke-linejoin")).toBe("round");

    // Smooth continuous curve only (cubic segments, no tick sub-commands)
    const pathData = wavePath.getAttribute("d") ?? "";
    expect(pathData.startsWith("M")).toBe(true);
    expect(pathData).toContain("C");
    expect(pathData).not.toContain("H");
    expect(pathData).not.toContain("L");
  });

  it("AC3: wave stroke is favicon-legible on the 512 viewBox and the tile carries its own dark background", () => {
    const doc = parseFaviconSvg();
    const wavePath = doc.querySelector("path");

    // Stroke >= 32/512 (>= 8/64 in the previous favicon's scale) keeps the
    // wave readable after 16px rasterization.
    const strokeWidth = parseFloat(
      wavePath?.getAttribute("stroke-width") ?? "0",
    );
    expect(strokeWidth).toBeGreaterThanOrEqual(32);

    // Self-contained contrast: the tile fill and rim are defined inside the
    // SVG (gradient + stroke), so legibility never depends on the tab
    // theme's background color.
    const defs = doc.querySelector("defs");
    expect(defs).not.toBeNull();
    expect(doc.querySelector("linearGradient")).not.toBeNull();
    // The tile is the painted squircle; skip the clipPath geometry rect.
    const tile = Array.from(doc.querySelectorAll("rect")).find(
      (rect) => !rect.closest("clipPath"),
    )!;
    expect(tile).toBeDefined();
    expect(tile.getAttribute("fill")).toContain("url(#");
    expect(tile.getAttribute("stroke")).toContain("url(#");
  });

  it("AC2: favicon.ico contains 16/32/48 multi-resolution mipmaps (plus 64)", async () => {
    const res = await fetch(icoUrl);
    expect(res.ok).toBe(true);
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);

    const dataView = new DataView(buf);
    // ICO header: 0x0000 reserved, 0x0001 image type (ICO)
    const reserved = dataView.getUint16(0, true);
    const imageType = dataView.getUint16(2, true);
    const count = dataView.getUint16(4, true);

    expect(reserved).toBe(0);
    expect(imageType).toBe(1);
    expect(count).toBe(4);

    // Directory entries start at byte 6; width/height are bytes 0 and 1
    // (0 means 256). Sizes 16, 32, 48, 64 must all be present.
    const sizes = new Set<number>();
    for (let i = 0; i < count; i += 1) {
      const entry = 6 + i * 16;
      const width = dataView.getUint8(entry);
      const height = dataView.getUint8(entry + 1);
      expect(width).toBe(height);
      sizes.add(width === 0 ? 256 : width);
    }
    expect(sizes.has(16)).toBe(true);
    expect(sizes.has(32)).toBe(true);
    expect(sizes.has(48)).toBe(true);
    expect(sizes.has(64)).toBe(true);
  });
});
