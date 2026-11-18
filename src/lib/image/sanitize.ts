import "server-only";
import { readFile, writeFile } from "node:fs/promises";
import { getServerConfig } from "../config/server-config";
import { withWorkspace } from "../files/workspace";
import { AppError } from "../security/errors";
import { EXIFTOOL_FILE_TYPES, getCapability } from "./capabilities";
import { readMetadata, runExifTool, type MetadataSnapshot } from "./exiftool";
import { extractFindings } from "./findings";
import { gifRenderHash } from "./gif-hash";
import { decideOrientation, swapsDimensions } from "./orientation";
import { buildReport } from "./report";
import { detectSignature } from "./signature";
import { buildResidualArgs, buildStripArgs } from "./strip-args";
import { findJpegtran, jpegtranTransform, reencodeUpright } from "./transform";
import { allowedCategories, verifyOutput, type FileFacts } from "./verify";
import type { ImageFormat, MetadataFindings, OrientationAction, ProcessingOptions, ProcessingReport } from "./types";

/**
 * The processing pipeline:
 * validate → detect → inspect → decide → (orient) → strip → re-inspect → verify → report.
 * Every step runs inside a private workspace that is deleted in `finally`.
 */

export interface SanitizeRequest {
  bytes: Uint8Array;
  options: ProcessingOptions;
  signal?: AbortSignal;
}

export interface SanitizeOutcome {
  format: ImageFormat;
  report: ProcessingReport;
  /** Present only when verification did not fail. */
  output: Buffer | null;
  /**
   * What the original was revealing, with values. Present only with `output`.
   * Never log it or fold it into `report`: the report is persisted in ZIPs.
   */
  findings: MetadataFindings | null;
}

/** Size and signature checks shared by every endpoint. Cheap; runs before any disk I/O. */
export function assertProcessable(bytes: Uint8Array, maxFileSizeBytes: number): ImageFormat {
  if (bytes.byteLength === 0) throw new AppError("EMPTY_FILE");
  if (bytes.byteLength > maxFileSizeBytes) throw new AppError("FILE_TOO_LARGE");
  const signature = detectSignature(bytes);
  if (signature.kind !== "supported") throw new AppError("UNSUPPORTED_FORMAT");
  return signature.format;
}

export async function readFacts(path: string, format: ImageFormat): Promise<FileFacts & { snapshot: MetadataSnapshot }> {
  const snapshot = await readMetadata(path);
  let pixelHash = snapshot.imageDataHash;
  let frameCount = snapshot.frameCount;
  if (getCapability(format).pixelVerification === "gif-blocks") {
    const gif = gifRenderHash(await readFile(path));
    pixelHash = gif?.hash ?? null;
    frameCount = gif?.frames ?? frameCount;
  }
  return { ...snapshot, pixelHash, frameCount, snapshot };
}

function assertReadable(facts: FileFacts, format: ImageFormat) {
  if (facts.malformed) throw new AppError("MALFORMED_IMAGE");
  if (!facts.fileType || !EXIFTOOL_FILE_TYPES[format].includes(facts.fileType)) {
    throw new AppError("MALFORMED_IMAGE");
  }
  // A hashable format whose hash could not be computed is damaged or truncated.
  if (getCapability(format).pixelVerification === "gif-blocks" && !facts.pixelHash) {
    throw new AppError("MALFORMED_IMAGE");
  }
}

export async function sanitizeImage({ bytes, options, signal }: SanitizeRequest): Promise<SanitizeOutcome> {
  const config = getServerConfig();
  const format = assertProcessable(bytes, config.maxFileSizeBytes);
  const capability = getCapability(format);
  const ext = capability.extensions[0];

  return withWorkspace(config.tempRoot, async (ws) => {
    const inputPath = ws.file(`input.${ext}`);
    await writeFile(inputPath, bytes, { mode: 0o600, flag: "wx" });
    signal?.throwIfAborted();

    const before = await readFacts(inputPath, format);
    assertReadable(before, format);
    signal?.throwIfAborted();

    // Orientation
    const jpegtran = format === "jpeg" ? await findJpegtran(config.jpegtranPath) : null;
    const decision = decideOrientation({
      format,
      orientation: before.orientation,
      mode: options.mode,
      policy: options.orientationPolicy,
      losslessToolAvailable: jpegtran !== null,
    });
    if (decision.action === "reject") throw new AppError("ORIENTATION_UNSAFE");

    let source = inputPath;
    let action: OrientationAction = "none";
    const orientedPath = ws.file(`oriented.${ext}`);

    if (decision.action === "keep-tag") action = "kept-tag";
    if (decision.action === "lossless-transform" && jpegtran) {
      const ok = await jpegtranTransform(jpegtran, decision.transform, inputPath, orientedPath, config.timeoutMs, signal);
      if (ok) {
        source = orientedPath;
        action = "lossless-transform";
      } else if (options.orientationPolicy !== "allow-reencode") {
        throw new AppError("ORIENTATION_UNSAFE");
      }
    }
    if (action === "none" && (decision.action === "reencode-transform" || decision.action === "lossless-transform")) {
      await reencodeUpright(format, inputPath, orientedPath);
      source = orientedPath;
      action = "reencode-transform";
    }
    signal?.throwIfAborted();

    // Strip into a new file; the input is never modified in place.
    const outputPath = ws.file(`output.${ext}`);
    const keepOrientationTag = action === "kept-tag";
    const strip = await runExifTool(buildStripArgs({ format, mode: options.mode, keepOrientationTag }, source, outputPath));
    if (strip.errors.length > 0) throw new AppError("PROCESSING_FAILED");
    signal?.throwIfAborted();

    let after = await readFacts(outputPath, format);
    const ctx = {
      mode: options.mode,
      keepOrientationTag,
      pixelsTransformed: action === "lossless-transform" || action === "reencode-transform",
      dimensionsSwapped:
        (action === "lossless-transform" || action === "reencode-transform") && swapsDimensions(before.orientation),
      supportsIcc: capability.supportsIcc,
      acceptedFileTypes: EXIFTOOL_FILE_TYPES[format],
    };

    if (capability.requiresIfd0Cleanup) {
      const allowed = allowedCategories(ctx);
      const residual = after.tags.filter((t) => t.category !== "structural" && !allowed.has(t.category));
      const args = buildResidualArgs(residual, outputPath);
      if (args) {
        const cleanup = await runExifTool(args);
        if (cleanup.errors.length > 0) throw new AppError("PROCESSING_FAILED");
        after = await readFacts(outputPath, format);
      }
    }

    const verification = verifyOutput(before, after, ctx);
    const outputBytes = verification.status === "failed" ? null : await readFile(outputPath);

    const report = buildReport({
      format,
      mode: options.mode,
      input: { size: bytes.byteLength, width: before.width, height: before.height, frameCount: before.frameCount },
      output: outputBytes
        ? { size: outputBytes.byteLength, width: after.width, height: after.height, frameCount: after.frameCount }
        : null,
      beforeTags: before.tags,
      orientation: { original: before.orientation, action },
      reencoded: action === "reencode-transform",
      verification,
    });

    const output = report.status === "failed" ? null : outputBytes;
    const findings = output && !report.metadata.noMetadataDetected ? extractFindings(before.tags, report) : null;
    return { format, report, output, findings };
  });
}
