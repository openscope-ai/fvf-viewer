/**
 * Desktop roadblock E2E (issue #23): at an emulated narrow viewport the
 * non-dismissable Desktop Required dialog mounts, the app shell goes inert
 * (background wasm/worker work continues), and widening past the 1024 px
 * breakpoint restores the interactive app.
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

  // Share-first handoff control is present and focused.
  const share = page.getByTestId("desktop-roadblock-share");
  await expect(share).toBeVisible();
  await expect(share).toBeFocused();

  // The compact legal footer (disclaimer) stays reachable in the dialog.
  await expect(roadblock.getByTestId("site-footer")).toBeVisible();
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
