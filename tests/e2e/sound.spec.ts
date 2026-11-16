import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const fixture = (name: string) => path.resolve(import.meta.dirname, "../fixtures", name);

/**
 * Meters the app's real audio output: every AudioContext's destination is routed through
 * a pass-through tap that measures peak level, clipping and which blocks are audible.
 */
async function meterAudio(page: Page) {
  await page.addInitScript(() => {
    const stats = { contexts: 0, state: "none", peak: 0, clipped: 0, audibleBlocks: 0, maxRmsDb: -Infinity, errors: [] as string[] };
    (window as unknown as { __audio: typeof stats }).__audio = stats;
    const Original = window.AudioContext;
    if (!Original) return;
    class MeteredAudioContext extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        stats.contexts += 1;
        const real = super.destination;
        const tap = this.createScriptProcessor(2048, 2, 2);
        tap.onaudioprocess = (e) => {
          let sum = 0;
          let n = 0;
          for (let c = 0; c < e.inputBuffer.numberOfChannels; c++) {
            const data = e.inputBuffer.getChannelData(c);
            e.outputBuffer.copyToChannel(data, c);
            for (let i = 0; i < data.length; i++) {
              const v = Math.abs(data[i]);
              if (v > stats.peak) stats.peak = v;
              if (v >= 0.999) stats.clipped += 1;
              sum += data[i] * data[i];
              n += 1;
            }
          }
          const rms = Math.sqrt(sum / Math.max(1, n));
          if (rms > 0.002) stats.audibleBlocks += 1;
          if (rms > 0) stats.maxRmsDb = Math.max(stats.maxRmsDb, 20 * Math.log10(rms));
        };
        tap.connect(real);
        Object.defineProperty(this, "destination", { get: () => tap });
        this.addEventListener("statechange", () => (stats.state = this.state));
      }
    }
    window.AudioContext = MeteredAudioContext;
    window.addEventListener("error", (e) => stats.errors.push(String(e.message)));
    window.addEventListener("unhandledrejection", (e) => stats.errors.push(String(e.reason)));
  });
}

type AudioStats = { contexts: number; state: string; peak: number; clipped: number; audibleBlocks: number; maxRmsDb: number; errors: string[] };
const audio = (page: Page) => page.evaluate(() => (window as unknown as { __audio: AudioStats }).__audio);

async function settle(page: Page) {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-perf", /high|low/, { timeout: 15_000 });
}

test.beforeEach(() => test.slow()); // full wash cycles under software WebGL

test("silent until the user interacts, then the whole wash is heard, cleanly mixed", async ({ page }) => {
  await meterAudio(page);
  await settle(page);
  // Browser autoplay policy, and good manners: nothing before the first interaction.
  expect((await audio(page)).contexts).toBe(0);

  // Any interaction unlocks audio (the pick button here). In real use the file dialog
  // keeps the person busy for a few seconds, so the audio device is running long before
  // the photo lands; reproduce that instead of resolving the dialog instantly.
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("chamber-stage").getByRole("button", { name: "Choose files" }).click();
  const dialog = await chooser;
  await expect.poll(async () => (await audio(page)).state).toBe("running");
  await page.waitForTimeout(600);
  await dialog.setFiles(fixture("jpeg-full-orient6.jpg"));
  await expect(page.getByTestId("chamber-stage")).toHaveAttribute("data-mode", "ready");
  await expect.poll(async () => (await audio(page)).audibleBlocks, { message: "drop sound" }).toBeGreaterThan(0);

  const beforeWash = (await audio(page)).audibleBlocks;
  await page.getByRole("button", { name: "Remove metadata" }).click();
  await expect(page.getByTestId("chamber-stage")).toHaveAttribute("data-phase", "complete", { timeout: 20_000 });
  const after = await audio(page);
  // The wash plays throughout (motor, water, door, drain, chime): many audible blocks.
  expect(after.audibleBlocks - beforeWash).toBeGreaterThan(20);
  // Mastering: never clips, peaks comfortably below full scale, still clearly audible.
  expect(after.clipped).toBe(0);
  expect(after.peak).toBeLessThan(0.9);
  expect(after.maxRmsDb).toBeGreaterThan(-40);
  expect(after.maxRmsDb).toBeLessThan(-6);
  expect(after.errors).toEqual([]);
  console.log(`audio: peak ${(20 * Math.log10(after.peak)).toFixed(1)} dBFS, loudest block ${after.maxRmsDb.toFixed(1)} dB RMS`);
});

test("muting silences everything and is remembered", async ({ page }) => {
  await meterAudio(page);
  await settle(page);
  const toggle = page.getByTestId("sound-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-perf", /high|low/, { timeout: 15_000 });
  await expect(page.getByTestId("sound-toggle")).toHaveAttribute("aria-pressed", "false");

  await page.getByTestId("file-input").setInputFiles(fixture("jpeg-icc.jpg"));
  await page.getByRole("button", { name: "Remove metadata" }).click();
  await expect(page.getByTestId("chamber-stage")).toHaveAttribute("data-phase", "complete", { timeout: 20_000 });
  expect((await audio(page)).audibleBlocks).toBe(0);
});
