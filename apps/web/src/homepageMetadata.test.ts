import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const indexHtmlPath = path.resolve(__dirname, "../index.html");
const shareImagePath = path.resolve(__dirname, "../public/share-image.png");

describe("Homepage head metadata and discoverability (issue #299)", () => {
  const html = readFileSync(indexHtmlPath, "utf8");

  it("served / index.html exists", () => {
    expect(existsSync(indexHtmlPath)).toBe(true);
  });

  it("contains descriptive title using .fvf / FVF / ScopeMeter vocabulary with no Fluke/FlukeView terms (AC1)", () => {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    expect(titleMatch).toBeTruthy();
    const title = titleMatch?.[1] ?? "";

    expect(title).toMatch(/\.fvf/i);
    expect(title).toMatch(/FVF/);
    expect(title).toMatch(/ScopeMeter/i);
    expect(title).not.toMatch(/Fluke/i);
    expect(title).not.toMatch(/FlukeView/i);
  });

  it("contains meta description using allowed vocabulary with no Fluke/FlukeView terms (AC1)", () => {
    const descMatch = html.match(
      /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i,
    );
    expect(descMatch).toBeTruthy();
    const description = descMatch?.[1] ?? "";

    expect(description.length).toBeGreaterThan(30);
    expect(description).toMatch(/\.fvf/i);
    expect(description).toMatch(/ScopeMeter/i);
    expect(description).not.toMatch(/Fluke/i);
    expect(description).not.toMatch(/FlukeView/i);
  });

  it("contains canonical link to https://fvf-viewer.com/ (AC2)", () => {
    const canonicalMatch = html.match(
      /<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i,
    );
    expect(canonicalMatch).toBeTruthy();
    expect(canonicalMatch?.[1]).toBe("https://fvf-viewer.com/");
  });

  it("contains Open Graph tags referencing the 1200x630 share image without Fluke targeting (AC3)", () => {
    const getOg = (property: string): string => {
      const match = html.match(
        new RegExp(
          `<meta\\s+property=["']${property}["']\\s+content=["']([^"']+)["']`,
          "i",
        ),
      );
      return match?.[1] ?? "";
    };

    expect(getOg("og:type")).toBe("website");
    expect(getOg("og:url")).toBe("https://fvf-viewer.com/");
    expect(getOg("og:title")).toMatch(/ScopeMeter|\.fvf|FVF/);
    expect(getOg("og:title")).not.toMatch(/Fluke/i);
    expect(getOg("og:description")).toMatch(/ScopeMeter|\.fvf|FVF/);
    expect(getOg("og:description")).not.toMatch(/Fluke/i);
    expect(getOg("og:image")).toBe("https://fvf-viewer.com/share-image.png");
    expect(getOg("og:image:type")).toBe("image/png");
    expect(getOg("og:image:width")).toBe("1200");
    expect(getOg("og:image:height")).toBe("630");
  });

  it("contains Twitter Card tags referencing the share image (AC3)", () => {
    const getTwitter = (name: string): string => {
      const match = html.match(
        new RegExp(
          `<meta\\s+name=["']${name}["']\\s+content=["']([^"']+)["']`,
          "i",
        ),
      );
      return match?.[1] ?? "";
    };

    expect(getTwitter("twitter:card")).toBe("summary_large_image");
    expect(getTwitter("twitter:title")).toMatch(/ScopeMeter|\.fvf|FVF/);
    expect(getTwitter("twitter:title")).not.toMatch(/Fluke/i);
    expect(getTwitter("twitter:description")).toMatch(/ScopeMeter|\.fvf|FVF/);
    expect(getTwitter("twitter:description")).not.toMatch(/Fluke/i);
    expect(getTwitter("twitter:image")).toBe(
      "https://fvf-viewer.com/share-image.png",
    );
  });

  it("serves a real 1200x630 PNG share image from public directory (AC3)", () => {
    expect(existsSync(shareImagePath)).toBe(true);
    const buf = readFileSync(shareImagePath);
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect(buf.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    // Width and height in IHDR chunk
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    expect(width).toBe(1200);
    expect(height).toBe(630);
  });

  it("contains a <noscript> note linking to static guide pages, outside React root (AC4, AC5)", () => {
    const noscriptMatch = html.match(/<noscript>([\s\S]*?)<\/noscript>/i);
    expect(noscriptMatch).toBeTruthy();
    const noscriptContent = noscriptMatch?.[1] ?? "";

    // Links to static guide pages
    expect(noscriptContent).toContain('href="/open-fvf-file/"');
    expect(noscriptContent).toMatch(/How to Open a \.fvf File/i);
    expect(noscriptContent).toContain('href="/supported-scopemeter-models/"');
    expect(noscriptContent).toMatch(/Supported ScopeMeter Models/i);

    // React root is empty (no injected crawler text inside #root)
    const rootMatch = html.match(/<div\s+id=["']root["']>([\s\S]*?)<\/div>/i);
    expect(rootMatch).toBeTruthy();
    expect(rootMatch?.[1]?.trim()).toBe("");

    // noscript is sibling of #root, not child
    const rootIndex = html.indexOf('<div id="root">');
    const noscriptIndex = html.indexOf("<noscript>");
    expect(rootIndex).toBeGreaterThan(0);
    expect(noscriptIndex).toBeGreaterThan(rootIndex);
  });
});
