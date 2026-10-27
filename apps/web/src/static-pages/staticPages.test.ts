import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  renderStaticLayout,
  SITE_DISCLAIMER,
  webApplicationJsonLd,
} from "./layout";
import { faqPage } from "./pages/faq";
import { fvfFileFormatPage } from "./pages/fvf-file-format";
import { openFvfFilePage } from "./pages/open-fvf-file";
import { supportedScopemeterModelsPage } from "./pages/supported-scopemeter-models";
import { getStaticPage, staticPages } from "./registry";

describe("static pages foundation (issue #298)", () => {
  it("registers /open-fvf-file/ in static pages registry", () => {
    const page = getStaticPage("open-fvf-file");
    expect(page).toBeDefined();
    expect(page?.meta.slug).toBe("open-fvf-file");
  });

  it("renders a complete standalone HTML document without app bundle scripts", () => {
    const html = renderStaticLayout({
      meta: openFvfFilePage.meta,
      contentHtml: openFvfFilePage.renderContent(),
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain(
      "<title>How to Open a .fvf File in Your Browser — FVF Viewer</title>",
    );
    expect(html).toContain(
      '<meta name="description" content="Open, inspect, and analyze .fvf waveform capture files from ScopeMeter instruments directly in your browser. 100% client-side privacy with zero server uploads." />',
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://fvf-viewer.com/open-fvf-file/" />',
    );
    expect(html).toContain('<meta name="color-scheme" content="dark" />');
    // Does not have React root or app bundle script tags
    expect(html).not.toContain('<div id="root">');
    expect(html).not.toContain('src="/src/main.tsx"');
  });

  it("visibly presents what a .fvf file is, how to open one, and the privacy model", () => {
    const html = openFvfFilePage.renderContent();

    expect(html).toContain("What is a .fvf File?");
    expect(html).toContain("How to Open a .fvf File in FVF Viewer");
    expect(html).toContain("100% Client-Side Privacy");
    expect(html).toContain('href="/"');
    expect(html).toContain("Open the viewer");
  });

  it("enforces no-Fluke-targeting constraint: no Fluke or FlukeView in metadata or body headings", () => {
    const meta = openFvfFilePage.meta;
    expect(meta.title.toLowerCase()).not.toContain("fluke");
    expect(meta.description.toLowerCase()).not.toContain("fluke");

    const content = openFvfFilePage.renderContent();
    // Headings and titles must not target Fluke / FlukeView
    const headings = content.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi) ?? [];
    for (const heading of headings) {
      expect(heading.toLowerCase()).not.toContain("fluke");
    }
  });

  it("renders the verbatim contractual trademark disclaimer in the footer", () => {
    const html = renderStaticLayout({
      meta: openFvfFilePage.meta,
      contentHtml: openFvfFilePage.renderContent(),
    });

    expect(html).toContain(SITE_DISCLAIMER);
    expect(html).toContain(
      "fvf • viewer is not affiliated with, endorsed by, or sponsored by Fluke Corporation. Fluke and ScopeMeter are registered trademarks of Fluke Corporation.",
    );
  });

  it("includes navigation links to registered static guide pages and GitHub", () => {
    const html = renderStaticLayout({
      meta: openFvfFilePage.meta,
      contentHtml: openFvfFilePage.renderContent(),
    });

    expect(html).toContain('href="/open-fvf-file/"');
    expect(html).toContain("Open FVF File");
    expect(html).toContain('href="/supported-scopemeter-models/"');
    expect(html).toContain("Supported Models");
    expect(html).toContain('href="https://github.com/openscope-ai/fvf-viewer"');
  });
});

describe("supported ScopeMeter models static page (issue #300)", () => {
  it("registers /supported-scopemeter-models/ in static pages registry (AC4)", () => {
    const page = getStaticPage("supported-scopemeter-models");
    expect(page).toBeDefined();
    expect(page?.meta.slug).toBe("supported-scopemeter-models");
    expect(page?.meta.navLabel).toBe("Supported Models");
    expect(staticPages).toContain(supportedScopemeterModelsPage);
  });

  it("renders a complete standalone HTML document without JavaScript or React root (AC1)", () => {
    const html = renderStaticLayout({
      meta: supportedScopemeterModelsPage.meta,
      contentHtml: supportedScopemeterModelsPage.renderContent(),
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain(
      "<title>Supported ScopeMeter Models & .fvf Channel Configurations — FVF Viewer</title>",
    );
    expect(html).toContain(
      '<meta name="description" content="Explore supported ScopeMeter test instrument models, 1-channel to 4-channel configurations, and binary waveform envelopes compatible with FVF Viewer." />',
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://fvf-viewer.com/supported-scopemeter-models/" />',
    );
    expect(html).toContain('<meta name="color-scheme" content="dark" />');
    expect(html).not.toContain('<div id="root">');
    expect(html).not.toContain('src="/src/main.tsx"');
  });

  it("lists supported ScopeMeter model families and channel configurations traceable to parser envelope (AC2)", () => {
    const content = supportedScopemeterModelsPage.renderContent();

    // Documented instrument families
    expect(content).toContain("ScopeMeter 190 Series");
    expect(content).toContain("ScopeMeter 120B Series");
    expect(content).toContain("ScopeMeter MDA-500 Series");
    expect(content).toContain("ScopeMeter Classic Series");
    expect(content).toContain("format- and envelope-driven");

    // Channel configurations
    expect(content).toContain("Single-Channel");
    expect(content).toContain("Dual-Channel");
    expect(content).toContain("Three-Channel");
    expect(content).toContain("Four-Channel");
    expect(content).toContain("Derived Math Channels");

    // Verified parser envelope parameters
    expect(content).toContain("500 samples");
    expect(content).toContain("250,000 samples");
    expect(content).toContain("1.0 ns/div");
    expect(content).toContain("120.0 s/div");
    expect(content).toContain("Physical Channel Decoding");
    expect(content).toContain("Derived Channel Decoding");
    expect(content).toContain("fixed-point");
  });

  it("links to the viewer at / (AC4)", () => {
    const content = supportedScopemeterModelsPage.renderContent();
    expect(content).toContain('href="/"');
    expect(content).toContain("Open the viewer");
  });

  it("enforces no-Fluke-targeting constraint: no Fluke or FlukeView in metadata or body headings (AC3)", () => {
    const meta = supportedScopemeterModelsPage.meta;
    expect(meta.title.toLowerCase()).not.toContain("fluke");
    expect(meta.description.toLowerCase()).not.toContain("fluke");

    const content = supportedScopemeterModelsPage.renderContent();
    const headings = content.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi) ?? [];
    for (const heading of headings) {
      expect(heading.toLowerCase()).not.toContain("fluke");
    }
  });

  it("renders the verbatim contractual trademark disclaimer in the footer", () => {
    const html = renderStaticLayout({
      meta: supportedScopemeterModelsPage.meta,
      contentHtml: supportedScopemeterModelsPage.renderContent(),
    });

    expect(html).toContain(SITE_DISCLAIMER);
    expect(html).toContain(
      "fvf • viewer is not affiliated with, endorsed by, or sponsored by Fluke Corporation. Fluke and ScopeMeter are registered trademarks of Fluke Corporation.",
    );
  });
});

describe("the .fvf file format static page (issue #301)", () => {
  it("registers /fvf-file-format/ in static pages registry with navLabel", () => {
    const page = getStaticPage("fvf-file-format");
    expect(page).toBeDefined();
    expect(page?.meta.slug).toBe("fvf-file-format");
    expect(page?.meta.navLabel).toBe("File Format");
    expect(staticPages.some((p) => p.meta.slug === "fvf-file-format")).toBe(
      true,
    );
  });

  it("renders a complete standalone HTML document without app bundle scripts (AC1)", () => {
    const html = renderStaticLayout({
      meta: fvfFileFormatPage.meta,
      contentHtml: fvfFileFormatPage.renderContent(),
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain(
      "<title>The .fvf File Format Technical Overview — FVF Viewer</title>",
    );
    expect(html).toMatch(
      /<link\s+rel="canonical"\s+href="https:\/\/fvf-viewer\.com\/fvf-file-format\/"\s*\/?>/,
    );
    expect(html).not.toContain('<div id="root">');
    expect(html).not.toContain('src="/src/main.tsx"');
  });

  it("contains softened technical format facts and interoperability disclaimer (AC1, AC2, AC3)", () => {
    const content = fvfFileFormatPage.renderContent();

    // Wording reframe & disclaimer (AC1)
    expect(content).toContain(
      "Technical Overview • Parser &amp; Validation Reference",
    );
    expect(content).toContain("Unofficial Interoperability Reference");
    expect(content).toContain("without warranty of completeness");

    // Softened header and sector table descriptions without byte offsets (AC2)
    expect(content).toContain("8-Byte Header Signature");
    expect(content).toContain("Sector Table Validation");
    expect(content).toContain("Grammar-Driven Channel Discovery");
    expect(content).toContain("Contiguous Record Chain");

    // Specific low-level byte offsets, sizes, and internal constants are removed (AC2)
    expect(content).not.toContain("0x1C");
    expect(content).not.toContain("0x40");
    expect(content).not.toContain("0x1A 0x00");
    expect(content).not.toContain("Parameter Block (388 bytes)");
    expect(content).not.toContain("Trailer Block (60+L bytes)");
    expect(content).not.toContain("i32::MAX");
    expect(content).not.toContain("65536.0");

    // Channel topologies & envelope (crates/fvf-wasm/src/records.rs, header.rs)
    expect(content).toContain("500");
    expect(content).toContain("250,000");
    expect(content).toContain("Input A");
    expect(content).toContain("Eingang A");
    expect(content).toContain("Derived Math Channels");

    // Timebase sweep range & normalization (crates/fvf-wasm/src/timebase.rs)
    expect(content).toContain("1.0 ns/div");
    expect(content).toContain("120.0 s/div");
    expect(content).toContain("div");
    expect(content).toContain("Timestamp Reconstruction");

    // Sample decoding (crates/fvf-wasm/src/records.rs, fixed_point.rs)
    expect(content).toContain("IEEE 754 <code>NaN</code>");
    expect(content).toContain("V");
    expect(content).toContain("mV");

    // Error & warning taxonomy (crates/fvf-wasm/src/error.rs, error-taxonomy.json)
    expect(content).toContain("invalid_signature");
    expect(content).toContain("unsupported_capture_version");
    expect(content).toContain("unsupported_capture_variant");
    expect(content).toContain("truncated_capture");
    expect(content).toContain("corrupt_sector_table");
    expect(content).toContain("invalid_timebase_format");
    expect(content).toContain("invalid_timebase_range");
    expect(content).toContain("invalid_time_axis");
    expect(content).toContain("saturated_samples");
    expect(content).toContain("non_standard_timebase");
    expect(content).toContain("unknown_unit");
    expect(content).toContain("unknown_record");
    expect(content).toContain("unclassified_tag");
  });

  it("links to the viewer at / and the GitHub repository (AC4)", () => {
    const content = fvfFileFormatPage.renderContent();
    expect(content).toContain('href="/"');
    expect(content).toContain("Open the viewer");
    expect(content).toContain(
      'href="https://github.com/openscope-ai/fvf-viewer"',
    );

    const html = renderStaticLayout({
      meta: fvfFileFormatPage.meta,
      contentHtml: content,
    });
    // Header navigation links to all registered static pages
    expect(html).toContain('href="/open-fvf-file/"');
    expect(html).toContain('href="/supported-scopemeter-models/"');
    expect(html).toContain('href="/fvf-file-format/"');
    expect(html).toContain('href="https://github.com/openscope-ai/fvf-viewer"');
  });

  it("enforces no-Fluke-targeting constraint: no Fluke or FlukeView in metadata or body headings (AC3)", () => {
    const meta = fvfFileFormatPage.meta;
    expect(meta.title.toLowerCase()).not.toContain("fluke");
    expect(meta.description.toLowerCase()).not.toContain("fluke");

    const content = fvfFileFormatPage.renderContent();
    const headings = content.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi) ?? [];
    for (const heading of headings) {
      expect(heading.toLowerCase()).not.toContain("fluke");
    }
  });

  it("renders the verbatim contractual trademark disclaimer in the footer", () => {
    const html = renderStaticLayout({
      meta: fvfFileFormatPage.meta,
      contentHtml: fvfFileFormatPage.renderContent(),
    });

    expect(html).toContain(SITE_DISCLAIMER);
    expect(html).toContain(
      "fvf • viewer is not affiliated with, endorsed by, or sponsored by Fluke Corporation. Fluke and ScopeMeter are registered trademarks of Fluke Corporation.",
    );
  });
});

describe("FAQ static page with FAQPage JSON-LD (issue #302)", () => {
  it("registers /faq/ in static pages registry with navLabel", () => {
    const page = getStaticPage("faq");
    expect(page).toBeDefined();
    expect(page?.meta.slug).toBe("faq");
    expect(page?.meta.navLabel).toBe("FAQ");
    expect(staticPages.some((p) => p.meta.slug === "faq")).toBe(true);
  });

  it("renders a complete standalone HTML document without app bundle scripts (AC1)", () => {
    const html = renderStaticLayout({
      meta: faqPage.meta,
      contentHtml: faqPage.renderContent(),
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain(
      "<title>Frequently Asked Questions (FAQ) — FVF Viewer</title>",
    );
    expect(html).toMatch(
      /<link\s+rel="canonical"\s+href="https:\/\/fvf-viewer\.com\/faq\/"\s*\/?>/,
    );
    expect(html).not.toContain('<div id="root">');
    expect(html).not.toContain('src="/src/main.tsx"');
  });

  it("covers required topics: privacy/no-upload, browser/viewport, CSV/PNG export, corrupt files, sample capture (AC2, AC3)", () => {
    const content = faqPage.renderContent();

    // 1. Privacy / zero-upload
    expect(content).toContain(
      "Does FVF Viewer upload my .fvf files to a server?",
    );
    expect(content).toContain("client-side in your browser");
    expect(content).toContain("WebAssembly");
    expect(content).toContain("never uploaded");

    // 2. Browser & viewport requirements
    expect(content).toContain(
      "What screen size and browser are required to use FVF Viewer?",
    );
    expect(content).toContain("1024 pixels");
    expect(content).toContain("rotate your device");

    // 3. CSV and PNG export
    expect(content).toContain(
      "Can I export waveform data and snapshots from FVF Viewer?",
    );
    expect(content).toContain("CSV");
    expect(content).toContain("PNG");
    expect(content).toContain("delimiters");

    // 4. Corrupt or unsupported files
    expect(content).toContain(
      "What happens if my .fvf file is corrupt, truncated, or unsupported?",
    );
    expect(content).toContain("8-byte header signature");
    expect(content).not.toContain("FV.FVF");
    expect(content).toContain("invalid_signature");
    expect(content).toContain("truncated_capture");
    expect(content).toContain("invalid_timebase_range");

    // 5. Sample capture
    expect(content).toContain(
      "Can I try FVF Viewer without having a ScopeMeter .fvf file?",
    );
    expect(content).toContain(
      "Test fvf • viewer with a 20k sample synthetic capture",
    );
    expect(content).toContain("20,000-sample ScopeMeter waveform");
  });

  it("embeds valid FAQPage JSON-LD matching the visible page text (AC4)", () => {
    const jsonLd = faqPage.meta.jsonLd as {
      "@context": string;
      "@type": string;
      mainEntity: Array<{
        "@type": string;
        name: string;
        acceptedAnswer: {
          "@type": string;
          text: string;
        };
      }>;
    };

    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("FAQPage");
    expect(Array.isArray(jsonLd.mainEntity)).toBe(true);
    expect(jsonLd.mainEntity.length).toBeGreaterThanOrEqual(5);

    const html = renderStaticLayout({
      meta: faqPage.meta,
      contentHtml: faqPage.renderContent(),
    });

    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain('"@type": "FAQPage"');

    // Each JSON-LD question and answer must match visible page content
    const content = faqPage.renderContent();
    for (const entity of jsonLd.mainEntity) {
      expect(entity["@type"]).toBe("Question");
      expect(entity.acceptedAnswer["@type"]).toBe("Answer");
      expect(content).toContain(entity.name);
      // Clean up HTML tags and normalize whitespace for exact correspondence check
      const strippedContent = content
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ");
      const normalizedAnswer = entity.acceptedAnswer.text.replace(/\s+/g, " ");
      expect(strippedContent).toContain(normalizedAnswer);
    }
  });

  it("links to the viewer at / and uses the shared styled cta-section (AC5)", () => {
    const content = faqPage.renderContent();
    expect(content).toContain('href="/"');
    expect(content).toContain("Open the viewer");
    expect(content).toContain('class="cta-section"');
    expect(content).not.toContain("cta-box");

    const html = renderStaticLayout({
      meta: faqPage.meta,
      contentHtml: content,
    });
    // Header navigation links to all registered static pages
    expect(html).toContain('href="/open-fvf-file/"');
    expect(html).toContain('href="/supported-scopemeter-models/"');
    expect(html).toContain('href="/fvf-file-format/"');
    expect(html).toContain('href="/faq/"');
  });

  it("enforces no-Fluke-targeting constraint: no Fluke or FlukeView in metadata, headings, or FAQ text (AC5)", () => {
    const meta = faqPage.meta;
    expect(meta.title.toLowerCase()).not.toContain("fluke");
    expect(meta.description.toLowerCase()).not.toContain("fluke");

    const content = faqPage.renderContent();
    const headings = content.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi) ?? [];
    for (const heading of headings) {
      expect(heading.toLowerCase()).not.toContain("fluke");
    }

    // In visible text (outside contractual footer disclaimer)
    expect(content.toLowerCase()).not.toContain("fluke");
  });

  it("renders the verbatim contractual trademark disclaimer in the footer", () => {
    const html = renderStaticLayout({
      meta: faqPage.meta,
      contentHtml: faqPage.renderContent(),
    });

    expect(html).toContain(SITE_DISCLAIMER);
    expect(html).toContain(
      "fvf • viewer is not affiliated with, endorsed by, or sponsored by Fluke Corporation. Fluke and ScopeMeter are registered trademarks of Fluke Corporation.",
    );
  });
});

describe("discovery plumbing: robots.txt, sitemap.xml, llms.txt, structured data (issue #303)", () => {
  const publicDir = path.resolve(__dirname, "../../public");

  it("exports valid WebApplication JSON-LD schema (AC4)", () => {
    expect(webApplicationJsonLd["@context"]).toBe("https://schema.org");
    expect(webApplicationJsonLd["@type"]).toBe("WebApplication");
    expect(webApplicationJsonLd.name).toBe("FVF Viewer");
    expect(webApplicationJsonLd.url).toBe("https://fvf-viewer.com/");
    expect(webApplicationJsonLd.license).toBe(
      "https://opensource.org/licenses/MIT",
    );
    expect(webApplicationJsonLd.isAccessibleForFree).toBe(true);
    expect(webApplicationJsonLd.sameAs).toContain(
      "https://github.com/openscope-ai/fvf-viewer",
    );
    expect(webApplicationJsonLd.browserRequirements).toContain("1024 pixels");
  });

  it("embeds WebApplication JSON-LD in all rendered static pages (AC4)", () => {
    for (const page of staticPages) {
      const html = renderStaticLayout({
        meta: page.meta,
        contentHtml: page.renderContent(),
      });
      expect(html).toContain('"@type": "WebApplication"');
      expect(html).toContain('"name": "FVF Viewer"');
      expect(html).toContain(
        '"sameAs": [\n    "https://github.com/openscope-ai/fvf-viewer"\n  ]',
      );
    }
  });

  it("verifies public robots.txt allows search engines and major AI crawlers and references sitemap (AC1)", () => {
    const robotsPath = path.join(publicDir, "robots.txt");
    const robots = readFileSync(robotsPath, "utf8");

    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    expect(robots).toContain("User-agent: GPTBot");
    expect(robots).toContain("User-agent: ClaudeBot");
    expect(robots).toContain("User-agent: PerplexityBot");
    expect(robots).toContain("User-agent: Google-Extended");
    expect(robots).toContain("User-agent: Applebot-Extended");
    expect(robots).toContain("Sitemap: https://fvf-viewer.com/sitemap.xml");
  });

  it("verifies public sitemap.xml lists homepage and all static pages with canonical URLs (AC2)", () => {
    const sitemapPath = path.join(publicDir, "sitemap.xml");
    const sitemap = readFileSync(sitemapPath, "utf8");

    expect(sitemap).toContain(
      'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    );
    expect(sitemap).toContain("<loc>https://fvf-viewer.com/</loc>");
    expect(sitemap).toContain(
      "<loc>https://fvf-viewer.com/open-fvf-file/</loc>",
    );
    expect(sitemap).toContain(
      "<loc>https://fvf-viewer.com/supported-scopemeter-models/</loc>",
    );
    expect(sitemap).toContain(
      "<loc>https://fvf-viewer.com/fvf-file-format/</loc>",
    );
    expect(sitemap).toContain("<loc>https://fvf-viewer.com/faq/</loc>");

    // Check all registered slugs in staticPages are in sitemap
    for (const page of staticPages) {
      expect(sitemap).toContain(`https://fvf-viewer.com/${page.meta.slug}/`);
    }
  });

  it("verifies public llms.txt provides factual summary, capabilities, privacy model, and links (AC5)", () => {
    const llmsPath = path.join(publicDir, "llms.txt");
    const llms = readFileSync(llmsPath, "utf8");

    expect(llms).toContain("# FVF Viewer");
    expect(llms).toContain("ScopeMeter .fvf waveform capture files");
    expect(llms).toContain("## Core Capabilities");
    expect(llms).toContain("In-browser decoding");
    expect(llms).toContain("Multi-channel canvas");
    expect(llms).toContain("dual measurement cursors");
    expect(llms).toContain("Lossless data export");
    expect(llms).toContain("## Privacy & Security Architecture");
    expect(llms).toContain("100% Client-Side Execution");
    expect(llms).toContain("Zero Server Transmission");
    expect(llms).toContain("## Key Links & Documentation");
    expect(llms).toContain("https://fvf-viewer.com/");
    expect(llms).toContain("https://fvf-viewer.com/open-fvf-file/");
    expect(llms).toContain(
      "https://fvf-viewer.com/supported-scopemeter-models/",
    );
    expect(llms).toContain("https://fvf-viewer.com/fvf-file-format/");
    expect(llms).toContain("https://fvf-viewer.com/faq/");
    expect(llms).toContain("https://github.com/openscope-ai/fvf-viewer");

    // Strictly no Fluke targeting
    expect(llms.toLowerCase()).not.toContain("fluke");
  });
});
