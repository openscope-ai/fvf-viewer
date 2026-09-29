/**
 * Cursor recovery E2E (issue #23, overview §6.4): cursors outside the zoomed
 * region present interactive directional recovery markers; activating
 * recovery returns C1 to 33% and C2 to 67% of the visible viewport so the
 * two cursors never collide, and Fit Waveform also clears the badges.
 */

import {
  expect,
  test,
  openApp,
  loadCapture,
  dragBoxZoom,
  plotBox,
} from "./support";

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await loadCapture(page, "en4ch10k");
  for (const id of ["c1", "c2"] as const) {
    await page.getByTestId(`cursor-toggle-${id}`).click();
  }
  await expect(page.getByTestId("cursor-line-c1")).toBeVisible();
  await expect(page.getByTestId("cursor-line-c2")).toBeVisible();
});

test("zooming away from both cursors raises directional recovery badges grouped left/right", async ({
  page,
}) => {
  // C1 sits at the 25% sample, C2 at 75%: zooming into the middle 42–58%
  // band pushes C1 left and C2 right of the viewport.
  await dragBoxZoom(page, { x: 0.42, y: 0.4 }, { x: 0.58, y: 0.6 });

  await expect(page.getByTestId("cursor-recovery-badge-c1")).toBeVisible();
  await expect(page.getByTestId("cursor-recovery-badge-c2")).toBeVisible();
  await expect(page.getByTestId("cursor-recovery-left")).toBeVisible();
  await expect(page.getByTestId("cursor-recovery-right")).toBeVisible();

  // Direction: C1 groups on the left edge, C2 on the right edge.
  await expect(page.getByTestId("cursor-recovery-left")).toContainText("C1");
  await expect(page.getByTestId("cursor-recovery-right")).toContainText("C2");
});

test("activating recovery returns the cursor into view at distinct viewport fractions", async ({
  page,
}) => {
  await dragBoxZoom(page, { x: 0.42, y: 0.4 }, { x: 0.58, y: 0.6 });

  await page.getByTestId("cursor-recovery-badge-c1").click();
  await expect(page.getByTestId("cursor-recovery-badge-c1")).toBeHidden();
  await expect(page.getByTestId("cursor-line-c1")).toBeVisible();

  await page.getByTestId("cursor-recovery-badge-c2").click();
  await expect(page.getByTestId("cursor-recovery-badge-c2")).toBeHidden();
  await expect(page.getByTestId("cursor-line-c2")).toBeVisible();

  // Recovered positions: C1 at ~33%, C2 at ~67% of the plot width — the two
  // cursors are separated rather than collapsed onto the midpoint.
  const box = await plotBox(page);
  const left1 = await page
    .getByTestId("cursor-line-c1")
    .evaluate(
      (element, containerX) => element.getBoundingClientRect().x - containerX,
      box.x,
    );
  const left2 = await page
    .getByTestId("cursor-line-c2")
    .evaluate(
      (element, containerX) => element.getBoundingClientRect().x - containerX,
      box.x,
    );

  const fraction1 = left1 / box.width;
  const fraction2 = left2 / box.width;
  expect(fraction1).toBeGreaterThan(0.25);
  expect(fraction1).toBeLessThan(0.42);
  expect(fraction2).toBeGreaterThan(0.58);
  expect(fraction2).toBeLessThan(0.75);
});

test("toggling a cursor off dismisses its recovery badge immediately", async ({
  page,
}) => {
  await dragBoxZoom(page, { x: 0.42, y: 0.4 }, { x: 0.58, y: 0.6 });
  await expect(page.getByTestId("cursor-recovery-badge-c1")).toBeVisible();

  // The toolbar badge is a three-state control (inactive → active →
  // selected → inactive); deactivate C1 from whatever state it is in.
  const toggle = page.getByTestId("cursor-toggle-c1");
  for (let i = 0; i < 3; i += 1) {
    if ((await toggle.getAttribute("aria-pressed")) === "false") break;
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("cursor-recovery-badge-c1")).toBeHidden();
  await expect(page.getByTestId("cursor-recovery-badge-c2")).toBeVisible();
});

test("Fit Waveform (100%) dismisses all recovery badges by restoring the full view", async ({
  page,
}) => {
  await dragBoxZoom(page, { x: 0.42, y: 0.4 }, { x: 0.58, y: 0.6 });
  await expect(page.getByTestId("cursor-recovery-badge-c1")).toBeVisible();

  await page.getByTestId("fit-waveform-button").click();
  await expect(page.getByTestId("cursor-recovery-badges")).toBeHidden();
  await expect(page.getByTestId("cursor-line-c1")).toBeVisible();
  await expect(page.getByTestId("cursor-line-c2")).toBeVisible();
});
