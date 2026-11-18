import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";

const fixture = (name: string) => path.resolve(import.meta.dirname, "../fixtures", name);

async function addFiles(page: Page, ...names: string[]) {
  await page.getByTestId("file-input").setInputFiles(names.map(fixture));
}

const items = (page: Page) => page.getByTestId("queue-item");
const start = (page: Page) => page.getByRole("button", { name: "Remove metadata" });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // Let the one-off frame-rate probe finish first (as animation.spec does): it renders the
  // scene at full rate for a few seconds, which under CPU-rendered WebGL in CI competes with
  // the server for the same cores. These are functional tests, not timing tests.
  await expect(page.locator("html")).toHaveAttribute("data-perf", /high|low/, { timeout: 15_000 });
});

test("uploads, cleans and downloads a supported image @mobile", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1, name: "Remove image metadata." })).toBeVisible();
  await addFiles(page, "jpeg-full-orient6.jpg");
  await expect(items(page)).toHaveAttribute("data-status", "ready");

  await start(page).click();
  await expect(items(page)).toHaveAttribute("data-status", "success");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: /Download cleaned jpeg-full-orient6.jpg/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("jpeg-full-orient6-clean.jpg");
  const bytes = await readFile((await download.path())!);
  expect(bytes.toString("latin1")).not.toContain("SN-0042-SECRET");
  expect(bytes.toString("latin1")).not.toContain("Jane Fixture");
});

test("shows what the original was giving away, but never puts it in the ZIP report", async ({ page }) => {
  await addFiles(page, "jpeg-full-orient6.jpg", "jpeg-icc.jpg");
  await start(page).click();
  const panel = page.getByTestId("exposure-panel");
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel).toContainText("Kathmandu");
  await expect(panel).toContainText("SN-0042-SECRET");
  await expect(panel).toContainText("27.71720° N, 85.32400° E");
  // Reduced motion: everything is shown already washed out.
  await expect(panel.getByTestId("finding").first()).toHaveAttribute("data-state", "washed");
  await expect(page.getByRole("meter", { name: "Exposure" })).toHaveAttribute("aria-valuenow", "0");

  // The per-file report shows the same findings.
  await page.getByRole("button", { name: "Show report for jpeg-full-orient6.jpg" }).click();
  await expect(page.getByRole("dialog").getByTestId("exposure-panel")).toContainText("Jane Fixture");
  await page.keyboard.press("Escape");

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("batch-summary").getByRole("button", { name: "Download all (ZIP)" }).click();
  const zip = await JSZip.loadAsync(await readFile((await (await downloadPromise).path())!));
  const report = await zip.file("report.json")!.async("string");
  for (const secret of ["Kathmandu", "SN-0042-SECRET", "Jane Fixture", "27.7172"]) expect(report).not.toContain(secret);
});

test("does not upload anything until the user starts processing", async ({ page }) => {
  const uploads: string[] = [];
  page.on("request", (r) => r.url().includes("/api/") && uploads.push(r.url()));
  await addFiles(page, "jpeg-icc.jpg");
  await page.waitForTimeout(300);
  expect(uploads).toEqual([]);
});

test("rejects unsupported files by content", async ({ page }) => {
  await addFiles(page, "not-an-image.jpg", "vector.svg", "bitmap.bmp");
  await expect(items(page)).toHaveCount(3);
  for (const row of await items(page).all()) await expect(row).toHaveAttribute("data-status", "invalid");
  await expect(start(page)).toBeDisabled();
  await expect(page.getByText(/doesn't look like a supported image/).first()).toBeVisible();
});

test("shows the verification report", async ({ page }) => {
  await addFiles(page, "jpeg-icc.jpg");
  await start(page).click();
  await expect(items(page)).toHaveAttribute("data-status", "success");
  await page.getByRole("button", { name: "Show report for jpeg-icc.jpg" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Location (GPS)").first()).toBeVisible();
  await expect(dialog.getByText("Kept on purpose")).toBeVisible();
  await expect(dialog.getByText("Image data unchanged")).toBeVisible();
  await expect(dialog.getByText("Unchanged (hash verified)")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("inspects metadata with values hidden until revealed", async ({ page }) => {
  await addFiles(page, "jpeg-full-orient6.jpg");
  await page.getByRole("button", { name: "Inspect metadata in jpeg-full-orient6.jpg" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("cell", { name: "SerialNumber" })).toBeVisible();
  await expect(dialog.getByText("SN-0042-SECRET")).toHaveCount(0);
  await dialog.getByRole("switch", { name: "Show values" }).click();
  await expect(dialog.getByText("SN-0042-SECRET")).toBeVisible();
});

test("processes a mixed batch and downloads only successes as ZIP", async ({ page }) => {
  await addFiles(page, "jpeg-icc.jpg", "png-text.png", "webp-meta.webp", "gif-animated.gif", "truncated.jpg");
  await start(page).click();
  const summary = page.getByTestId("batch-summary");
  await expect(summary).toContainText("4 cleaned and verified");
  await expect(summary).toContainText("1 failed");
  await expect(items(page).filter({ hasText: "truncated.jpg" })).toContainText("damaged or truncated");
  await expect(page.getByTestId("live-region")).toContainText("Finished.");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download all (ZIP)" }).click();
  const download = await downloadPromise;
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  expect(Object.keys(zip.files).sort()).toEqual([
    "gif-animated-clean.gif",
    "jpeg-icc-clean.jpg",
    "png-text-clean.png",
    "report.json",
    "webp-meta-clean.webp",
  ]);
});

test("recovers from a server error with retry", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/sanitize**", async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "BUSY", message: "The server is busy. Please retry in a moment." } }),
      });
    } else {
      await route.continue();
    }
  });
  await addFiles(page, "jpeg-icc.jpg");
  await start(page).click();
  await expect(items(page)).toHaveAttribute("data-status", "failed");
  await expect(items(page)).toContainText("server is busy");
  await page.getByRole("button", { name: "Retry jpeg-icc.jpg" }).click();
  await expect(items(page)).toHaveAttribute("data-status", "success");
});

test("removes items and clears the queue", async ({ page }) => {
  await addFiles(page, "jpeg-icc.jpg", "png-text.png");
  await page.getByRole("button", { name: "Remove png-text.png" }).click();
  await expect(items(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(items(page)).toHaveCount(0);
  await expect(page.getByTestId("live-region")).toHaveText("Queue cleared.");
});

test("strict mode removes the ICC profile and reports it", async ({ page }) => {
  await page.getByRole("button", { name: "Removal settings" }).click();
  await page.getByRole("radio", { name: "Strict", exact: true }).click();
  await page.keyboard.press("Escape");
  await addFiles(page, "jpeg-icc.jpg");
  await start(page).click();
  await expect(items(page)).toHaveAttribute("data-status", "success");
  await page.getByRole("button", { name: "Show report for jpeg-icc.jpg" }).click();
  await expect(page.getByRole("dialog")).toContainText("The ICC colour profile was removed");
});

test("renders untrusted filenames as text, never HTML", async ({ page }) => {
  const evil = '<img src=x onerror="window.__xss=1">.jpg';
  await page.getByTestId("file-input").setInputFiles({
    name: evil,
    mimeType: "image/jpeg",
    buffer: await readFile(fixture("jpeg-icc.jpg")),
  });
  await expect(items(page)).toContainText(evil);
  await start(page).click();
  await expect(items(page)).toHaveAttribute("data-status", "success");
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test("is fully keyboard operable", async ({ page }) => {
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose files" }).focus();
  await page.keyboard.press("Enter");
  await (await chooser).setFiles(fixture("png-text.png"));
  await expect(items(page)).toHaveCount(1);

  await page.getByRole("button", { name: "Removal settings" }).focus();
  await page.keyboard.press("Enter");
  const privacy = page.getByRole("radio", { name: "Privacy (recommended)", exact: true });
  await privacy.focus();
  await expect(privacy).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const strict = page.getByRole("radio", { name: "Strict", exact: true });
  await expect(strict).toBeFocused();
  await page.keyboard.press("Space");
  await expect(strict).toBeChecked();
  await page.keyboard.press("Escape");

  await start(page).focus();
  await page.keyboard.press("Enter");
  await expect(items(page)).toHaveAttribute("data-status", "success");
});

test("mobile layout has no horizontal overflow @mobile", async ({ page }) => {
  await addFiles(page, "jpeg-full-orient6.jpg");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(start(page)).toBeVisible();
});
