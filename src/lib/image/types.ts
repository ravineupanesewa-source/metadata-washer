/**
 * Types shared by the processing engine, API routes and UI.
 * This module must stay free of Node.js imports so client code can use it.
 */

export const IMAGE_FORMATS = ["jpeg", "png", "webp", "tiff", "avif", "heic", "gif"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export const METADATA_MODES = ["privacy", "strict"] as const;
export type MetadataMode = (typeof METADATA_MODES)[number];

/**
 * How to keep an EXIF-oriented image upright when the Orientation tag would
 * otherwise be removed (strict mode only; privacy mode always keeps the tag).
 */
export const ORIENTATION_POLICIES = ["preserve-tag", "lossless-or-fail", "allow-reencode"] as const;
export type OrientationPolicy = (typeof ORIENTATION_POLICIES)[number];

export interface ProcessingOptions {
  mode: MetadataMode;
  orientationPolicy: OrientationPolicy;
}

export const METADATA_CATEGORIES = [
  "location",
  "device",
  "timestamps",
  "camera-settings",
  "maker-notes",
  "thumbnails",
  "exif-other",
  "iptc",
  "xmp",
  "comments",
  "text-chunks",
  "photoshop",
  "icc-profile",
  "orientation",
  "other",
] as const;
export type MetadataCategory = (typeof METADATA_CATEGORIES)[number];

export interface CategoryCount {
  category: MetadataCategory;
  /** Number of tags ExifTool reported in this category (approximate for duplicated tags). */
  count: number;
}

export type RetainReason = "color-rendering" | "visible-orientation";

export interface RetainedCategory {
  category: MetadataCategory;
  reason: RetainReason;
}

export type ProcessingStatus = "success" | "partial" | "failed";
export type VerificationStatus = "verified" | "partial" | "failed";

export type OrientationAction =
  | "none"
  | "kept-tag"
  | "lossless-transform"
  | "reencode-transform";

export type PixelIntegrity =
  /** Image data hash before and after is identical. */
  | "identical"
  /** The format/toolchain cannot hash image data; dimensions and frames were still compared. */
  | "not-verifiable"
  /** Pixels were intentionally transformed (orientation correction). */
  | "transformed"
  /** Image data changed unexpectedly. Always a verification failure. */
  | "mismatch";

export interface VerificationCheck {
  id:
    | "format"
    | "dimensions"
    | "frames"
    | "pixel-data"
    | "metadata-removed"
    | "output-readable";
  status: "pass" | "fail" | "unverifiable";
}

export interface ImageFacts {
  format: ImageFormat;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  frameCount: number;
}

export interface ProcessingReport {
  version: 1;
  status: ProcessingStatus;
  mode: MetadataMode;
  input: ImageFacts;
  output: ImageFacts | null;
  metadata: {
    before: CategoryCount[];
    removed: MetadataCategory[];
    retained: RetainedCategory[];
    /** Categories still present that should have been removed. Non-empty means failure. */
    stillPresent: MetadataCategory[];
    noMetadataDetected: boolean;
  };
  icc: { present: boolean; retained: boolean };
  orientation: { original: number | null; action: OrientationAction };
  pixelData: { reencoded: boolean; integrity: PixelIntegrity };
  verification: { status: VerificationStatus; checks: VerificationCheck[] };
  /** Stable, user-safe notice codes. Never raw tool output. */
  notices: NoticeCode[];
}

export type NoticeCode =
  | "icc-retained"
  | "icc-removed-color-may-change"
  | "orientation-tag-kept"
  | "orientation-lossless-transform"
  | "orientation-reencoded"
  | "pixel-integrity-not-verifiable"
  | "format-container-orientation"
  | "untested-format";

/** Metadata tag exposed by the inspect endpoint. Values only when explicitly requested. */
export interface InspectedTag {
  group: string;
  name: string;
  category: MetadataCategory;
  value?: string;
}

export interface InspectionResult {
  format: ImageFormat;
  width: number | null;
  height: number | null;
  frameCount: number;
  orientation: number | null;
  categories: CategoryCount[];
  tags: InspectedTag[];
}
