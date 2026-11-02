import type { ImageFormat } from "./types";

/**
 * Single source of truth for format support. Used by the API (validation and
 * sanitizer arguments), the UI (accept list and copy) and the tests.
 *
 * Every entry was verified against real fixtures with ExifTool 13.59 unless
 * `fixtureVerified` is false (see IMPLEMENTATION_PLAN.md §3).
 */
export interface FormatCapability {
  format: ImageFormat;
  label: string;
  mimeType: string;
  extensions: readonly string[];
  /** Whether an embedded ICC profile can be kept separately from other metadata. */
  supportsIcc: boolean;
  /** Where the format stores orientation, if anywhere. */
  orientation: "exif" | "container" | "none";
  /** Strategy used to prove image data is unchanged after a lossless strip. */
  pixelVerification: "image-data-hash" | "gif-blocks";
  /** Whether descriptive IFD0 tags survive `-all=` and must be deleted individually. */
  requiresIfd0Cleanup: boolean;
  /** Sharp can re-encode this format if the user explicitly allows it. */
  reencodable: boolean;
  /** False when no fixture could be produced locally; runtime verification still gates success. */
  fixtureVerified: boolean;
}

export const FORMAT_CAPABILITIES: Readonly<Record<ImageFormat, FormatCapability>> = {
  jpeg: {
    format: "jpeg",
    label: "JPEG",
    mimeType: "image/jpeg",
    extensions: ["jpg", "jpeg", "jpe", "jfif"],
    supportsIcc: true,
    orientation: "exif",
    pixelVerification: "image-data-hash",
    requiresIfd0Cleanup: false,
    reencodable: true,
    fixtureVerified: true,
  },
  png: {
    format: "png",
    label: "PNG",
    mimeType: "image/png",
    extensions: ["png"],
    supportsIcc: true,
    orientation: "exif",
    pixelVerification: "image-data-hash",
    requiresIfd0Cleanup: false,
    reencodable: true,
    fixtureVerified: true,
  },
  webp: {
    format: "webp",
    label: "WebP",
    mimeType: "image/webp",
    extensions: ["webp"],
    supportsIcc: true,
    orientation: "exif",
    pixelVerification: "image-data-hash",
    requiresIfd0Cleanup: false,
    reencodable: true,
    fixtureVerified: true,
  },
  tiff: {
    format: "tiff",
    label: "TIFF",
    mimeType: "image/tiff",
    extensions: ["tif", "tiff"],
    supportsIcc: true,
    orientation: "exif",
    pixelVerification: "image-data-hash",
    requiresIfd0Cleanup: true,
    reencodable: true,
    fixtureVerified: true,
  },
  avif: {
    format: "avif",
    label: "AVIF",
    mimeType: "image/avif",
    extensions: ["avif"],
    supportsIcc: true,
    orientation: "container",
    pixelVerification: "image-data-hash",
    requiresIfd0Cleanup: false,
    reencodable: false,
    fixtureVerified: true,
  },
  heic: {
    format: "heic",
    label: "HEIC / HEIF",
    mimeType: "image/heic",
    extensions: ["heic", "heif", "hif"],
    supportsIcc: true,
    orientation: "container",
    pixelVerification: "image-data-hash",
    requiresIfd0Cleanup: false,
    reencodable: false,
    fixtureVerified: false,
  },
  gif: {
    format: "gif",
    label: "GIF (incl. animated)",
    mimeType: "image/gif",
    extensions: ["gif"],
    supportsIcc: false,
    orientation: "none",
    pixelVerification: "gif-blocks",
    requiresIfd0Cleanup: false,
    reencodable: false,
    fixtureVerified: true,
  },
};

export const SUPPORTED_FORMATS = Object.values(FORMAT_CAPABILITIES);

export function getCapability(format: ImageFormat): FormatCapability {
  return FORMAT_CAPABILITIES[format];
}

/** ExifTool `FileType` values accepted for each detected format. */
export const EXIFTOOL_FILE_TYPES: Readonly<Record<ImageFormat, readonly string[]>> = {
  jpeg: ["JPEG"],
  png: ["PNG"],
  webp: ["WEBP", "Extended WEBP"],
  tiff: ["TIFF"],
  avif: ["AVIF"],
  heic: ["HEIC", "HEIF"],
  gif: ["GIF"],
};

/** `accept` map for react-dropzone / file inputs. Purely a UX hint. */
export function acceptMap(): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const cap of SUPPORTED_FORMATS) {
    map[cap.mimeType] = cap.extensions.map((ext) => `.${ext}`);
  }
  map["image/heif"] = [".heif"];
  return map;
}
