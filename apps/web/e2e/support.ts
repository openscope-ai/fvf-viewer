/**
 * Shared E2E support (issue #23): the Playwright `test` export wraps the
 * built-in `page` fixture with a suite-wide Content-Security-Policy guard —
 * every console error matching a CSP violation pattern (or a page error)
 * collected during any spec fails that spec at teardown. The pinned CSP from
 * PR #159 is a regression surface: every resource the E2E pass loads must
 * comply.
 *
 * Fixtures come from the committed synthetic mirror corpus
 * (crates/fvf-wasm/tests/fixtures) — byte-exact `.fvf` streams with a
 * `.fvf.bin` extension so the local-only capture policy stays enforced.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base, type Page } from "@playwright/test";

export const REPO_ROOT = path.resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
);

export const FIXTURES_DIR = path.join(
  REPO_ROOT,
  "crates/fvf-wasm/tests/fixtures",
);

/** Committed synthetic corpus entries used by the E2E pass. */
export const FIXTURES = {
  en4ch10k: "synthetic/accepted-en-4ch-10000-10ms-div.fvf.bin",
  deComma1ch: "synthetic/accepted-de-eingang-1ch-3000-comma-decimal.fvf.bin",
  minute2ch: "synthetic/accepted-en-2ch-10000-1min-div.fvf.bin",
  abd3ch: "synthetic/nonsequential-abd-3ch-10000-20ms-div.fvf.bin",
  envelope500: "synthetic/extreme-envelope-4ch-500-10ms-div.fvf.bin",
  envelope250k: "synthetic/extreme-envelope-1ch-250000-10ms-div.fvf.bin",
  invalidMagic: "synthetic/rejected-invalid-magic-1ch-1000.fvf.bin",
  badTimebase: "synthetic/rejected-timebase-format-1ch-1000.fvf.bin",
} as const;

export function fixturePath(relative: keyof typeof FIXTURES): string {
  return path.join(FIXTURES_DIR, FIXTURES[relative]);
}

/** Basename as surfaced in the metadata banner / export filenames. */
export function fixtureBasename(relative: keyof typeof FIXTURES): string {
  return path.basename(FIXTURES[relative]);
}

const CSP_VIOLATION_RE =
  /Content Security Policy|Refused to (?:load|execute|apply|create|connect|display|evaluate)/i;

/**
 * The batch `test` export: same fixture set as the base runner, with the
 * page wrapped in the CSP-violation guard (acceptance: "fails on any
 * console CSP violation").
 */
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const violations: string[] = [];
    const onConsole = (message: { type(): string; text(): string }): void => {
      if (message.type() === "error" && CSP_VIOLATION_RE.test(message.text())) {
        violations.push(`console: ${message.text()}`);
      }
    };
    const onPageError = (error: Error): void => {
      violations.push(`pageerror: ${error.message}`);
    };
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    await use(page);
    if (violations.length > 0) {
      testInfo.annotations.push({
        type: "csp-violations",
        description: violations.join(" | "),
      });
    }
    expect(
      violations,
      "CSP violation guard: no console CSP violations or page errors are allowed in the E2E pass",
    ).toEqual([]);
  },
});

export { expect } from "@playwright/test";

/** Opens the app root and waits for the empty-state drop page. */
export async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("hero-dropzone")).toBeVisible();
}

/**
 * Loads a capture through the hidden native file picker input (identical
 * store path as the drop zone) and waits until the metadata banner carries
 * the fixture name — i.e. the worker parse round-trip completed.
 */
export async function loadCapture(
  page: Page,
  fixture: keyof typeof FIXTURES,
): Promise<void> {
  await page.setInputFiles(
    '[data-testid="file-picker-input"]',
    fixturePath(fixture),
  );
  await expect(page.locator(".banner-filename-text")).toContainText(
    fixtureBasename(fixture),
  );
  await expect(page.getByTestId("oscilloscope-container")).toBeVisible();
}

/** Plot-area bounding box (the uPlot overlay element covering the data rect). */
export async function plotBox(page: Page): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  const over = page.locator(".u-over");
  await expect(over).toBeAttached();
  const box = await over.boundingBox();
  if (!box) {
    throw new Error("uPlot overlay has no bounding box");
  }
  return box;
}

/**
 * Real-mouse box-zoom drag on the plot overlay. `fractions` are [0..1]
 * relative to the plot rect. Holds the intermediate position briefly so the
 * drag overlay is observable mid-gesture.
 */
export async function dragBoxZoom(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { holdMs?: number } = {},
): Promise<void> {
  const box = await plotBox(page);
  const start = {
    x: box.x + from.x * box.width,
    y: box.y + from.y * box.height,
  };
  const end = { x: box.x + to.x * box.width, y: box.y + to.y * box.height };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  if (options.holdMs) {
    await page.waitForTimeout(options.holdMs);
  }
  await page.mouse.up();
}

/** Ctrl+drags a cursor handle horizontally by `dxPixels` (sample-precise). */
export async function ctrlDragCursor(
  page: Page,
  cursor: "c1" | "c2",
  dxPixels: number,
): Promise<void> {
  const handle = page.locator(`[data-testid="cursor-handle-${cursor}"]`);
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) {
    throw new Error(`cursor handle ${cursor} has no bounding box`);
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.keyboard.down("Control");
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dxPixels, cy, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Control");
}

/**
 * Installs a main-thread long-task monitor (threshold configurable). Returns
 * an accessor for the recorded durations; the monitor is injected before any
 * app code runs, so it captures tasks from initial load through assertions.
 */
export async function installLongTaskMonitor(
  page: Page,
  thresholdMs = 100,
): Promise<() => Promise<number[]>> {
  await page.addInitScript(
    ([threshold]) => {
      const durations: number[] = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= (threshold as number)) {
            durations.push(entry.duration);
          }
        }
      });
      observer.observe({ type: "longtask", buffered: true });
      (window as unknown as { __longTasks: number[] }).__longTasks = durations;
    },
    [thresholdMs],
  );
  return async () => {
    const durations = await page.evaluate(
      () => (window as unknown as { __longTasks?: number[] }).__longTasks ?? [],
    );
    return durations;
  };
}

/** Reads a committed fixture's raw bytes (for upload-leak assertions). */
export function fixtureBytes(fixture: keyof typeof FIXTURES): Buffer {
  return readFileSync(fixturePath(fixture));
}
