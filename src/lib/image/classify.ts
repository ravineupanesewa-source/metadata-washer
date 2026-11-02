import type { CategoryCount, MetadataCategory } from "./types";
import { METADATA_CATEGORIES } from "./types";

/**
 * Maps ExifTool tags (read with `-G0:1 -j -n`) to user-facing metadata
 * categories. Tags that describe how to decode the image (dimensions, bit
 * depth, strip offsets, container boxes) are "structural" and never counted as
 * metadata.
 */

export interface RawTag {
  group0: string;
  group1: string;
  name: string;
  value: unknown;
}

export interface ClassifiedTag extends RawTag {
  category: MetadataCategory | "structural";
}

/** Family-0 groups that never contain embedded metadata. */
const NON_METADATA_GROUPS = new Set(["ExifTool", "File", "Composite", "System", "SourceFile"]);

/** TIFF/EXIF IFD0 tags required to decode the image (or harmless rendering hints). */
const STRUCTURAL_EXIF_TAGS = new Set([
  "ImageWidth",
  "ImageHeight",
  "BitsPerSample",
  "Compression",
  "PhotometricInterpretation",
  "FillOrder",
  "StripOffsets",
  "SamplesPerPixel",
  "RowsPerStrip",
  "StripByteCounts",
  "XResolution",
  "YResolution",
  "PlanarConfiguration",
  "ResolutionUnit",
  "Predictor",
  "SampleFormat",
  "SMinSampleValue",
  "SMaxSampleValue",
  "MinSampleValue",
  "MaxSampleValue",
  "TileWidth",
  "TileLength",
  "TileOffsets",
  "TileByteCounts",
  "ExtraSamples",
  "ColorMap",
  "SubfileType",
  "OldSubfileType",
  "YCbCrCoefficients",
  "YCbCrSubSampling",
  "YCbCrPositioning",
  "ReferenceBlackWhite",
  "JPEGTables",
  "TransferFunction",
  "WhitePoint",
  "PrimaryChromaticities",
  "InkSet",
  "NumberofInks",
  "DotRange",
  "T4Options",
  "T6Options",
  "Threshholding",
  "CellWidth",
  "CellLength",
  "HalftoneHints",
]);

/** PNG chunk-derived tags that describe pixels, not people. */
const STRUCTURAL_PNG_TAGS = new Set([
  "ImageWidth",
  "ImageHeight",
  "BitDepth",
  "ColorType",
  "Compression",
  "Filter",
  "Interlace",
  "Palette",
  "Transparency",
  "BackgroundColor",
  "Gamma",
  "SRGBRendering",
  "WhitePointX",
  "WhitePointY",
  "RedX",
  "RedY",
  "GreenX",
  "GreenY",
  "BlueX",
  "BlueY",
  "PixelsPerUnitX",
  "PixelsPerUnitY",
  "PixelUnits",
  "SignificantBits",
  "AnimationFrames",
  "AnimationPlays",
  "CICPColourPrimaries",
  "CICPTransferCharacteristics",
  "CICPMatrixCoefficients",
  "CICPVideoFullRangeFlag",
]);

const GIF_METADATA_TAGS: Record<string, MetadataCategory> = {
  Comment: "comments",
  Text: "comments",
};

/** QuickTime/HEIF groups that may carry user metadata rather than codec structure. */
const QUICKTIME_METADATA_GROUP1 = new Set(["Keys", "ItemList", "UserData"]);

const LOCATION_IPTC_TAGS = new Set([
  "City",
  "Sub-location",
  "Province-State",
  "Country-PrimaryLocationName",
  "Country-PrimaryLocationCode",
]);

const LOCATION_XMP_PREFIXES = ["GPS", "Location"];
const LOCATION_XMP_TAGS = new Set(["City", "State", "Country", "CountryCode", "Sublocation"]);

const DEVICE_TAGS = new Set([
  "Make",
  "Model",
  "LensMake",
  "LensModel",
  "LensInfo",
  "Lens",
  "LensID",
  "LensSerialNumber",
  "SerialNumber",
  "BodySerialNumber",
  "InternalSerialNumber",
  "CameraSerialNumber",
  "CameraOwnerName",
  "OwnerName",
  "UniqueCameraModel",
  "HostComputer",
  "Software",
  "ProcessingSoftware",
  "ImageUniqueID",
]);

function isTimestamp(name: string): boolean {
  return /Date|Time(?!s?Zone)|SubSec|OffsetTime/.test(name) && !/Exposure|Shutter/.test(name);
}

export function classifyTag(tag: RawTag): ClassifiedTag["category"] {
  const { group0, group1, name } = tag;
  if (NON_METADATA_GROUPS.has(group0)) return "structural";

  switch (group0) {
    case "ICC_Profile":
      return "icc-profile";
    case "MakerNotes":
      return "maker-notes";
    case "IPTC":
      return LOCATION_IPTC_TAGS.has(name) ? "location" : "iptc";
    case "Photoshop":
      return "photoshop";
    case "XMP":
      if (LOCATION_XMP_TAGS.has(name) || LOCATION_XMP_PREFIXES.some((p) => name.startsWith(p))) {
        return "location";
      }
      return "xmp";
    case "PNG":
      if (name === "ProfileName") return "icc-profile";
      return STRUCTURAL_PNG_TAGS.has(name) ? "structural" : "text-chunks";
    case "GIF":
      return GIF_METADATA_TAGS[name] ?? "structural";
    case "RIFF":
      // WebP chunk structure. EXIF/XMP/ICC chunks are reported under their own groups.
      return "structural";
    case "QuickTime":
      return QUICKTIME_METADATA_GROUP1.has(group1) ? "other" : "structural";
    case "JFIF":
    case "APP14":
    case "Adobe":
      // Resolution / colour-transform hints required for correct decoding.
      return "structural";
    case "EXIF":
      return classifyExif(group1, name);
    default:
      // Comments live in the File group for JPEG (COM segment) under family 1 "File".
      return "other";
  }
}

function classifyExif(group1: string, name: string): ClassifiedTag["category"] {
  if (group1 === "GPS") return "location";
  if (group1 === "IFD1" || /Thumbnail|PreviewImage/.test(name)) return "thumbnails";
  if (name === "Orientation") return "orientation";
  if (STRUCTURAL_EXIF_TAGS.has(name)) return "structural";
  if (DEVICE_TAGS.has(name)) return "device";
  if (name === "MakerNoteUnknown" || name.startsWith("MakerNote")) return "maker-notes";
  if (isTimestamp(name)) return "timestamps";
  if (group1 === "ExifIFD") return "camera-settings";
  return "exif-other";
}

/**
 * Parses one ExifTool JSON object (from `-j -G0:1`) into tags.
 * Keys look like "EXIF:IFD0:Make", "IPTC:Keywords" or "SourceFile".
 */
export function parseExifToolJson(record: Record<string, unknown>): ClassifiedTag[] {
  const tags: ClassifiedTag[] = [];
  for (const [key, value] of Object.entries(record)) {
    const parts = key.split(":");
    if (parts.length < 2) continue; // SourceFile and other ungrouped keys
    const name = parts[parts.length - 1];
    const group0 = parts[0];
    const group1 = parts.length > 2 ? parts[1] : group0;
    const raw: RawTag = { group0, group1, name, value };
    tags.push({ ...raw, category: classifyJpegComment(raw) ?? classifyTag(raw) });
  }
  return tags;
}

/** JPEG COM segments are reported as "File:Comment"; they are user metadata. */
function classifyJpegComment(tag: RawTag): MetadataCategory | null {
  return tag.group0 === "File" && tag.name === "Comment" ? "comments" : null;
}

export function countCategories(tags: readonly ClassifiedTag[]): CategoryCount[] {
  const counts = new Map<MetadataCategory, number>();
  for (const tag of tags) {
    if (tag.category === "structural") continue;
    counts.set(tag.category, (counts.get(tag.category) ?? 0) + 1);
  }
  return METADATA_CATEGORIES.filter((c) => counts.has(c)).map((category) => ({
    category,
    count: counts.get(category)!,
  }));
}
