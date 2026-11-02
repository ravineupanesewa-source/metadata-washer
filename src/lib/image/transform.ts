import "server-only";
import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { JpegTransform } from "./orientation";
import type { ImageFormat } from "./types";

/**
 * Pixel transforms used only for orientation correction in strict mode.
 * jpegtran is lossless; Sharp re-encodes and runs only with explicit consent.
 */

const execFileAsync = promisify(execFile);
const CANDIDATE_DIRS = ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"];

let jpegtranLookup: Promise<string | null> | null = null;

/** Locates jpegtran once: explicit config path first, then PATH and common dirs. */
export function findJpegtran(configured: string | null): Promise<string | null> {
  jpegtranLookup ??= (async () => {
    const dirs = [...(process.env.PATH ?? "").split(path.delimiter), ...CANDIDATE_DIRS].filter(path.isAbsolute);
    const candidates = configured ? [configured] : dirs.map((dir) => path.join(dir, "jpegtran"));
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // try next
      }
    }
    return null;
  })();
  return jpegtranLookup;
}

/**
 * Applies a lossless JPEG transform. `-perfect` makes jpegtran fail instead of
 * silently trimming edge blocks when dimensions are not MCU-aligned.
 * Returns false when a perfect transform is impossible.
 */
export async function jpegtranTransform(
  jpegtran: string,
  transform: JpegTransform,
  input: string,
  output: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    await execFileAsync(jpegtran, ["-perfect", "-copy", "none", ...transform, "-outfile", output, input], {
      timeout: timeoutMs,
      signal,
      maxBuffer: 1024 * 64,
      windowsHide: true,
    });
    return true;
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
}

/** Rotates per EXIF orientation and re-encodes at high quality in the same format. */
export async function reencodeUpright(format: ImageFormat, input: string, output: string): Promise<void> {
  const { default: sharp } = await import("sharp");
  const pipeline = sharp(input, { failOn: "error", animated: false }).rotate();
  switch (format) {
    case "jpeg":
      await pipeline.jpeg({ quality: 95, chromaSubsampling: "4:4:4", mozjpeg: false }).toFile(output);
      return;
    case "png":
      await pipeline.png({ compressionLevel: 9 }).toFile(output);
      return;
    case "webp":
      await pipeline.webp({ quality: 95, smartSubsample: true }).toFile(output);
      return;
    case "tiff":
      await pipeline.tiff({ compression: "lzw" }).toFile(output);
      return;
    default:
      throw new Error(`Re-encoding is not supported for ${format}`);
  }
}
