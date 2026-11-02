import { readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readMetadata, shutdownExifTool } from "@/lib/image/exiftool";
import { sanitizeImage } from "@/lib/image/sanitize";
import { inspectImage } from "@/lib/image/inspect";
import { AppError } from "@/lib/security/errors";
import type { MetadataCategory, ProcessingOptions } from "@/lib/image/types";

const FIXTURES = path.resolve(import.meta.dirname, "../fixtures");
const PRIVACY: ProcessingOptions = { mode: "privacy", orientationPolicy: "preserve-tag" };
const STRICT: ProcessingOptions = { mode: "strict", orientationPolicy: "preserve-tag" };

const SECRET_STRINGS = ["FixtureCam", "SN-0042-SECRET", "Jane Fixture", "Kathmandu", "secret", "2024:05:06"];

const fixture = (name: string) => readFile(path.join(FIXTURES, name));

/** Independent check: re-read the output bytes with ExifTool from a fresh temp file. */
async function independentRead(bytes: Buffer, ext: string) {
  const file = path.join(os.tmpdir(), `cleanframe-verify-${process.pid}-${Date.now()}.${ext}`);
  await writeFile(file, bytes);
  return readMetadata(file);
}

function categoriesOf(tags: { category: string }[]): Set<string> {
  return new Set(tags.filter((t) => t.category !== "structural").map((t) => t.category));
}

afterAll(async () => {
  await shutdownExifTool();
});

describe("JPEG with GPS, camera, timestamps, IPTC, XMP, thumbnail and orientation 6", () => {
  it("privacy mode removes private metadata, keeps orientation tag and pixel data", async () => {
    const input = await fixture("jpeg-full-orient6.jpg");
    const { report, output } = await sanitizeImage({ bytes: input, options: PRIVACY });

    expect(report.status).toBe("success");
    expect(report.verification.status).toBe("verified");
    expect(report.pixelData).toEqual({ reencoded: false, integrity: "identical" });
    expect(report.orientation).toEqual({ original: 6, action: "kept-tag" });
    expect(report.metadata.retained).toEqual([{ category: "orientation", reason: "visible-orientation" }]);
    const before = report.metadata.before.map((c) => c.category);
    for (const c of ["location", "device", "timestamps", "iptc", "xmp", "comments", "thumbnails"] as MetadataCategory[]) {
      expect(before).toContain(c);
      expect(report.metadata.removed).toContain(c);
    }
    expect(output).not.toBeNull();
    const text = output!.toString("latin1");
    for (const secret of SECRET_STRINGS) expect(text).not.toContain(secret);

    const after = await independentRead(output!, "jpg");
    expect([...categoriesOf(after.tags)]).toEqual(["orientation"]);
    expect(after.orientation).toBe(6);
    expect(after.width).toBe(64);
    expect(after.height).toBe(48);
  });

  it("strict mode with preserve-tag keeps only the orientation tag", async () => {
    const { report, output } = await sanitizeImage({ bytes: await fixture("jpeg-full-orient6.jpg"), options: STRICT });
    expect(report.status).toBe("success");
    const after = await independentRead(output!, "jpg");
    expect([...categoriesOf(after.tags)]).toEqual(["orientation"]);
  });

  it("strict mode with lossless-or-fail refuses when no lossless tool is available", async () => {
    const bytes = await fixture("jpeg-full-orient6.jpg");
    const options: ProcessingOptions = { mode: "strict", orientationPolicy: "lossless-or-fail" };
    const run = sanitizeImage({ bytes, options });
    // jpegtran is optional; when installed the transform must be lossless and verified instead.
    const result = await run.catch((e: unknown) => e);
    if (result instanceof AppError) {
      expect(result.code).toBe("ORIENTATION_UNSAFE");
    } else {
      const { report } = result as Awaited<typeof run>;
      expect(report.orientation.action).toBe("lossless-transform");
      expect(report.pixelData.reencoded).toBe(false);
    }
  });

  it("strict mode with allow-reencode rotates pixels, removes every tag and says so", async () => {
    const options: ProcessingOptions = { mode: "strict", orientationPolicy: "allow-reencode" };
    const { report, output } = await sanitizeImage({ bytes: await fixture("jpeg-full-orient6.jpg"), options });
    expect(report.status).toBe("success");
    expect(["lossless-transform", "reencode-transform"]).toContain(report.orientation.action);
    expect(report.pixelData.integrity).toBe("transformed");
    // Orientation 6 swaps dimensions.
    expect(report.output).toMatchObject({ width: 48, height: 64 });
    const after = await independentRead(output!, "jpg");
    expect(categoriesOf(after.tags).size).toBe(0);
  });
});

describe("JPEG with an ICC profile", () => {
  it("privacy mode retains the ICC profile and reports it", async () => {
    const { report, output } = await sanitizeImage({ bytes: await fixture("jpeg-icc.jpg"), options: PRIVACY });
    expect(report.status).toBe("success");
    expect(report.icc).toEqual({ present: true, retained: true });
    expect(report.notices).toContain("icc-retained");
    // Orientation 1 needs no tag; it must not be kept.
    expect(report.orientation.action).toBe("none");
    const after = await independentRead(output!, "jpg");
    expect([...categoriesOf(after.tags)]).toEqual(["icc-profile"]);
  });

  it("strict mode removes the ICC profile and warns about colour", async () => {
    const { report, output } = await sanitizeImage({ bytes: await fixture("jpeg-icc.jpg"), options: STRICT });
    expect(report.icc).toEqual({ present: true, retained: false });
    expect(report.notices).toContain("icc-removed-color-may-change");
    expect(report.pixelData.integrity).toBe("identical");
    const after = await independentRead(output!, "jpg");
    expect(categoriesOf(after.tags).size).toBe(0);
  });
});

describe.each([
  ["png-text.png", "png", ["text-chunks", "device", "xmp"]],
  ["webp-meta.webp", "webp", ["location", "device", "xmp"]],
  ["tiff-meta.tif", "tiff", ["location", "device", "iptc", "xmp"]],
  ["avif-meta.avif", "avif", ["location", "device", "xmp"]],
  ["gif-animated.gif", "gif", ["comments", "xmp"]],
] as const)("%s", (name, ext, expectedCategories) => {
  it("privacy mode removes metadata with identical image data", async () => {
    const input = await fixture(name);
    const { report, output } = await sanitizeImage({ bytes: input, options: PRIVACY });
    expect(report.status).toBe("success");
    expect(report.pixelData.integrity).toBe("identical");
    for (const c of expectedCategories) expect(report.metadata.removed).toContain(c);
    expect(report.metadata.stillPresent).toEqual([]);

    const after = await independentRead(output!, ext);
    const remaining = categoriesOf(after.tags);
    remaining.delete("icc-profile");
    expect([...remaining]).toEqual([]);
    const text = output!.toString("latin1");
    for (const secret of SECRET_STRINGS) expect(text).not.toContain(secret);
  });

  it("strict mode leaves no removable metadata", async () => {
    const { report, output } = await sanitizeImage({ bytes: await fixture(name), options: STRICT });
    expect(report.status).toBe("success");
    const after = await independentRead(output!, ext);
    expect(categoriesOf(after.tags).size).toBe(0);
  });
});

describe("animated GIF", () => {
  it("preserves every frame and timing", async () => {
    const { report } = await sanitizeImage({ bytes: await fixture("gif-animated.gif"), options: PRIVACY });
    expect(report.input.frameCount).toBe(3);
    expect(report.output?.frameCount).toBe(3);
    expect(report.verification.checks).toContainEqual({ id: "frames", status: "pass" });
  });
});

describe("image without metadata", () => {
  it("reports 'no metadata detected' rather than 'removed'", async () => {
    const { report } = await sanitizeImage({ bytes: await fixture("jpeg-clean.jpg"), options: PRIVACY });
    expect(report.status).toBe("success");
    expect(report.metadata.noMetadataDetected).toBe(true);
    expect(report.metadata.removed).toEqual([]);
  });
});

describe("rejections", () => {
  it.each([
    ["truncated.jpg", "MALFORMED_IMAGE"],
    ["not-an-image.jpg", "UNSUPPORTED_FORMAT"],
    ["empty.png", "EMPTY_FILE"],
    ["vector.svg", "UNSUPPORTED_FORMAT"],
    ["bitmap.bmp", "UNSUPPORTED_FORMAT"],
  ])("%s → %s", async (name, code) => {
    await expect(sanitizeImage({ bytes: await fixture(name), options: PRIVACY })).rejects.toMatchObject({ code });
  });

  it("detects a PNG named .jpg by content and keeps it a PNG", async () => {
    const { format, report } = await sanitizeImage({ bytes: await fixture("png-named-as.jpg"), options: PRIVACY });
    expect(format).toBe("png");
    expect(report.input.mimeType).toBe("image/png");
  });

  it("rejects files over the configured size limit before processing", async () => {
    const big = Buffer.alloc(26 * 1024 * 1024);
    big.set([0xff, 0xd8, 0xff, 0xe0]);
    await expect(sanitizeImage({ bytes: big, options: PRIVACY })).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });
});

describe("inspect", () => {
  it("hides values unless reveal is requested", async () => {
    const hidden = await inspectImage(await fixture("jpeg-full-orient6.jpg"), false);
    expect(hidden.tags.every((t) => t.value === undefined)).toBe(true);
    expect(hidden.categories.map((c) => c.category)).toContain("location");

    const revealed = await inspectImage(await fixture("jpeg-full-orient6.jpg"), true);
    expect(revealed.tags.find((t) => t.name === "SerialNumber")?.value).toBe("SN-0042-SECRET");
  });
});

describe("temporary files", () => {
  it("leaves no workspace behind on success or failure", async () => {
    const list = async () => (await readdir(os.tmpdir())).filter((n) => n.startsWith("cleanframe-") && !n.startsWith("cleanframe-verify"));
    const beforeDirs = new Set(await list());
    await sanitizeImage({ bytes: await fixture("jpeg-icc.jpg"), options: PRIVACY });
    await sanitizeImage({ bytes: await fixture("truncated.jpg"), options: PRIVACY }).catch(() => undefined);
    const leaked = (await list()).filter((n) => !beforeDirs.has(n));
    expect(leaked).toEqual([]);
  });
});
