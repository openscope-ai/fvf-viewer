import fastify, { type FastifyInstance } from "fastify";
import compress from "@fastify/compress";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";

export interface ServerOptions {
  /** Application version reported by /api/health. */
  version: string;
  /** Directory holding the built Vite SPA (apps/web/dist). */
  staticRoot: string;
  /** Pino log level; pass "silent" to suppress logging (tests). */
  logLevel?: string;
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

  await app.register(fastifyStatic, {
    root: options.staticRoot,
    wildcard: false,
    // ETag/Last-Modified revalidation only; hashed Vite assets stay correct
    // across releases without stale max-age on index.html.
    cacheControl: false,
  });

  app.setNotFoundHandler((request, reply) => {
    if (
      request.raw.url?.startsWith("/api/") ||
      (request.method !== "GET" && request.method !== "HEAD")
    ) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    // SPA fallback: deep links resolve to the client router.
    reply.sendFile("index.html");
  });

  return app;
}
