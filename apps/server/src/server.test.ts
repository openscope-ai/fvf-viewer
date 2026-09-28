import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
