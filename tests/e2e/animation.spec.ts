import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const fixture = (name: string) => path.resolve(import.meta.dirname, "../fixtures", name);

test.use({ reducedMotion: "no-preference" });

const ORDER = ["idle", "materialize", "activate", "scan", "awaiting", "purge", "dissipate", "clear", "fault", "complete"];

/** Phases must follow the timeline order. Under heavy load a short phase may be skipped, never reordered. */
function expectTimelineOrder(phases: string[], mustInclude: string[]) {
  const indexes = phases.map((p) => ORDER.indexOf(p));
  expect(indexes.every((v, i) => v >= 0 && (i === 0 || v > indexes[i - 1]))).toBe(true);
  for (const phase of mustInclude) expect(phases).toContain(phase);
}

/** Records every phase the stage reports, in order. */
async function recordPhases(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __phases: string[] };
    w.__phases = [];
    const read = () => {
      const phase = document.querySelector('[data-testid="chamber-stage"]')?.getAttribute("data-phase");
      if (phase && w.__phases[w.__phases.length - 1] !== phase) w.__phases.push(phase);
    };
    read();
    new MutationObserver(read).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-phase"] });
  });
  return () => page.evaluate(() => (window as unknown as { __phases: string[] }).__phases);
}

/** Collects WebGL/shader errors: any compile failure is logged by three.js to the console. */
function watchGpuErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /shader|webgl|THREE/i.test(msg.text())) errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

const stage = (page: Page) => page.getByTestId("chamber-stage");

/** Wait for the app's one-off frame-rate probe, so timings aren't measured while it runs. */
async function settled(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-perf", /high|low/, { timeout: 15_000 });
}



async function load(page: Page, ...files: string[]) {
  await settled(page);
  await page.getByTestId("file-input").setInputFiles(files.map(fixture));
  await expect(stage(page)).toHaveAttribute("data-mode", "ready");
}

async function clean(page: Page) {
  await stage(page).getByRole("button", { name: "Remove metadata" }).click();
}

test("idle chamber renders with WebGL and compiles every shader", async ({ page }) => {
  const errors = watchGpuErrors(page);
  await page.goto("/");
  await expect(stage(page)).toHaveAttribute("data-renderer", "webgl");
  await expect(stage(page).locator("canvas")).toBeAttached();
  await expect(stage(page)).toHaveAttribute("data-mode", "idle");
  await expect(stage(page).getByRole("button", { name: "Choose files" })).toBeVisible();
  await page.waitForTimeout(800);
  expect(errors).toEqual([]);
});

test("dragging files over the stage opens the chamber", async ({ page }) => {
  await page.goto("/");
  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "photo.jpg", { type: "image/jpeg" }));
    return dt;
  });
  await stage(page).dispatchEvent("dragenter", { dataTransfer });
  await expect(stage(page)).toHaveAttribute("data-mode", "drag");
  await expect(stage(page)).toContainText("Release to load the washer");
  await stage(page).dispatchEvent("dragleave", { dataTransfer });
  await expect(stage(page)).toHaveAttribute("data-mode", "idle");
});

test("plays the full decontamination sequence in ~4.5 s, then reveals the real cleaned file", async ({ page }) => {
  const errors = watchGpuErrors(page);
  await page.goto("/");
  await load(page, "jpeg-full-orient6.jpg");
  await expect(stage(page)).toContainText("jpeg-full-orient6.jpg");
  const phases = await recordPhases(page);
  const startedAt = Date.now();
  await clean(page);

  await expect(stage(page)).toHaveAttribute("data-mode", "run");
  await expect(stage(page)).toHaveAttribute("data-duration", "4.5");
  await expect(stage(page).getByRole("button", { name: "Show results" })).toBeFocused();
  await expect(stage(page)).toHaveAttribute("data-phase", "complete", { timeout: 15_000 });
  const elapsed = Date.now() - startedAt;
  expect(elapsed).toBeGreaterThanOrEqual(4_000);
  expect(elapsed).toBeLessThan(7_000);
  const seen = await phases();
  expectTimelineOrder(seen, ["materialize", "scan", "purge", "complete"]);
  expect(seen).not.toContain("fault");
  await expect(stage(page).getByTestId("decon-status")).toContainText("Metadata removed");

  const panel = page.getByTestId("batch-summary");
  await expect(panel).toBeVisible();
  await expect(stage(page)).toHaveAttribute("data-mode", "finished");
  await expect(panel.getByRole("heading", { name: "Metadata removed" })).toBeFocused();
  await expect(panel).toContainText("Location (GPS)");

  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("link", { name: "Download cleaned image" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("jpeg-full-orient6-clean.jpg");
  const bytes = await (await import("node:fs/promises")).readFile((await download.path())!);
  expect(bytes.toString("latin1")).not.toContain("SN-0042-SECRET");
  expect(errors).toEqual([]);
});

test("keeps scanning while the server is slow and never purges before the response", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/sanitize**", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/");
  await load(page, "jpeg-icc.jpg");
  await clean(page);
  await expect(stage(page).getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(stage(page)).toHaveAttribute("data-phase", "awaiting", { timeout: 6_000 });
  await page.waitForTimeout(1_500);
  await expect(stage(page)).toHaveAttribute("data-phase", "awaiting");
  await expect(stage(page)).toHaveAttribute("data-outcome", "pending");
  await expect(stage(page)).not.toContainText("Metadata removed");
  await expect(page.getByTestId("batch-summary")).toHaveCount(0);
  release();
  await expect(stage(page)).toHaveAttribute("data-phase", "purge");
  await expect(stage(page).getByTestId("decon-status")).toContainText("Metadata removed");
});

test("shows a neutral result for an image without metadata", async ({ page }) => {
  await page.goto("/");
  await load(page, "jpeg-clean.jpg");
  const phases = await recordPhases(page);
  await clean(page);
  await expect(stage(page)).toHaveAttribute("data-outcome", "no-metadata");
  await expect(page.getByTestId("batch-summary")).toContainText("No metadata found");
  expect(await phases()).not.toContain("purge");
  await expect(stage(page)).not.toContainText("Metadata removed");
});

test("stops the sequence on failure and offers retry", async ({ page }) => {
  await page.goto("/");
  await load(page, "truncated.jpg");
  const phases = await recordPhases(page);
  await clean(page);
  await expect(stage(page)).toHaveAttribute("data-outcome", "error");
  await expect(stage(page).getByTestId("decon-status")).toContainText("Cleaning failed");
  await expect(stage(page)).toContainText("damaged or truncated");
  const panel = page.getByTestId("batch-summary");
  await expect(panel).toContainText("Cleaning failed");
  await expect(panel.getByRole("button", { name: "Retry failed" })).toBeVisible();
  await expect(panel.getByRole("link", { name: /Download/ })).toHaveCount(0);
  const seen = await phases();
  expectTimelineOrder(seen, ["fault"]);
  expect(seen).not.toContain("purge");
});

test("cancel stops the run immediately", async ({ page }) => {
  await page.route("**/api/sanitize**", () => new Promise(() => undefined)); // never resolves
  await page.goto("/");
  await load(page, "jpeg-icc.jpg");
  await clean(page);
  await expect(stage(page)).toHaveAttribute("data-mode", "run");
  await stage(page).getByRole("button", { name: "Cancel" }).click();
  await expect(stage(page)).not.toHaveAttribute("data-mode", "run");
  await expect(page.getByTestId("queue-item")).toHaveAttribute("data-status", "cancelled");
  await expect(stage(page).getByRole("button", { name: "Remove metadata" })).toBeVisible();
});

test("new files after a run start from a fresh state", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/sanitize**", async (route) => {
    calls += 1;
    if (calls === 2) await new Promise((r) => setTimeout(r, 3_000)); // keep the second run pending
    await route.continue();
  });
  await page.goto("/");
  await load(page, "jpeg-icc.jpg");
  await clean(page);
  await expect(stage(page)).toHaveAttribute("data-outcome", "clean");
  await stage(page).getByRole("button", { name: "Show results" }).click();
  await expect(stage(page)).toHaveAttribute("data-mode", "finished");

  await page.getByTestId("file-input").setInputFiles(fixture("png-text.png"));
  await expect(stage(page)).toHaveAttribute("data-mode", "ready");
  await expect(stage(page)).toContainText("png-text.png");
  await expect(page.getByTestId("batch-summary")).toHaveCount(0);
  await clean(page);
  await expect(stage(page)).toHaveAttribute("data-outcome", "pending");
  await expect(stage(page)).toHaveAttribute("data-phase", /materialize|activate/);
  await expect(stage(page)).toContainText("0 of 1 image processed");
});

test("falls back to the CSS chamber when WebGL is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    // Deny WebGL contexts only; 2D canvases keep working.
    const original = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, ...args: unknown[]) => unknown;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
        return type.startsWith("webgl") ? null : original.call(this, type, ...args);
      },
    });
  });
  await page.goto("/");
  await expect(stage(page)).toHaveAttribute("data-renderer", "fallback");
  await load(page, "jpeg-icc.jpg");
  await clean(page);
  await expect(stage(page).getByTestId("decon-status")).toContainText("Metadata removed");
  await expect(page.getByTestId("batch-summary")).toBeVisible();
  await expect(page.getByTestId("queue-item")).toHaveAttribute("data-status", "success");
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("uses the simplified, shorter sequence but keeps clear states", async ({ page }) => {
    await page.goto("/");
    await load(page, "jpeg-icc.jpg");
    const startedAt = Date.now();
    await clean(page);
    await expect(stage(page)).toHaveAttribute("data-reduced", "true");
    // Half the normal 4.5 s timeline; wall-clock is only sanity-checked (software GL lags under load).
    await expect(stage(page)).toHaveAttribute("data-duration", "2.25");
    await expect(stage(page).getByTestId("decon-status")).toContainText("Metadata removed");
    await expect(stage(page)).toHaveAttribute("data-phase", "complete");
    expect(Date.now() - startedAt).toBeLessThan(6_000);
  });
});

test("fits a phone screen without horizontal overflow @mobile", async ({ page }) => {
  await page.goto("/");
  await load(page, "jpeg-full-orient6.jpg");
  await clean(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(stage(page).getByTestId("decon-status")).toContainText("Metadata removed");
  await expect(page.getByTestId("batch-summary").getByRole("link", { name: "Download cleaned image" })).toBeVisible();
});
