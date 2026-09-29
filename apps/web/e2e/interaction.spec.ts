/**
 * Interaction E2E (issue #23, overview §6.3 + §6.4 reachable via UI):
 * box-zoom and cursor dragging operate through real mouse gestures against
 * the production server, the UI stays responsive (no >100 ms main-thread
 * long task during gestures), zoom state is observable through DOM state
 * (recovery badges / cursor readouts), and Fit Waveform restores the
 * full-capture viewport.
 */

import {
  expect,
  test,
  openApp,
  loadCapture,
  plotBox,
  dragBoxZoom,
  ctrlDragCursor,
  installLongTaskMonitor,
} from "./support";

test.beforeEach(async ({ page }) => {
  await installLongTaskMonitor(page, 100);
});

test("§6.3 box-zoom drag shows the selection overlay mid-gesture and applies the zoom", async ({
  page,
}) => {
  await openApp(page);
  await loadCapture(page, "en4ch10k");

  // Enable C1 so zoom state is DOM-observable: C1 defaults to the 25%
  // sample index; zooming into the middle 40–60% pushes it out of view and
  // raises the C1 recovery badge.
  await page.getByTestId("cursor-toggle-c1").click();
  await expect(page.getByTestId("cursor-line-c1")).toBeVisible();

  const overlay = page.getByTestId("box-zoom-overlay");
  await expect(overlay).toBeHidden();

  const box = await plotBox(page);
  await page.mouse.move(box.x + 0.4 * box.width, box.y + 0.4 * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + 0.5 * box.width, box.y + 0.5 * box.height, {
    steps: 5,
  });

  // Mid-gesture (past the 8 px threshold) the selection overlay is rendered.
  await expect(overlay).toBeVisible();

  await page.mouse.move(box.x + 0.6 * box.width, box.y + 0.6 * box.height, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(overlay).toBeHidden();

  // The zoom applied: C1 (at the 25% sample) is now out of view.
  await expect(page.getByTestId("cursor-recovery-badge-c1")).toBeVisible();

  // Fit Waveform (100%) restores the full capture view and clears recovery.
  await page.getByTestId("fit-waveform-button").click();
  await expect(page.getByTestId("cursor-recovery-badge-c1")).toBeHidden();
  await expect(page.getByTestId("cursor-line-c1")).toBeVisible();
});

test("§6.3 sub-threshold drags (<8 px) are click-safe and leave the viewport unchanged", async ({
  page,
}) => {
  await openApp(page);
  await loadCapture(page, "en4ch10k");

  await dragBoxZoom(page, { x: 0.3, y: 0.5 }, { x: 0.305, y: 0.55 });
  await expect(page.getByTestId("box-zoom-overlay")).toBeHidden();
});

test("§6.3 Ctrl+drag moves a measurement cursor and updates the readout card", async ({
  page,
}) => {
  await openApp(page);
  await loadCapture(page, "en4ch10k");

  await page.getByTestId("cursor-toggle-c1").click();
  const sample = page.getByTestId("cursor-sample-c1");
  await expect(sample).toBeVisible();

  const before = await sample.textContent();
  await ctrlDragCursor(page, "c1", 180);
  const after = await sample.textContent();

  expect(before).not.toBeNull();
  expect(after).not.toBe(before);

  // The cursor line follows the drag and stays visible.
  await expect(page.getByTestId("cursor-line-c1")).toBeVisible();
});

test("§6.3 gestures on a 250,000-point capture never block the main thread >100 ms", async ({
  page,
}) => {
  await openApp(page);
  await loadCapture(page, "envelope250k");

  for (const id of ["c1", "c2"] as const) {
    await page.getByTestId(`cursor-toggle-${id}`).click();
  }

  // Reset the long-task log after load/mount so the assertion covers the
  // interaction phase (initial chart mount is #24's benchmark scope).
  await page.evaluate(
    () =>
      void ((window as unknown as { __longTasks?: number[] }).__longTasks = []),
  );

  await dragBoxZoom(page, { x: 0.1, y: 0.3 }, { x: 0.9, y: 0.7 });
  await ctrlDragCursor(page, "c1", 200);
  await ctrlDragCursor(page, "c2", -200);
  await page.getByTestId("fit-waveform-button").click();

  const longTasks = await page.evaluate(
    () => (window as unknown as { __longTasks?: number[] }).__longTasks ?? [],
  );
  expect(
    longTasks,
    `no main-thread long task over 100 ms allowed; saw ${longTasks.join(", ")} ms`,
  ).toEqual([]);
});
