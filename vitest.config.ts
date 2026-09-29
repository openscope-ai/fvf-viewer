import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

const worktreeRoot = fileURLToPath(new URL(".", import.meta.url));
const serverFs = {
  fs: {
    // Delivery worktrees live under <repo>/.git/gh-delivery/: outside Vite's default allow list
    // AND matching its default fs.deny '** /.git/**' pattern, so both are overridden here.
    allow: [worktreeRoot],
    deny: [],
  },
};

export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-dom/client", "zustand"],
  },
  test: {
    // Perf benchmarks (apps/web/src/perf) emit soft-regression warnings as
    // GitHub `::warning::` annotation lines. The browser provider captures
    // page console output without printing it for passing tests; re-emit
    // captured warning lines from the node context so verbose runs and CI
    // logs can surface them (the benchmark documentation records the
    // exact surfacing behavior per project).
    onConsoleLog(log: string): boolean | undefined {
      if (log.startsWith("::warning::")) {
        console.log(log);
        return false;
      }
      return undefined;
    },
    projects: [
      {
        ...serverFs,
        test: {
          name: "node",
          environment: "node",
          include: [
            "apps/*/src/**/*.test.ts",
            "apps/*/src/**/*.test.tsx",
            "scripts/**/*.test.ts",
          ],
          exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "**/pkg/**",
            "apps/web/src/**/*.browser.test.ts",
            "apps/web/src/**/*.browser.test.tsx",
            "apps/web/src/hooks/useResizeObserver.test.ts",
          ],
        },
      },
      {
        ...serverFs,
        test: {
          name: "browser",
          include: [
            "apps/web/src/**/*.browser.test.ts",
            "apps/web/src/**/*.browser.test.tsx",
            "apps/web/src/hooks/useResizeObserver.test.ts",
          ],
          testTimeout: 30_000,
          hookTimeout: 30_000,
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
