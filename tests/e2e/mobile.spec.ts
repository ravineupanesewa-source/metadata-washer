import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

const fixture = (name: string) => path.resolve(import.meta.dirname, "../fixtures", name);
const stage = (page: Page) => page.getByTestId("chamber-stage");

// Touch-device behaviour: these run on the "mobile" project (Pixel 7, real touch events).
test.skip(({ isMobile }) => !isMobile, "touch-device behaviour");

async function expectTouchTarget(button: Locator) {
  const box = await button.boundingBox();
  expect(box, "button is laid out").not.toBeNull();
  // WCAG 2.5.5: 44 × 44 CSS px.
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

test("controls are full-size touch targets @mobile", async ({ page }) => {
  await page.goto("/");
  await expect(stage(page)).toHaveAttribute("data-booted", "true", { timeout: 15_000 });
  // Touch copy: nothing to drag-and-drop from on a phone.
  await expect(page.getByTestId("decon-status")).toHaveText("Add a photo to the washer");
  await expectTouchTarget(stage(page).getByRole("button", { name: "Choose files" }));

  await page.getByTestId("file-input").setInputFiles(fixture("jpeg-icc.jpg"));
  await expect(stage(page)).toHaveAttribute("data-mode", "ready");
  for (const name of ["Add more", "Removal settings", "Your images stay private", "Remove metadata"]) {
    await expectTouchTarget(stage(page).getByRole("button", { name, exact: true }));
  }
  // Queue row actions were 28 px icons.
  const row = page.getByTestId("queue-item");
  for (const button of await row.getByRole("button").all()) await expectTouchTarget(button);
});

test("data saver gets the lightweight washer and skips the 3D download @mobile", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", { value: { saveData: true, effectiveType: "4g" }, configurable: true });
  });
  const heavy: string[] = [];
  page.on("request", (r) => r.url().includes("/models/") && heavy.push(r.url()));
  await page.goto("/");
  await expect(stage(page)).toHaveAttribute("data-renderer", "fallback");
  await expect(stage(page).getByRole("button", { name: "Choose files" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(heavy).toEqual([]);
});

test("in landscape the dock stays on screen @mobile", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  await expect(stage(page).getByRole("button", { name: "Choose files" })).toBeInViewport();
  await expect(page.getByTestId("decon-status")).toBeInViewport();
});

test("tapping the before/after frame moves the divider @mobile", async ({ page }) => {
  test.slow(); // a full wash cycle under software WebGL
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(fixture("jpeg-full-orient6.jpg"));
  await page.getByRole("button", { name: "Remove metadata" }).click();
  await expect(page.getByTestId("batch-summary")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("compare-link").click();

  const slider = page.getByTestId("before-after-slider");
  await expect(slider).toHaveAttribute("aria-valuetext", "50% of the original shown", { timeout: 5_000 });
  const frame = page.getByTestId("before-after").locator(".group\\/frame");
  const box = (await frame.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width * 0.25, box.y + box.height * 0.6);
  await expect(slider).toHaveAttribute("aria-valuetext", "25% of the original shown");
});
