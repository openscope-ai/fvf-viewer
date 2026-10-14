import fastify, { type FastifyInstance } from "fastify";
import compress from "@fastify/compress";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import { existsSync, readFileSync } from "node:fs";
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
    app.get("/stats/script.js", async (_request, reply) => {
      try {
        const upstreamRes = await fetch(`${umamiHost}/script.js`);
        if (!upstreamRes.ok) {
          reply
            .code(upstreamRes.status)
            .send({ error: "upstream_script_failed" });
          return;
        }
        const scriptText = await upstreamRes.text();
        reply
          .header("content-type", "application/javascript; charset=utf-8")
          .header(
            "cache-control",
            "public, max-age=86400, stale-while-revalidate=3600",
          )
          .send(scriptText);
      } catch (error) {
        app.log.error(error, "Failed to proxy Umami script");
        reply.code(502).send({ error: "upstream_unavailable" });
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
        reply
          .code(upstreamRes.status)
          .header("content-type", contentType)
          .send(responseText);
      } catch (error) {
        app.log.error(error, "Failed to proxy Umami send");
        reply.code(502).send({ error: "upstream_unavailable" });
      }
    });
  }

  function renderIndexHtml(): string | null {
    const indexPath = path.join(options.staticRoot, "index.html");
    if (!existsSync(indexPath)) return null;
    let html = readFileSync(indexPath, "utf8");
    if (umamiWebsiteId) {
      html = html.replace(
        "</head>",
        `<meta name="umami-website-id" content="${umamiWebsiteId}"></head>`,
      );
    }
    return html;
  }

  app.get("/", async (_request, reply) => {
    const html = renderIndexHtml();
    if (!html) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    reply.type("text/html; charset=utf-8").send(html);
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
      reply.code(404).send({ error: "not_found" });
      return;
    }
    const html = renderIndexHtml();
    if (!html) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    // SPA fallback: deep links resolve to the client router.
    reply.type("text/html; charset=utf-8").send(html);
  });

  return app;
}
