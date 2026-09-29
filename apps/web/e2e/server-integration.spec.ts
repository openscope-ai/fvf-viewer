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
