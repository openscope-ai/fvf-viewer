import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server";
import type { FastifyInstance } from "fastify";

const VERSION = "0.0.0-test";

let staticRoot: string;
let app: FastifyInstance;

// >1 KB so @fastify/compress's threshold applies.
const indexHtml = `<!doctype html><html lang="en"><head><title>fvf • viewer</title></head><body><div id="root">${"x".repeat(2048)}</div></body></html>`;

beforeAll(async () => {
  staticRoot = mkdtempSync(path.join(tmpdir(), "fvf-server-test-"));
  writeFileSync(path.join(staticRoot, "index.html"), indexHtml);
  const assets = path.join(staticRoot, "assets");
  mkdirSync(assets);
  writeFileSync(
    path.join(assets, "app-abc123.js"),
    `console.log("bundled");${"\n".repeat(64)}`,
  );
  const openFvfDir = path.join(staticRoot, "open-fvf-file");
  mkdirSync(openFvfDir);
  writeFileSync(
    path.join(openFvfDir, "index.html"),
    `<!doctype html><html lang="en"><head><title>How to Open a .fvf File in Your Browser — FVF Viewer</title><meta name="description" content="Open, inspect, and analyze .fvf waveform capture files from ScopeMeter instruments directly in your browser."><link rel="canonical" href="https://fvf-viewer.com/open-fvf-file/"></head><body><h1>How to Open a .fvf File in Your Browser</h1><p>A .fvf file is a binary waveform capture.</p><a href="/">Open the viewer</a></body></html>`,
  );
  const modelsDir = path.join(staticRoot, "supported-scopemeter-models");
  mkdirSync(modelsDir);
  writeFileSync(
    path.join(modelsDir, "index.html"),
    `<!doctype html><html lang="en"><head><title>Supported ScopeMeter Models &amp; .fvf Channel Configurations — FVF Viewer</title><meta name="description" content="Explore supported ScopeMeter test instrument models, 1-channel to 4-channel configurations, and binary waveform envelopes compatible with FVF Viewer."><link rel="canonical" href="https://fvf-viewer.com/supported-scopemeter-models/"></head><body><h1>Supported ScopeMeter Models</h1><p>ScopeMeter 190 Series, 120B Series, MDA-500 Series</p><a href="/">Open the viewer</a></body></html>`,
  );
  const fvfDir = path.join(staticRoot, "fvf-file-format");
  mkdirSync(fvfDir);
  writeFileSync(
    path.join(fvfDir, "index.html"),
    `<!doctype html><html lang="en"><head><title>The .fvf File Format Technical Reference — FVF Viewer</title><meta name="description" content="Technical breakdown of the binary .fvf (FVF) ScopeMeter waveform capture format."><link rel="canonical" href="https://fvf-viewer.com/fvf-file-format/"></head><body><h1>The .fvf File Format Technical Reference</h1><p>Binary .fvf waveform capture format specification.</p><a href="/">Open the viewer</a></body></html>`,
  );
  const faqDir = path.join(staticRoot, "faq");
  mkdirSync(faqDir);
  writeFileSync(
    path.join(faqDir, "index.html"),
    `<!doctype html><html lang="en"><head><title>Frequently Asked Questions (FAQ) — FVF Viewer</title><meta name="description" content="Frequently asked questions about FVF Viewer."><link rel="canonical" href="https://fvf-viewer.com/faq/"><script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[]}</script></head><body><h1>Frequently Asked Questions</h1><p>Privacy and export details.</p><a href="/">Open the viewer</a></body></html>`,
  );
  writeFileSync(
    path.join(staticRoot, "share-image.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  writeFileSync(
    path.join(staticRoot, "robots.txt"),
    `# robots.txt for https://fvf-viewer.com\nUser-agent: *\nAllow: /\n\nUser-agent: GPTBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\nSitemap: https://fvf-viewer.com/sitemap.xml\n`,
  );
  writeFileSync(
    path.join(staticRoot, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://fvf-viewer.com/</loc></url>\n  <url><loc>https://fvf-viewer.com/open-fvf-file/</loc></url>\n  <url><loc>https://fvf-viewer.com/supported-scopemeter-models/</loc></url>\n  <url><loc>https://fvf-viewer.com/fvf-file-format/</loc></url>\n  <url><loc>https://fvf-viewer.com/faq/</loc></url>\n</urlset>`,
  );
  writeFileSync(
    path.join(staticRoot, "llms.txt"),
    `# FVF Viewer\n\n> Free, fast, private in-browser viewer for ScopeMeter .fvf waveform capture files.\n\nFVF Viewer (https://fvf-viewer.com/) is an open-source, client-side engineering tool.\n\n## Core Capabilities\n- In-browser decoding\n- Zero Server Transmission\n`,
  );
  app = await buildServer({ version: VERSION, staticRoot, logLevel: "silent" });
});

afterAll(async () => {
  await app.close();
  rmSync(staticRoot, { recursive: true, force: true });
});

describe("static SPA serving (AC1)", () => {
  it("serves index.html at the root", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain('<div id="root">');
  });

  it("serves hashed assets from the build output", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/assets/app-abc123.js",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("javascript");
  });

  it("falls back to index.html for unknown deep links", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/capture/recent/some-deep-link",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain('<div id="root">');
  });

  it("returns JSON 404 for unknown /api routes instead of the SPA shell", async () => {
    const res = await app.inject({ method: "GET", url: "/api/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("serves static HTML pages ahead of the SPA fallback (issue #298)", async () => {
    const res = await app.inject({ method: "GET", url: "/open-fvf-file/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("How to Open a .fvf File in Your Browser");
    expect(res.body).toContain(
      '<link rel="canonical" href="https://fvf-viewer.com/open-fvf-file/">',
    );
    expect(res.body).toContain('<a href="/">Open the viewer</a>');
    // Ships no app bundle / React root takeover
    expect(res.body).not.toContain('<div id="root">');
  });

  it("redirects static page requests missing a trailing slash with 308 (issue #298)", async () => {
    const res = await app.inject({ method: "GET", url: "/open-fvf-file" });
    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe("/open-fvf-file/");
  });

  it("preserves query strings when redirecting static page requests missing trailing slashes (F3)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/open-fvf-file?utm_source=test&foo=bar",
    });
    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe(
      "/open-fvf-file/?utm_source=test&foo=bar",
    );
  });

  it("serves share-image.png with image/png (issue #299)", async () => {
    const res = await app.inject({ method: "GET", url: "/share-image.png" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.rawPayload.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it("serves /supported-scopemeter-models/ ahead of SPA fallback (issue #300)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/supported-scopemeter-models/",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Supported ScopeMeter Models");
    expect(res.body).toContain(
      '<link rel="canonical" href="https://fvf-viewer.com/supported-scopemeter-models/">',
    );
    expect(res.body).toContain('<a href="/">Open the viewer</a>');
    expect(res.body).not.toContain('<div id="root">');
  });

  it("redirects /supported-scopemeter-models missing trailing slash with 308 (issue #300)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/supported-scopemeter-models",
    });
    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe("/supported-scopemeter-models/");
  });

  it("serves /fvf-file-format/ ahead of SPA fallback (issue #301)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/fvf-file-format/",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("The .fvf File Format Technical Reference");
    expect(res.body).toContain(
      '<link rel="canonical" href="https://fvf-viewer.com/fvf-file-format/">',
    );
    expect(res.body).toContain('<a href="/">Open the viewer</a>');
    expect(res.body).not.toContain('<div id="root">');
  });

  it("redirects /fvf-file-format missing trailing slash with 308 (issue #301)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/fvf-file-format",
    });
    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe("/fvf-file-format/");
  });

  it("serves /faq/ ahead of SPA fallback (issue #302)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/faq/",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Frequently Asked Questions");
    expect(res.body).toContain(
      '<link rel="canonical" href="https://fvf-viewer.com/faq/">',
    );
    expect(res.body).toContain('type="application/ld+json"');
    expect(res.body).toContain('"@type":"FAQPage"');
    expect(res.body).toContain('<a href="/">Open the viewer</a>');
    expect(res.body).not.toContain('<div id="root">');
  });

  it("redirects /faq missing trailing slash with 308 (issue #302)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/faq",
    });
    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe("/faq/");
  });

  it("serves robots.txt with text/plain ahead of SPA fallback (issue #303)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/robots.txt",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain("User-agent: *");
    expect(res.body).toContain("User-agent: GPTBot");
    expect(res.body).toContain("User-agent: ClaudeBot");
    expect(res.body).toContain("User-agent: PerplexityBot");
    expect(res.body).toContain("Sitemap: https://fvf-viewer.com/sitemap.xml");
    expect(res.body).not.toContain('<div id="root">');
  });

  it("serves sitemap.xml with application/xml ahead of SPA fallback (issue #303)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/sitemap.xml",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/xml");
    expect(res.body).toContain("<urlset");
    expect(res.body).toContain("https://fvf-viewer.com/");
    expect(res.body).toContain("https://fvf-viewer.com/open-fvf-file/");
    expect(res.body).toContain(
      "https://fvf-viewer.com/supported-scopemeter-models/",
    );
    expect(res.body).toContain("https://fvf-viewer.com/fvf-file-format/");
    expect(res.body).toContain("https://fvf-viewer.com/faq/");
    expect(res.body).not.toContain('<div id="root">');
  });

  it("serves llms.txt with text/plain ahead of SPA fallback (issue #303)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/llms.txt",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain("FVF Viewer");
    expect(res.body).toContain("ScopeMeter .fvf");
    expect(res.body).toContain("Zero Server Transmission");
    expect(res.body).not.toContain('<div id="root">');
  });
});

describe("/api/health (AC2)", () => {
  it("returns 200 with version and uptime", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const body = res.json() as {
      status: string;
      version: string;
      uptimeSeconds: number;
    };
    expect(body.status).toBe("ok");
    expect(body.version).toBe(VERSION);
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe("security headers (AC3)", () => {
  it("sets HSTS on responses", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.headers["strict-transport-security"]).toContain(
      "max-age=31536000",
    );
    expect(res.headers["strict-transport-security"]).toContain(
      "includeSubDomains",
    );
  });

  it("sets a CSP that allows the SPA's own wasm, worker, and styling needs", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    const csp = res.headers["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("sets nosniff and no legacy framing allowance", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeUndefined();
  });
});

describe("compression", () => {
  it("compresses large HTML responses with brotli when accepted", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/",
      headers: { "accept-encoding": "br, gzip" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-encoding"]).toBe("br");
  });

  it("compresses with gzip when brotli is not accepted", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/",
      headers: { "accept-encoding": "gzip" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
  });
});

describe("Umami analytics proxy and fallback (issue #277)", () => {
  it("returns 404 for /stats/script.js when umamiWebsiteId is absent", async () => {
    const res = await app.inject({ method: "GET", url: "/stats/script.js" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json()).toEqual({ error: "not_found" });
  });

  it("returns 404 for /stats/api/send when umamiWebsiteId is absent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/stats/api/send",
      payload: { type: "event", payload: { website: "x" } },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json()).toEqual({ error: "not_found" });
  });

  it("does not inject umami-website-id meta tag when umamiWebsiteId is absent", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('name="umami-website-id"');
  });

  describe("when umamiWebsiteId is configured", () => {
    let analyticsApp: FastifyInstance;
    const testWebsiteId = "11111111-2222-3333-4444-555555555555";
    const testHost = "https://mock-umami.invalid";

    beforeAll(async () => {
      analyticsApp = await buildServer({
        version: VERSION,
        staticRoot,
        logLevel: "silent",
        umamiWebsiteId: testWebsiteId,
        umamiHost: testHost,
        scriptCacheTtlMs: 0,
      });
    });

    afterAll(async () => {
      await analyticsApp.close();
    });

    it("injects umami-website-id meta tag into index.html without violating CSP", async () => {
      const res = await analyticsApp.inject({ method: "GET", url: "/" });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(
        `<meta name="umami-website-id" content="${testWebsiteId}">`,
      );
      // CSP still retains strictly 'self'
      const csp = res.headers["content-security-policy"] ?? "";
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).not.toContain("mock-umami.invalid");
    });

    it("proxies GET /stats/script.js from Umami Cloud", async () => {
      const mockScriptContent = "/* umami client script */";
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(mockScriptContent, {
          status: 200,
          headers: { "content-type": "application/javascript" },
        }),
      );

      try {
        const res = await analyticsApp.inject({
          method: "GET",
          url: "/stats/script.js",
        });
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toContain("application/javascript");
        expect(res.headers["cache-control"]).toContain("public");
        expect(res.body).toBe(mockScriptContent);
        expect(fetchSpy).toHaveBeenCalledWith(`${testHost}/script.js`);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it("proxies GET /stats/script.js without truncation when client requests compression (issue #295)", async () => {
      // 4,810 bytes matches real Umami script size, triggering @fastify/compress (>1,024 byte threshold)
      const mockScriptContent = "console.log('umami-tracking');\n".repeat(160);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(mockScriptContent, {
          status: 200,
          headers: { "content-type": "application/javascript" },
        }),
      );

      try {
        const res = await analyticsApp.inject({
          method: "GET",
          url: "/stats/script.js",
          headers: {
            "accept-encoding": "gzip, deflate, br",
          },
        });
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toContain("application/javascript");
        expect(res.headers["content-encoding"]).toBeDefined();
        // Regression check: payload must not be truncated to 0 bytes
        expect(res.rawPayload.length).toBeGreaterThan(0);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it("caches upstream script in memory when scriptCacheTtlMs is enabled (AC3)", async () => {
      const cachingApp = await buildServer({
        version: VERSION,
        staticRoot,
        logLevel: "silent",
        umamiWebsiteId: testWebsiteId,
        umamiHost: testHost,
        scriptCacheTtlMs: 60_000,
      });

      const mockScript = "console.log('cached-script');";
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(mockScript, {
          status: 200,
          headers: { "content-type": "application/javascript" },
        }),
      );

      try {
        const res1 = await cachingApp.inject({
          method: "GET",
          url: "/stats/script.js",
        });
        const res2 = await cachingApp.inject({
          method: "GET",
          url: "/stats/script.js",
        });
        expect(res1.statusCode).toBe(200);
        expect(res1.body).toBe(mockScript);
        expect(res2.statusCode).toBe(200);
        expect(res2.body).toBe(mockScript);
        // Only 1 upstream fetch should have been made
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      } finally {
        fetchSpy.mockRestore();
        await cachingApp.close();
      }
    });

    it("proxies POST /stats/api/send and forwards client headers", async () => {
      let forwardedUrl = "";
      let forwardedHeaders: Headers | undefined;
      let forwardedBody = "";

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementationOnce(async (input, init) => {
          forwardedUrl = String(input);
          forwardedHeaders = new Headers(init?.headers);
          forwardedBody = String(init?.body);
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        });

      try {
        const payload = {
          type: "event",
          payload: { website: testWebsiteId, name: "export_csv" },
        };
        const res = await analyticsApp.inject({
          method: "POST",
          url: "/stats/api/send",
          headers: {
            "user-agent": "Mozilla/5.0 TestBrowser",
            "x-forwarded-for": "198.51.100.1",
          },
          payload,
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true });
        expect(forwardedUrl).toBe(`${testHost}/api/send`);
        expect(forwardedHeaders?.get("user-agent")).toBe(
          "Mozilla/5.0 TestBrowser",
        );
        expect(forwardedHeaders?.get("x-forwarded-for")).toBe("198.51.100.1");
        expect(JSON.parse(forwardedBody)).toEqual(payload);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it("handles upstream failure on GET /stats/script.js gracefully", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValueOnce(new Error("Network failure"));

      try {
        const res = await analyticsApp.inject({
          method: "GET",
          url: "/stats/script.js",
        });
        expect(res.statusCode).toBe(502);
        expect(res.json()).toEqual({ error: "upstream_unavailable" });
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });
});
