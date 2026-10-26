import fastify, { type FastifyInstance } from "fastify";
import compress from "@fastify/compress";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface ServerOptions {
  /** Application version reported by /api/health. */
  version: string;
  /** Directory holding the built Vite SPA (apps/web/dist). */
  staticRoot: string;
  /** Pino log level; pass "silent" to suppress logging (tests). */
  logLevel?: string;
  /** Umami Cloud website ID; when provided, activates /stats/* reverse proxy. */
  umamiWebsiteId?: string;
  /** Umami Cloud upstream host; defaults to https://cloud.umami.is. */
  umamiHost?: string;
  /** In-memory cache TTL for upstream script in milliseconds; defaults to 3,600,000 (1 hour). */
  scriptCacheTtlMs?: number;
}

/**
 * Production server for the FVF Viewer SPA: serves the built Vite bundle with
 * SPA fallback for deep links, exposes /api/health for Cloud Run probes, and
 * applies security headers (HSTS, CSP) plus gzip/brotli compression.
 */
export async function buildServer(
  options: ServerOptions,
): Promise<FastifyInstance> {
  const app = fastify({
    logger: { level: options.logLevel ?? "info" },
    // TLS and client IPs are terminated at the load balancer (Cloud Run).
    trustProxy: true,
  });

  await app.register(helmet, {
    // Long-lived HSTS: Cloud Run serves TLS at the edge.
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
    // frame-ancestors 'none' covers framing; drop the legacy header to avoid mixed signals.
    frameguard: false,
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // fvf-wasm is instantiated via WebAssembly.instantiate.
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        // Vite emits no inline scripts; index.html carries one inline <style> block.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  });

  await app.register(compress, { encodings: ["br", "gzip"] });

  const startedAt = process.uptime();
  app.get("/api/health", async () => ({
    status: "ok",
    version: options.version,
    uptimeSeconds: Math.round((process.uptime() - startedAt) * 1000) / 1000,
  }));

  const umamiWebsiteId = options.umamiWebsiteId;
  const umamiHost = (options.umamiHost ?? "https://cloud.umami.is").replace(
    /\/+$/,
    "",
  );

  if (umamiWebsiteId) {
    let cachedScript: { text: string; expiresAt: number } | null = null;
    const scriptCacheTtlMs = options.scriptCacheTtlMs ?? 3_600_000; // 1 hour default

    app.get("/stats/script.js", async (_request, reply) => {
      try {
        let scriptText: string;
        const now = Date.now();
        if (cachedScript && now < cachedScript.expiresAt) {
          scriptText = cachedScript.text;
        } else {
          const upstreamRes = await fetch(`${umamiHost}/script.js`);
          if (!upstreamRes.ok) {
            return reply
              .code(upstreamRes.status)
              .send({ error: "upstream_script_failed" });
          }
          scriptText = await upstreamRes.text();
          if (scriptCacheTtlMs > 0) {
            cachedScript = {
              text: scriptText,
              expiresAt: now + scriptCacheTtlMs,
            };
          }
        }
        return reply
          .header("content-type", "application/javascript; charset=utf-8")
          .header(
            "cache-control",
            "public, max-age=86400, stale-while-revalidate=3600",
          )
          .send(scriptText);
      } catch (error) {
        app.log.error(error, "Failed to proxy Umami script");
        return reply.code(502).send({ error: "upstream_unavailable" });
      }
    });

    app.post("/stats/api/send", async (request, reply) => {
      try {
        const clientIp = request.ip || request.headers["x-forwarded-for"];
        const userAgent = request.headers["user-agent"] ?? "";
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "user-agent":
            typeof userAgent === "string" ? userAgent : (userAgent[0] ?? ""),
        };
        if (clientIp) {
          headers["x-forwarded-for"] =
            typeof clientIp === "string" ? clientIp : (clientIp[0] ?? "");
        }
        const upstreamRes = await fetch(`${umamiHost}/api/send`, {
          method: "POST",
          headers,
          body: JSON.stringify(request.body),
        });
        const responseText = await upstreamRes.text();
        const contentType =
          upstreamRes.headers.get("content-type") ?? "application/json";
        return reply
          .code(upstreamRes.status)
          .header("content-type", contentType)
          .send(responseText);
      } catch (error) {
        app.log.error(error, "Failed to proxy Umami send");
        return reply.code(502).send({ error: "upstream_unavailable" });
      }
    });
  }

  function renderHtmlFile(filePath: string): string | null {
    if (!existsSync(filePath)) return null;
    let html = readFileSync(filePath, "utf8");
    if (umamiWebsiteId) {
      html = html.replace(
        "</head>",
        `<meta name="umami-website-id" content="${umamiWebsiteId}"></head>`,
      );
    }
    return html;
  }

  function renderIndexHtml(): string | null {
    return renderHtmlFile(path.join(options.staticRoot, "index.html"));
  }

  app.get("/", async (_request, reply) => {
    const html = renderIndexHtml();
    if (!html) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.type("text/html; charset=utf-8").send(html);
  });

  await app.register(fastifyStatic, {
    root: options.staticRoot,
    wildcard: false,
    index: false,
    // ETag/Last-Modified revalidation only; hashed Vite assets stay correct
    // across releases without stale max-age on index.html.
    cacheControl: false,
  });

  app.setNotFoundHandler((request, reply) => {
    if (
      request.raw.url?.startsWith("/api/") ||
      request.raw.url?.startsWith("/stats/") ||
      (request.method !== "GET" && request.method !== "HEAD")
    ) {
      return reply.code(404).send({ error: "not_found" });
    }

    const rawUrl = request.raw.url?.split("?")[0] ?? "";
    const safePath = path.normalize(rawUrl).replace(/^(\.\.(\/|\\|$))+/, "");
    const cleanPath = safePath.replace(/^\/+|\/+$/g, "");

    if (cleanPath) {
      const resolvedRoot = path.resolve(options.staticRoot);

      // 1. Direct static file check (e.g. robots.txt, sitemap.xml, llms.txt, share-image.png)
      const directFilePath = path.resolve(options.staticRoot, cleanPath);
      if (
        directFilePath.startsWith(resolvedRoot) &&
        existsSync(directFilePath) &&
        statSync(directFilePath).isFile()
      ) {
        const ext = path.extname(cleanPath).toLowerCase();
        const contentTypes: Record<string, string> = {
          ".xml": "application/xml; charset=utf-8",
          ".txt": "text/plain; charset=utf-8",
          ".json": "application/json; charset=utf-8",
          ".png": "image/png",
          ".ico": "image/x-icon",
          ".svg": "image/svg+xml",
          ".html": "text/html; charset=utf-8",
        };
        const contentType = contentTypes[ext] ?? "application/octet-stream";
        return reply.type(contentType).send(readFileSync(directFilePath));
      }

      // 2. Directory with static index.html ahead of SPA fallback
      const staticIndexPath = path.resolve(
        options.staticRoot,
        cleanPath,
        "index.html",
      );
      if (
        staticIndexPath.startsWith(resolvedRoot) &&
        existsSync(staticIndexPath)
      ) {
        if (!rawUrl.endsWith("/")) {
          const queryString = request.raw.url?.includes("?")
            ? "?" + request.raw.url.slice(request.raw.url.indexOf("?") + 1)
            : "";
          return reply.redirect(`${rawUrl}/${queryString}`, 308);
        }
        const html = renderHtmlFile(staticIndexPath);
        if (html) {
          return reply.type("text/html; charset=utf-8").send(html);
        }
      }
    }

    const html = renderIndexHtml();
    if (!html) {
      return reply.code(404).send({ error: "not_found" });
    }
    // SPA fallback: deep links resolve to the client router.
    return reply.type("text/html; charset=utf-8").send(html);
  });

  return app;
}
