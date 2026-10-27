/**
 * Server integration E2E (issue #23): the suite runs against the production
 * server (`node apps/server` serving the built SPA) and asserts the server
 * behaviors added in the #20 session: `/api/health` reports the released
 * version, deep-link routes return the SPA shell, and unknown `/api/*`
 * routes return a JSON 404.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./support";

const serverPackageJson = path.resolve(
  fileURLToPath(new URL("../../../apps/server/package.json", import.meta.url)),
);
const releasedVersion = (
  JSON.parse(readFileSync(serverPackageJson, "utf8")) as { version: string }
).version;

test("GET /api/health returns 200 with status ok and the released version", async ({
  request,
}) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");

  const body = (await response.json()) as { status?: string; version?: string };
  expect(body.status).toBe("ok");
  expect(body.version).toBe(releasedVersion);
});

test("GET /api/health reports monotonically increasing uptime between calls", async ({
  request,
}) => {
  const first = await request.get("/api/health");
  const second = await request.get("/api/health");
  const uptimeA = (await first.json()) as { uptimeSeconds?: number };
  const uptimeB = (await second.json()) as { uptimeSeconds?: number };
  expect((uptimeB.uptimeSeconds ?? 0) >= (uptimeA.uptimeSeconds ?? 0)).toBe(
    true,
  );
});

test("GET /open-fvf-file/ returns the static guide page ahead of SPA fallback", async ({
  request,
}) => {
  const response = await request.get("/open-fvf-file/");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/html");

  const html = await response.text();
  expect(html).toContain("How to Open a .fvf File in Your Browser");
  expect(html).toContain('href="/"');
  // Does not mount React root
  expect(html).not.toContain('<div id="root">');
});

test("GET /supported-scopemeter-models/ returns static page with models content ahead of SPA fallback (issue #300)", async ({
  request,
}) => {
  const response = await request.get("/supported-scopemeter-models/");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/html");

  const html = await response.text();
  expect(html).toContain(
    "Supported ScopeMeter Models &amp; Waveform Envelopes",
  );
  expect(html).toContain("ScopeMeter 190 Series");
  expect(html).toContain("ScopeMeter 120B Series");
  expect(html).toContain("ScopeMeter MDA-500 Series");
  expect(html).toContain("ScopeMeter Classic Series");
  expect(html).toContain("format- and envelope-driven");
  expect(html).toContain("Physical Channel Decoding");
  expect(html).toContain('href="/"');
  expect(html).toContain("Open the viewer");
  expect(html).toMatch(
    /<link\s+rel=["']canonical["']\s+href=["']https:\/\/fvf-viewer\.com\/supported-scopemeter-models\/["']\s*\/?>/,
  );
  // Does not mount React root
  expect(html).not.toContain('<div id="root">');

  // No Fluke or FlukeView targeting terms in head metadata
  const headMatch = html.match(/<head>([\s\S]*?)<\/head>/i);
  const headContent = headMatch?.[1] ?? "";
  expect(headContent).not.toMatch(/Fluke/i);
  expect(headContent).not.toMatch(/FlukeView/i);
});

test("GET /supported-scopemeter-models redirects to /supported-scopemeter-models/ with 308 (issue #300)", async ({
  request,
}) => {
  const response = await request.get("/supported-scopemeter-models", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(308);
  expect(response.headers()["location"]).toBe("/supported-scopemeter-models/");
});

test("GET /fvf-file-format/ returns static technical reference page ahead of SPA fallback (issue #301)", async ({
  request,
}) => {
  const response = await request.get("/fvf-file-format/");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/html");

  const html = await response.text();
  expect(html).toContain("The .fvf File Format Technical Overview");
  expect(html).toContain("Sector Table");
  expect(html).toContain("Timebase Validation");
  expect(html).toContain("Physical Analog Channels");
  expect(html).toContain("FvfError Codes");
  expect(html).toContain('href="/"');
  expect(html).toContain("Open the viewer");
  expect(html).toContain('href="https://github.com/openscope-ai/fvf-viewer"');
  expect(html).toMatch(
    /<link\s+rel=["']canonical["']\s+href=["']https:\/\/fvf-viewer\.com\/fvf-file-format\/["']\s*\/?>/,
  );
  // Does not mount React root
  expect(html).not.toContain('<div id="root">');

  // No Fluke or FlukeView targeting terms in head metadata
  const headMatch = html.match(/<head>([\s\S]*?)<\/head>/i);
  const headContent = headMatch?.[1] ?? "";
  expect(headContent).not.toMatch(/Fluke/i);
  expect(headContent).not.toMatch(/FlukeView/i);
});

test("GET /fvf-file-format redirects to /fvf-file-format/ with 308 (issue #301)", async ({
  request,
}) => {
  const response = await request.get("/fvf-file-format", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(308);
  expect(response.headers()["location"]).toBe("/fvf-file-format/");
});

test("GET /faq/ returns static FAQ page with FAQPage JSON-LD ahead of SPA fallback (issue #302)", async ({
  request,
}) => {
  const response = await request.get("/faq/");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/html");

  const html = await response.text();
  expect(html).toContain("Frequently Asked Questions");
  expect(html).toContain("Does FVF Viewer upload my .fvf files to a server?");
  expect(html).toContain(
    "What screen size and browser are required to use FVF Viewer?",
  );
  expect(html).toContain(
    "Can I export waveform data and snapshots from FVF Viewer?",
  );
  expect(html).toContain(
    "What happens if my .fvf file is corrupt, truncated, or unsupported?",
  );
  expect(html).toContain(
    "Can I try FVF Viewer without having a ScopeMeter .fvf file?",
  );
  expect(html).toContain("1024 pixels");
  expect(html).toContain('href="/"');
  expect(html).toContain("Open the viewer");
  expect(html).toMatch(
    /<link\s+rel=["']canonical["']\s+href=["']https:\/\/fvf-viewer\.com\/faq\/["']\s*\/?>/,
  );
  expect(html).toContain('type="application/ld+json"');
  expect(html).toContain('"@type": "FAQPage"');

  // Does not mount React root
  expect(html).not.toContain('<div id="root">');

  // No Fluke or FlukeView targeting terms in head metadata
  const headMatch = html.match(/<head>([\s\S]*?)<\/head>/i);
  const headContent = headMatch?.[1] ?? "";
  expect(headContent).not.toMatch(/Fluke/i);
  expect(headContent).not.toMatch(/FlukeView/i);
});

test("GET /faq redirects to /faq/ with 308 (issue #302)", async ({
  request,
}) => {
  const response = await request.get("/faq", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(308);
  expect(response.headers()["location"]).toBe("/faq/");
});

test("deep-link route returns the SPA shell, not a 404", async ({
  request,
}) => {
  const response = await request.get("/captures/some/deep-link");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/html");

  const html = await response.text();
  expect(html).toContain('<div id="root">');
});

test("unknown /api/* route returns a JSON 404", async ({ request }) => {
  const response = await request.get("/api/does-not-exist");
  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).toContain("application/json");

  const body = (await response.json()) as { error?: string };
  expect(body.error).toBe("not_found");
});

test("GET / serves discoverability head metadata and noscript note (issue #299)", async ({
  request,
}) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/html");

  const html = await response.text();

  // AC1: title and meta description using .fvf / FVF / ScopeMeter vocabulary
  expect(html).toMatch(
    /<title>FVF Viewer — ScopeMeter \.fvf Waveform Viewer<\/title>/i,
  );
  expect(html).toContain('name="description"');
  expect(html).toContain("ScopeMeter");
  expect(html).toContain(".fvf");

  // No Fluke or FlukeView targeting terms in head metadata
  const headMatch = html.match(/<head>([\s\S]*?)<\/head>/i);
  const headContent = headMatch?.[1] ?? "";
  expect(headContent).not.toMatch(/Fluke/i);
  expect(headContent).not.toMatch(/FlukeView/i);

  // AC2: canonical link to https://fvf-viewer.com/
  expect(html).toMatch(
    /<link\s+rel=["']canonical["']\s+href=["']https:\/\/fvf-viewer\.com\/["']\s*\/?>/,
  );

  // AC3: Open Graph and Twitter card tags referencing 1200x630 share image
  expect(html).toMatch(
    /<meta\s+property=["']og:image["']\s+content=["']https:\/\/fvf-viewer\.com\/share-image\.png["']\s*\/?>/,
  );
  expect(html).toMatch(
    /<meta\s+property=["']og:image:width["']\s+content=["']1200["']\s*\/?>/,
  );
  expect(html).toMatch(
    /<meta\s+property=["']og:image:height["']\s+content=["']630["']\s*\/?>/,
  );
  expect(html).toMatch(
    /<meta\s+name=["']twitter:card["']\s+content=["']summary_large_image["']\s*\/?>/,
  );
  expect(html).toMatch(
    /<meta\s+name=["']twitter:image["']\s+content=["']https:\/\/fvf-viewer\.com\/share-image\.png["']\s*\/?>/,
  );

  // AC4: <noscript> note linking to static guide page
  expect(html).toContain("<noscript>");
  expect(html).toContain('href="/open-fvf-file/"');
  expect(html).toContain("How to Open a .fvf File in Your Browser");
});

test("GET /share-image.png returns 200 with image/png and 1200x630 dimensions (issue #299)", async ({
  request,
}) => {
  const response = await request.get("/share-image.png");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");

  const body = await response.body();
  // Valid PNG signature
  expect(body.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  // IHDR width and height
  const width = body.readUInt32BE(16);
  const height = body.readUInt32BE(20);
  expect(width).toBe(1200);
  expect(height).toBe(630);
});

test("noscript note is not visible to JavaScript-enabled users on / (issue #299)", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".noscript-notice")).toBeHidden();
  await expect(page.locator("#root")).toBeAttached();
});

test("GET /robots.txt returns valid text/plain robots file allowing AI crawlers and referencing sitemap (issue #303)", async ({
  request,
}) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");

  const text = await response.text();
  expect(text).toContain("User-agent: *");
  expect(text).toContain("Allow: /");
  expect(text).toContain("User-agent: GPTBot");
  expect(text).toContain("User-agent: ClaudeBot");
  expect(text).toContain("User-agent: PerplexityBot");
  expect(text).toContain("Sitemap: https://fvf-viewer.com/sitemap.xml");
  expect(text).not.toContain('<div id="root">');
});

test("GET /sitemap.xml returns valid XML listing homepage and all static pages (issue #303)", async ({
  request,
}) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/xml");

  const xml = await response.text();
  expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  expect(xml).toContain("<loc>https://fvf-viewer.com/</loc>");
  expect(xml).toContain("<loc>https://fvf-viewer.com/open-fvf-file/</loc>");
  expect(xml).toContain(
    "<loc>https://fvf-viewer.com/supported-scopemeter-models/</loc>",
  );
  expect(xml).toContain("<loc>https://fvf-viewer.com/fvf-file-format/</loc>");
  expect(xml).toContain("<loc>https://fvf-viewer.com/faq/</loc>");
  expect(xml).not.toContain('<div id="root">');
});

test("GET /llms.txt returns concise summary with key capabilities, zero-upload privacy, and static links (issue #303)", async ({
  request,
}) => {
  const response = await request.get("/llms.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");

  const text = await response.text();
  expect(text).toContain("# FVF Viewer");
  expect(text).toContain("Core Capabilities");
  expect(text).toContain("Privacy & Security Architecture");
  expect(text).toContain("Zero Server Transmission");
  expect(text).toContain("https://fvf-viewer.com/open-fvf-file/");
  expect(text).toContain("https://fvf-viewer.com/supported-scopemeter-models/");
  expect(text).toContain("https://fvf-viewer.com/fvf-file-format/");
  expect(text).toContain("https://fvf-viewer.com/faq/");
  expect(text).toContain("https://github.com/openscope-ai/fvf-viewer");
  expect(text.toLowerCase()).not.toContain("fluke");
  expect(text).not.toContain('<div id="root">');
});

test("served pages include valid WebApplication JSON-LD (issue #303)", async ({
  request,
}) => {
  // Check homepage /
  const homeRes = await request.get("/");
  expect(homeRes.status()).toBe(200);
  const homeHtml = await homeRes.text();
  expect(homeHtml).toContain('type="application/ld+json"');
  expect(homeHtml).toContain('"@type": "WebApplication"');
  expect(homeHtml).toContain('"name": "FVF Viewer"');
  expect(homeHtml).toContain('"url": "https://fvf-viewer.com/"');
  expect(homeHtml).toContain("https://github.com/openscope-ai/fvf-viewer");
  expect(homeHtml).toContain("EngineeringApplication");
  expect(homeHtml).toContain("https://opensource.org/licenses/MIT");

  // Check static page /open-fvf-file/
  const staticRes = await request.get("/open-fvf-file/");
  expect(staticRes.status()).toBe(200);
  const staticHtml = await staticRes.text();
  expect(staticHtml).toContain('type="application/ld+json"');
  expect(staticHtml).toContain('"@type": "WebApplication"');
  expect(staticHtml).toContain('"name": "FVF Viewer"');
  expect(staticHtml).toContain("https://github.com/openscope-ai/fvf-viewer");
});
