import { getCapability } from "./capabilities";
import type { ClassifiedTag } from "./classify";
import type { ImageFormat, MetadataMode } from "./types";

/**
 * Builds ExifTool argument lists. ExifTool rewrites only metadata containers,
 * so image data stays byte-identical (proved later by ImageDataHash).
 */

export interface StripPlan {
  format: ImageFormat;
  mode: MetadataMode;
  keepOrientationTag: boolean;
}

/**
 * IFD0 tags that ExifTool cannot delete from TIFF with `-all=` (IFD0 itself is
 * required) but that can be deleted individually.
 */
export const TIFF_IFD0_DESCRIPTIVE_TAGS = [
  "Make",
  "Model",
  "Software",
  "Artist",
  "Copyright",
  "ImageDescription",
  "ModifyDate",
  "HostComputer",
  "DocumentName",
  "PageName",
  "PageNumber",
  "XPosition",
  "YPosition",
  "XPTitle",
  "XPComment",
  "XPAuthor",
  "XPKeywords",
  "XPSubject",
  "Rating",
  "RatingPercent",
] as const;

/** PNG ancillary chunks that affect colour rendering (kept in privacy mode). */
const PNG_COLOR_TAGS = ["-PNG:Gamma", "-PNG:SRGBRendering", "-PNG-cHRM:all", "-PNG:CICP*"];

export function buildStripArgs(plan: StripPlan, inputPath: string, outputPath: string): string[] {
  const capability = getCapability(plan.format);
  const restore: string[] = [];

  if (plan.mode === "privacy" && capability.supportsIcc) {
    restore.push("-ICC_Profile");
    if (plan.format === "png") restore.push(...PNG_COLOR_TAGS);
  }
  if (plan.keepOrientationTag) restore.push("-EXIF:Orientation");

  const args = ["-all="];
  if (restore.length > 0) args.push("-tagsFromFile", "@", ...restore);
  if (capability.requiresIfd0Cleanup) {
    args.push(...TIFF_IFD0_DESCRIPTIVE_TAGS.map((tag) => `-IFD0:${tag}=`));
    if (!plan.keepOrientationTag) args.push("-IFD0:Orientation=");
  }
  args.push("-o", outputPath, inputPath);
  return args;
}

/**
 * Second-pass deletions for residual IFD0 tags that a TIFF still carries after
 * the main strip. Tag names come from ExifTool's own output and are validated
 * against a strict pattern before use.
 */
export function buildResidualArgs(residual: readonly ClassifiedTag[], filePath: string): string[] | null {
  const deletions = residual
    .filter((tag) => tag.group0 === "EXIF" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(tag.name))
    .map((tag) => `-${tag.group1}:${tag.name}=`)
    .filter((arg) => /^-[A-Za-z0-9]+:[A-Za-z][A-Za-z0-9_-]*=$/.test(arg));
  if (deletions.length === 0) return null;
  return [...new Set(deletions), "-overwrite_original", filePath];
}
