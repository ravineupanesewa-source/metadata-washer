import type { ClassifiedTag } from "./classify";
import type {
  MetadataCategory,
  MetadataMode,
  PixelIntegrity,
  RetainedCategory,
  VerificationCheck,
  VerificationStatus,
} from "./types";

/**
 * Pure verification of a sanitized output against its input. The caller
 * supplies facts read *independently* from both files; this function never
 * trusts what the sanitizer said it did.
 */

export interface FileFacts {
  fileType: string | null;
  width: number | null;
  height: number | null;
  frameCount: number;
  orientation: number | null;
  /** ImageDataHash or GIF render hash; null when the format cannot be hashed. */
  pixelHash: string | null;
  tags: readonly ClassifiedTag[];
  malformed: boolean;
}

export interface VerificationContext {
  mode: MetadataMode;
  keepOrientationTag: boolean;
  /** Pixels were rotated/flipped on purpose (lossless or re-encode). */
  pixelsTransformed: boolean;
  /** Orientation transform swaps width and height. */
  dimensionsSwapped: boolean;
  /** Format can keep an ICC profile separately from other metadata. */
  supportsIcc: boolean;
  /** ExifTool FileType values that count as the same format (e.g. "WEBP" and "Extended WEBP"). */
  acceptedFileTypes: readonly string[];
}

export interface VerificationOutcome {
  status: VerificationStatus;
  checks: VerificationCheck[];
  pixelIntegrity: PixelIntegrity;
  retained: RetainedCategory[];
  stillPresent: MetadataCategory[];
}

export function allowedCategories(ctx: VerificationContext): Map<MetadataCategory, RetainedCategory["reason"]> {
  const allowed = new Map<MetadataCategory, RetainedCategory["reason"]>();
  if (ctx.mode === "privacy" && ctx.supportsIcc) allowed.set("icc-profile", "color-rendering");
  if (ctx.keepOrientationTag) allowed.set("orientation", "visible-orientation");
  return allowed;
}

export function verifyOutput(before: FileFacts, after: FileFacts, ctx: VerificationContext): VerificationOutcome {
  const checks: VerificationCheck[] = [];
  const allowed = allowedCategories(ctx);

  checks.push({ id: "output-readable", status: after.malformed || !after.fileType ? "fail" : "pass" });
  const sameFormat = after.fileType !== null && ctx.acceptedFileTypes.includes(after.fileType);
  checks.push({ id: "format", status: sameFormat ? "pass" : "fail" });

  const expectedWidth = ctx.dimensionsSwapped ? before.height : before.width;
  const expectedHeight = ctx.dimensionsSwapped ? before.width : before.height;
  const dimensionsKnown = before.width !== null && after.width !== null;
  checks.push({
    id: "dimensions",
    status: !dimensionsKnown
      ? "unverifiable"
      : after.width === expectedWidth && after.height === expectedHeight
        ? "pass"
        : "fail",
  });
  checks.push({ id: "frames", status: after.frameCount === before.frameCount ? "pass" : "fail" });

  const pixelIntegrity = comparePixels(before, after, ctx);
  checks.push({
    id: "pixel-data",
    status:
      pixelIntegrity === "identical" || pixelIntegrity === "transformed"
        ? "pass"
        : pixelIntegrity === "mismatch"
          ? "fail"
          : "unverifiable",
  });

  // Orientation 1 ("normal") carries no information; ignore it if a format forces it to stay.
  const stillPresentSet = new Set<MetadataCategory>();
  const retainedSet = new Set<MetadataCategory>();
  for (const tag of after.tags) {
    if (tag.category === "structural") continue;
    if (tag.category === "orientation" && Number(tag.value) === 1 && !allowed.has("orientation")) continue;
    if (allowed.has(tag.category)) retainedSet.add(tag.category);
    else stillPresentSet.add(tag.category);
  }
  const stillPresent = [...stillPresentSet];
  checks.push({ id: "metadata-removed", status: stillPresent.length === 0 ? "pass" : "fail" });

  const retained = [...retainedSet].map((category) => ({ category, reason: allowed.get(category)! }));
  return { status: overallStatus(checks), checks, pixelIntegrity, retained, stillPresent };
}

function comparePixels(before: FileFacts, after: FileFacts, ctx: VerificationContext): PixelIntegrity {
  if (ctx.pixelsTransformed) return "transformed";
  if (!before.pixelHash || !after.pixelHash) return "not-verifiable";
  return before.pixelHash === after.pixelHash ? "identical" : "mismatch";
}

function overallStatus(checks: VerificationCheck[]): VerificationStatus {
  if (checks.some((c) => c.status === "fail")) return "failed";
  if (checks.some((c) => c.status === "unverifiable")) return "partial";
  return "verified";
}
