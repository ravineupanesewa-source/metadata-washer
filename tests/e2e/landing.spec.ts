import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const fixture = (name: string) => path.resolve(import.meta.dirname, "../fixtures", name);
test.use({ reducedMotion: "no-preference" });

function watchGpuErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /shader|webgl|THREE/i.test(msg.text())) errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test("hero is the washer scene and compiles its shaders", async ({ page }) => {
  const errors = watchGpuErrors(page);
  await page.goto("/");
  const stage = page.getByTestId("chamber-stage");
  await expect(stage).toHaveAttribute("data-renderer", "webgl");
  await expect(stage.locator("canvas")).toBeAttached();
  // The preloader clears on the scene's first frame, well before its 8 s safety timeout.
  await expect(stage).toHaveAttribute("data-booted", "true", { timeout: 6_000 });
  await expect(page.getByTestId("stage-preloader")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Remove image metadata." })).toBeAttached();
  await expect(page.locator("html")).toHaveAttribute("data-perf", /high|low/, { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test("the landing page is the washer alone: one section, no header or footer", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main > section")).toHaveCount(1);
  await expect(page.getByRole("banner")).toHaveCount(0);
  await expect(page.locator("footer")).toHaveCount(0);
});

test("Choose files opens the real file picker and hangs the photo on the line", async ({ page }) => {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("chamber-stage").getByRole("button", { name: "Choose files" }).click();
  await (await chooser).setFiles(fixture("jpeg-icc.jpg"));
  await expect(page.getByTestId("chamber-stage")).toHaveAttribute("data-mode", "ready");
  await expect(page.getByTestId("queue-item")).toHaveAttribute("data-status", "ready");
  await expect(page.getByTestId("decon-status")).toBeInViewport();
});

test("dropping a photo anywhere on the hero adds it to the queue", async ({ page }) => {
  await page.goto("/");
  const dataTransfer = await page.evaluateHandle(async () => {
    const bytes = await (await fetch("/favicon.ico")).arrayBuffer(); // any bytes; validation decides
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "not-really.jpg", { type: "image/jpeg" }));
    return dt;
  });
  await page.locator("section#top").dispatchEvent("drop", { dataTransfer });
  // Validated by content: an .ico named .jpg is rejected, but it reached the real queue.
  await expect(page.getByTestId("queue-item")).toHaveAttribute("data-status", "invalid");
});

test("settings and privacy open from the dock", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Removal settings" }).click();
  await expect(page.getByRole("dialog").getByRole("radio", { name: "Strict", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /private/i }).click();
  await expect(page.getByRole("dialog")).toContainText("Your images stay private");
});

test("without WebGL the hero falls back to CSS and stays usable", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, ...args: unknown[]) => unknown;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
        return type.startsWith("webgl") ? null : original.call(this, type, ...args);
      },
    });
  });
  await page.goto("/");
  await expect(page.getByTestId("chamber-stage")).toHaveAttribute("data-renderer", "fallback");
  await page.getByTestId("file-input").setInputFiles(fixture("jpeg-icc.jpg"));
  await page.getByTestId("chamber-stage").getByRole("button", { name: "Remove metadata" }).click();
  await expect(page.getByTestId("batch-summary")).toContainText("Metadata removed", { timeout: 15_000 });
});
