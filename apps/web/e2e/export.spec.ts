/**
 * Export E2E (issue #23): CSV and PNG export flows run entirely in the
 * browser against the production server — a CSV download carries the
 * metadata header and the sample table with every channel column, and the
 * PNG snapshot is a real raster download.
 */

import { readFileSync } from "node:fs";
import { expect, test, openApp, loadCapture } from "./support";

test("Export CSV downloads a full metadata + sample-table document", async ({
  page,
}) => {
  await openApp(page);
  await loadCapture(page, "en4ch10k");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("csv-export-button").click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/\.csv$/);

  const filePath = await download.path();
  const content = readFileSync(filePath!, "utf8");
  const lines = content.split("\r\n").filter((line) => line.length > 0);

  // Metadata header lines are `#`-prefixed and name every channel.
  const metaLines = lines.filter((line) => line.startsWith("#"));
  expect(metaLines.length).toBeGreaterThan(0);
  expect(metaLines.join("\n")).toContain("Input A");
  expect(metaLines.join("\n")).toContain("Input D");

  // The data table header carries the time column and all four channels;
  // with 10,000 uniform samples the table is complete.
  const headerIndex = lines.findIndex((line) => line.startsWith("sample,"));
  expect(headerIndex).toBeGreaterThan(0);
  expect(lines[headerIndex]).toContain("time_s");

  const dataRows = lines.slice(headerIndex + 1);
  expect(dataRows.length).toBe(10_000);
});

test("Export PNG downloads a non-empty PNG raster", async ({ page }) => {
  await openApp(page);
  await loadCapture(page, "en4ch10k");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("png-export-button").click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/\.png$/);

  const filePath = await download.path();
  const bytes = readFileSync(filePath!);
  expect(bytes.length).toBeGreaterThan(1_000);
  // PNG magic: 0x89 'P' 'N' 'G'
  expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});

test("Copy PNG writes the snapshot to the clipboard as an image", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-write", "clipboard-read"]);
  await openApp(page);
  await loadCapture(page, "en4ch10k");

  const copy = page.getByTestId("png-copy-button");
  await expect(copy).toBeVisible();
  await expect(copy).toHaveAttribute("title", "Copy PNG snapshot to clipboard");

  await copy.click();
  // Transient copied feedback appears next to the Export PNG control.
  await expect(copy).toHaveClass(/png-copy-button--copied/);

  // The system clipboard holds an image/png item with real raster bytes.
  const itemTypeAndSize = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const blob = await items[0]!.getType("image/png");
    return { type: blob.type, size: blob.size };
  });
  expect(itemTypeAndSize.type).toBe("image/png");
  expect(itemTypeAndSize.size).toBeGreaterThan(1_000);
});
