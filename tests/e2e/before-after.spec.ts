import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const fixture = (name: string) => path.resolve(import.meta.dirname, "../fixtures", name);
const section = (page: Page) => page.getByTestId("before-after");

/** Adds files to the already-open page and runs a full wash. */
async function runClean(page: Page, ...names: string[]) {
  await page.getByTestId("file-input").setInputFiles(names.map(fixture));
  await page.getByRole("button", { name: "Remove metadata" }).click();
  await expect(page.getByTestId("batch-summary")).toBeVisible({ timeout: 20_000 });
}

async function cleanFiles(page: Page, ...names: string[]) {
  await page.goto("/");
  await runClean(page, ...names);
}

// Every test runs a full wash cycle (~10 s under software WebGL) before it can look at anything.
test.beforeEach(() => test.slow());

test.describe("before and after", () => {
  test.use({ reducedMotion: "no-preference" });

  test("appears only once results exist, and shows what was really removed", async ({ page }) => {
    await page.goto("/");
    await expect(section(page)).toHaveCount(0);
    // The washer stays the page's only section until there is something to compare.
    await expect(page.locator("main > section")).toHaveCount(1);

    await runClean(page, "jpeg-full-orient6.jpg");
    await expect(section(page)).toHaveCount(1);

    // "See before & after" brings it into view and moves focus to its heading.
    await page.getByTestId("compare-link").click();
    await expect(section(page)).toBeInViewport();
    await expect(section(page).getByRole("heading", { level: 2 })).toBeFocused();

    // Both sides are the real files.
    await expect(section(page).getByRole("img", { name: "Original: jpeg-full-orient6.jpg" })).toBeVisible();
    await expect(section(page).getByRole("img", { name: "Cleaned: jpeg-full-orient6.jpg" })).toBeVisible();

    // The ledger mirrors the server report: GPS was in the file and is now gone.
    const gps = section(page).getByTestId("before-after-ledger").locator("li", { hasText: "Location (GPS)" });
    await expect(gps).toHaveAttribute("data-fate", "removed");
    await expect(gps).toContainText("→ 0");
    await expect(section(page)).toContainText("Verified clean");
  });

  test("the comparison slider works from the keyboard", async ({ page }) => {
    await cleanFiles(page, "jpeg-full-orient6.jpg");
    await page.getByTestId("compare-link").click();
    const slider = page.getByTestId("before-after-slider");
    await expect(slider).toHaveAccessibleName("Compare the original and the cleaned file");
    // Let the intro sweep finish, then take over.
    await expect(slider).toHaveAttribute("aria-valuetext", "50% of the original shown", { timeout: 5_000 });
    await slider.focus();
    await page.keyboard.press("Home");
    await expect(slider).toHaveAttribute("aria-valuetext", "0% of the original shown");
    await page.keyboard.press("End");
    await expect(slider).toHaveAttribute("aria-valuetext", "100% of the original shown");
  });

  test("with several files, each can be compared", async ({ page }) => {
    await cleanFiles(page, "jpeg-full-orient6.jpg", "png-text.png");
    const picker = section(page).getByRole("group", { name: "Choose which image to compare" });
    await expect(picker.getByRole("button")).toHaveCount(2);
    await picker.getByRole("button", { name: "png-text.png" }).click();
    await expect(picker.getByRole("button", { name: "png-text.png" })).toHaveAttribute("aria-pressed", "true");
    await expect(section(page).getByRole("img", { name: "Cleaned: png-text.png" })).toBeVisible();
  });
});

test.describe("before and after, reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("shows the final state straight away", async ({ page }) => {
    await cleanFiles(page, "jpeg-full-orient6.jpg");
    await page.getByTestId("compare-link").click();
    await expect(page.getByTestId("before-after-slider")).toHaveAttribute("aria-valuetext", "50% of the original shown");
    // No loops at all: nothing in the section is animating.
    const running = await section(page).evaluate((el) =>
      el.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length,
    );
    expect(running).toBe(0);
  });
});
