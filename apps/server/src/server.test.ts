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
