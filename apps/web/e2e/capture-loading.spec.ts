/**
 * Capture loading E2E (issue #23, overview §6.1 + §6.2 reachable via UI):
 * parsing happens 100% client-side (no capture bytes ever leave the origin),
 * accepted fixtures across the shape matrix load and render, and invalid
 * files surface the typed error modal with detected magic bytes.
 */

import { expect, test, openApp, loadCapture, fixtureBytes } from "./support";

test("§6.1 parsing is fully client-side: loading a capture triggers no off-origin request", async ({
  page,
}) => {
  const requestUrls: string[] = [];
  page.on("request", (request) => requestUrls.push(request.url()));

  await openApp(page);
  await loadCapture(page, "en4ch10k");

  const origin = new URL(page.url()).origin;
  expect(
    requestUrls.filter((url) => !url.startsWith(origin)),
    "every request in the load path must be same-origin",
  ).toEqual([]);
  expect(requestUrls.length).toBeGreaterThan(0);
});

test("§6.2 4-channel EN fixture loads with banner metrics matching the manifest", async ({
  page,
}) => {
  await openApp(page);
  await loadCapture(page, "en4ch10k");

  await expect(page.locator(".banner-metrics")).toBeVisible();
  await expect(page.locator(".banner-field-samples")).toContainText(
    "10,000 samples",
  );
  await expect(page.locator(".banner-field-timebase")).toContainText(
    "10 ms/Div",
  );
});

test("§6.2 comma-decimal German fixture (unaligned payload at byte 830) loads", async ({
  page,
}) => {
  await openApp(page);
  await loadCapture(page, "deComma1ch");
  await expect(page.locator(".banner-field-samples")).toContainText(
    "3,000 samples",
  );
});

test("§6.2 non-sequential A/B/D channel set loads and reports three channels", async ({
  page,
}) => {
  await openApp(page);
  await loadCapture(page, "abd3ch");
  await expect(page.locator('[data-testid="waveform-toolbar"]')).toContainText(
    "A",
  );
  await expect(page.locator('[data-testid="waveform-toolbar"]')).toContainText(
    "B",
  );
  await expect(page.locator('[data-testid="waveform-toolbar"]')).toContainText(
    "D",
  );
  await expect(page.locator(".banner-field-samples")).toContainText(
    "10,000 samples",
  );
});

test("§6.2 envelope lower bound: 4-channel 500-point capture loads", async ({
  page,
}) => {
  await openApp(page);
  await loadCapture(page, "envelope500");
  await expect(page.locator(".banner-field-samples")).toContainText(
    "500 samples",
  );
});

test("§6.2 envelope upper bound: 1-channel 250,000-point capture loads", async ({
  page,
}) => {
  await openApp(page);
  await loadCapture(page, "envelope250k");
  await expect(page.locator(".banner-field-samples")).toContainText(
    "250,000 samples",
  );
});

test("§6.2 invalid magic surfaces the typed error modal with detected bytes and dismisses back to the drop page", async ({
  page,
}) => {
  await openApp(page);

  await page.setInputFiles('[data-testid="file-picker-input"]', {
    name: "rejected-invalid-magic.fvf",
    mimeType: "application/octet-stream",
    buffer: fixtureBytes("invalidMagic"),
  });

  await expect(page.getByTestId("error-modal")).toBeVisible();
  await expect(page.locator(".error-modal-title")).toContainText(
    "Invalid File Signature",
  );
  await expect(page.getByTestId("detected-ascii")).toBeVisible();

  await page.getByTestId("error-modal-dismiss").click();
  await expect(page.getByTestId("error-modal")).toBeHidden();
  await expect(page.getByTestId("hero-dropzone")).toBeVisible();
});

test("§6.2 rejected timebase format surfaces its typed error modal", async ({
  page,
}) => {
  await openApp(page);

  await page.setInputFiles('[data-testid="file-picker-input"]', {
    name: "rejected-timebase-format.fvf",
    mimeType: "application/octet-stream",
    buffer: fixtureBytes("badTimebase"),
  });

  await expect(page.getByTestId("error-modal")).toBeVisible();
  await expect(page.locator(".error-modal-title")).toContainText(
    "Invalid Timebase Format",
  );
});

test("double-drop: loading a second capture replaces the first", async ({
  page,
}) => {
  await openApp(page);
  await loadCapture(page, "en4ch10k");
  await loadCapture(page, "envelope500");
  await expect(page.locator(".banner-field-samples")).toContainText(
    "500 samples",
  );
});
