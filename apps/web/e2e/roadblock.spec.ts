/**
 * Desktop roadblock E2E (issue #23; layout reworked by issue #179): at an
 * emulated narrow viewport (< 1024px) the non-dismissable Desktop Required
 * dialog mounts with the brand lockup above the title, the app shell goes
 * inert (background wasm/worker work continues), and widening past the
 * 1024px breakpoint restores the interactive app.
 */

import { expect, test, openApp, loadCapture } from "./support";

test.use({ viewport: { width: 800, height: 600 } });

test("narrow viewport raises the Desktop Required dialog over an inert shell", async ({
  page,
}) => {
  await openApp(page);

  const roadblock = page.getByTestId("desktop-roadblock");
  await expect(roadblock).toBeVisible();
  await expect(roadblock).toHaveAttribute("role", "dialog");

  // The shell is inert while the roadblock is mounted.
  await expect(page.locator("main.shell")).toHaveAttribute("inert", "");

  // README-style brand header (#191): logo on top, the app name directly
  // below in a large font; no "Desktop Required" title.
  const brand = roadblock.getByTestId("roadblock-brand");
  await expect(brand).toBeVisible();
  const heading = roadblock.locator("h1.roadblock-brand-name");
  await expect(heading).toHaveText(/fvf • viewer/);
  await expect(roadblock).not.toContainText("Desktop Required");
  const logoBox = await brand.locator("img.roadblock-brand-logo").boundingBox();
  const nameBox = await heading.boundingBox();
  expect(logoBox!.y).toBeLessThan(nameBox!.y);

  // Approved copy (hint corrected 2026-09-29: phones never clear a 1024px
  // CSS-pixel bar in any orientation; standard tablets do in landscape).
  await expect(roadblock).toContainText(
    "This app is designed for multi-channel waveform analysis on wide screens.",
  );
  await expect(roadblock).toContainText(
    "Open this page on a screen wider than 1024px, or try rotating your device.",
  );

  // Share-first handoff control is present, focused, and carries the Share
  // label preceded by a share icon glyph (#179).
  const share = page.getByTestId("desktop-roadblock-share");
  await expect(share).toBeVisible();
  await expect(share).toBeFocused();
  await expect(share).toContainText("Share");
  await expect(share.locator("svg.share-icon")).toBeVisible();

  // The bottom disclaimer is not part of the narrow layout (#179).
  await expect(roadblock.getByTestId("site-footer")).toHaveCount(0);
  await expect(roadblock).not.toContainText("Fluke");
});

test("narrow viewport roadblock appears over a loaded capture without killing it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await loadCapture(page, "en4ch10k");

  await page.setViewportSize({ width: 800, height: 600 });
  await expect(page.getByTestId("desktop-roadblock")).toBeVisible();

  // Widening past the breakpoint dismisses the dialog and restores the app
  // shell with the loaded capture intact.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByTestId("desktop-roadblock")).toBeHidden();
  await expect(page.locator(".banner-filename-text")).toContainText(
    "accepted-en-4ch",
  );
});
