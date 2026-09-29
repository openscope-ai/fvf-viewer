/**
 * Brand & trademark safety E2E (issue #23, overview §6.5): the nominative
 * fair-use disclaimer renders VERBATIM on the app views — empty state and
 * loaded workspace. The narrow-viewport roadblock does not carry the
 * disclaimer (issue #179 keeps it out of the narrow layout).
 */

import { expect, test, openApp, loadCapture } from "./support";

const DISCLAIMER =
  "fvf • viewer is not affiliated with, endorsed by, or sponsored by Fluke Corporation. Fluke and ScopeMeter are registered trademarks of Fluke Corporation.";

test("disclaimer renders verbatim on the empty-state drop page", async ({
  page,
}) => {
  await openApp(page);
  await expect(page.getByTestId("site-footer")).toContainText(DISCLAIMER);
});

test("disclaimer renders verbatim on the loaded workspace", async ({
  page,
}) => {
  await openApp(page);
  await loadCapture(page, "en4ch10k");
  await expect(page.getByTestId("site-footer")).toContainText(DISCLAIMER);
});

test("empty-state page carries the fvf • viewer brand and local-processing notice", async ({
  page,
}) => {
  await openApp(page);

  const header = page.getByTestId("drop-header");
  await expect(header).toBeVisible();
  await expect(header).toContainText("fvf");
  await expect(header).toContainText("viewer");

  // The Fluke product reference lives only in the legal footer; the drop
  // zone states the local-processing guarantee instead.
  await expect(page.getByTestId("hero-privacy")).toContainText(
    "processed locally",
  );
  await expect(page.getByTestId("hero-dropzone")).not.toContainText("Fluke");
});
