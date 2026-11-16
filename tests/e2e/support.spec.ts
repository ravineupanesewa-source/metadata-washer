import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { SUPPORT, supportEnabled } from "../../src/features/support/support-config";

// The support modal is temporarily switched off (SUPPORT_MODAL_ENABLED in support-config).
test.skip(!supportEnabled, "eSewa support modal is disabled");

const fixture = (name: string) => path.resolve(import.meta.dirname, "../fixtures", name);
const modal = (page: Page) => page.getByRole("dialog");

/** Stand-in QR so the tests don't depend on the owner's real image. */
async function serveQr(page: Page) {
  await page.route("**/support/esewa-qr.png", (route) => route.fulfill({ path: fixture("png-text.png"), contentType: "image/png" }));
}

async function cleanOne(page: Page, file = "jpeg-full-orient6.jpg") {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-perf", /high|low/, { timeout: 15_000 });
  await page.getByTestId("file-input").setInputFiles(fixture(file));
  await page.getByRole("button", { name: "Remove metadata" }).click();
  await expect(page.getByTestId("batch-summary")).toBeVisible({ timeout: 20_000 });
}

async function download(page: Page) {
  const downloaded = page.waitForEvent("download");
  await page.getByTestId("batch-summary").getByRole("link", { name: "Download cleaned image" }).click();
  // The file always downloads first: support is offered afterwards, never in the way.
  expect((await downloaded).suggestedFilename()).toMatch(/-clean\.jpg$/);
}

test.beforeEach(() => test.slow()); // a full wash cycle under software WebGL

test("opens after a download with the user's real results, and 'Maybe later' sticks @mobile", async ({ page }) => {
  await serveQr(page);
  await cleanOne(page);
  await expect(modal(page)).toHaveCount(0);

  await download(page);
  await expect(modal(page)).toBeVisible();
  await expect(modal(page)).toHaveAccessibleName("Liked how clean that came out?");
  // Real numbers from the server report for this file (it had GPS data).
  await expect(page.getByTestId("support-impact")).toContainText(/You just scrubbed \d+ hidden fields from 1 image/);
  await expect(page.getByTestId("support-impact")).toContainText("including your GPS location");
  await expect(modal(page).getByRole("img", { name: "eSewa QR code" })).toBeVisible();
  if (SUPPORT.esewaId) await expect(modal(page)).toContainText(SUPPORT.esewaId);

  // Choosing a tip updates what to enter in eSewa.
  const tips = modal(page).getByRole("radiogroup", { name: "Pick a tip" });
  await expect(tips.getByRole("radio", { checked: true })).toContainText("Rs 150");
  await tips.getByRole("radio", { name: "Rs 50 Chiya", exact: true }).click();
  await expect(page.getByTestId("support-amount-hint")).toHaveText("Enter Rs 50 in eSewa after scanning.");

  await modal(page).getByRole("button", { name: "Maybe later" }).click();
  await expect(modal(page)).toHaveCount(0);

  // Snoozed on this device: the next session's download doesn't bring it back.
  await cleanOne(page);
  await download(page);
  await page.waitForTimeout(1_000);
  await expect(modal(page)).toHaveCount(0);
});

test("'I've sent it' shows a thank-you, and Escape always closes", async ({ page }) => {
  await serveQr(page);
  await cleanOne(page);
  await download(page);
  await modal(page).getByRole("button", { name: "I've sent it" }).click();
  await expect(page.getByTestId("support-thanks")).toBeVisible();
  await expect(modal(page)).toHaveAccessibleName("Dhanyabad!");
  await page.keyboard.press("Escape");
  await expect(modal(page)).toHaveCount(0);
});

test("without a QR file it falls back to the eSewa ID, never a broken image", async ({ page }) => {
  test.skip(!SUPPORT.esewaId, "only meaningful when an eSewa ID is configured");
  await page.route("**/support/esewa-qr.png", (route) => route.fulfill({ status: 404, body: "" }));
  await cleanOne(page);
  await download(page);
  await expect(modal(page)).toBeVisible();
  await expect(modal(page).getByRole("img")).toHaveCount(0);
  await expect(modal(page)).toContainText(SUPPORT.esewaId);
  await expect(modal(page).getByRole("button", { name: "Copy" })).toBeVisible();
});

test("phones can save the QR to scan it from the gallery @mobile", async ({ page, isMobile }) => {
  test.skip(!isMobile, "touch-only option");
  await serveQr(page);
  await cleanOne(page);
  await download(page);
  const save = modal(page).getByRole("link", { name: "Save QR image" });
  await expect(save).toBeVisible();
  await expect(save).toHaveAttribute("download", "esewa-qr.png");
});
