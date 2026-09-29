import { defineConfig } from "@playwright/test";

/**
 * E2E configuration (issue #23): the suite runs against the production
 * server (`node apps/server`, available since 0.7.0) serving the built SPA
 * — closer to production than a bare static preview and lets specs assert
 * server behavior alongside UI flows. Run `pnpm build` first: the server
 * serves `apps/web/dist` and is compiled to `apps/server/dist`.
 */

const port = Number(process.env["E2E_PORT"] ?? 4173);
// FVF_E2E_BASE_URL points the suite at a live deployment (issue #22
// production smoke: e.g. FVF_E2E_BASE_URL=https://fvf-viewer.com); the
// webServer is skipped in that mode and specs run against the deployment.
const baseURL = process.env["FVF_E2E_BASE_URL"] ?? `http://127.0.0.1:${port}`;
const againstDeployment = Boolean(process.env["FVF_E2E_BASE_URL"]);

export default defineConfig({
  testDir: "./apps/web/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL,
    // 1920x1080 clears the 1900px desktop minimum (issue #179 raised the
    // roadblock breakpoint from 1024px to 1900px).
    viewport: { width: 1920, height: 1080 },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: againstDeployment
    ? undefined
    : {
        command: "node apps/server/dist/start.js",
        url: `${baseURL}/api/health`,
        env: { PORT: String(port) },
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
});
