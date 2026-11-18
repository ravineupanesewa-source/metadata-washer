import type { ClassifiedTag } from "./classify";
import { formatValue } from "./format-value";
import type {
  FindingFate,
  FindingKind,
  GpsFinding,
  MetadataCategory,
  MetadataFinding,
  MetadataFindings,
  ProcessingReport,
} from "./types";

/**
 * Picks the handful of metadata values a person would recognise as personal
 * ("this photo knew where I live") out of the tags read before cleaning.
 *
 * Input tags come from `readMetadata` (ExifTool `-j -G0:1 -a -n`), so numbers
 * are numeric and GPS coordinates are decimal degrees. Only tags in a real
 * metadata category are used, except the Composite GPS position, which is
 * derived from (and stands for) the EXIF/XMP GPS tags.
 */

const MAX_VALUE_LENGTH = 120;
const MAX_PARTS = 4;

type Tag = ClassifiedTag & { category: MetadataCategory };

interface Rule {
  kind: FindingKind;
  /** Tag names, in priority order. */
  names: readonly string[];
  /** Combine every distinct match (true) or use the first one (false). */
  join?: boolean;
  separator?: string;
  format?: (value: unknown, tag: Tag) => string | null;
}

const PLACE_ORDER = [
  "Sub-location",
  "Sublocation",
  "Location",
  "City",
  "Province-State",
  "State",
  "Country-PrimaryLocationName",
  "Country",
];

const RULES: readonly Rule[] = [
  { kind: "place", names: PLACE_ORDER, join: true, separator: ", " },
  {
    kind: "serial",
    names: ["SerialNumber", "BodySerialNumber", "CameraSerialNumber", "InternalSerialNumber", "LensSerialNumber"],
    join: true,
  },
  {
    kind: "owner",
    names: ["OwnerName", "CameraOwnerName", "Artist", "Creator", "By-line", "Copyright", "CopyrightNotice", "Rights", "Author"],
    join: true,
  },
  { kind: "unique-id", names: ["ImageUniqueID", "DocumentID", "OriginalDocumentID", "InstanceID"] },
  { kind: "captured", names: ["DateTimeOriginal", "CreateDate", "DateCreated", "DateTimeDigitized", "CreationTime", "ModifyDate"], format: formatDate },
  { kind: "description", names: ["ImageDescription", "Caption-Abstract", "Description", "Headline", "Title", "UserComment", "Comment", "XPComment"] },
  { kind: "keywords", names: ["Keywords", "Subject", "XPKeywords"], join: true, separator: ", " },
  { kind: "host", names: ["HostComputer"] },
  { kind: "lens", names: ["LensModel", "Lens", "LensID", "LensInfo"] },
  { kind: "software", names: ["Software", "ProcessingSoftware", "CreatorTool", "HistorySoftwareAgent"], join: true },
];

/** Camera vendors that write a placeholder description no person typed. */
const BOILERPLATE = /^(OLYMPUS DIGITAL CAMERA|SAMSUNG|SONY DSC|DCIM|default|Untitled|Description|ASCII)$/i;

export function extractFindings(tags: readonly ClassifiedTag[], report: Pick<ProcessingReport, "metadata">): MetadataFindings {
  const fate = fateResolver(report);
  const meta = tags.filter((t): t is Tag => t.category !== "structural");
  const byName = new Map<string, Tag[]>();
  for (const tag of meta) {
    const list = byName.get(tag.name);
    if (list) list.push(tag);
    else byName.set(tag.name, [tag]);
  }

  const items: MetadataFinding[] = [];
  const device = deviceFinding(byName, fate);
  for (const rule of RULES) {
    const finding = applyRule(rule, byName, fate);
    if (finding) items.push(finding);
    // Keep the device right after the capture time: they read as one story.
    if (rule.kind === "captured" && device) items.push(device);
  }

  const thumbnail = meta.find((t) => t.category === "thumbnails");
  if (thumbnail) {
    items.push({ kind: "thumbnail", category: "thumbnails", value: thumbnailValue(meta), fate: fate("thumbnails") });
  }
  const history = meta.filter((t) => t.group0 === "XMP" && /^History(Action|When|Changed)$/.test(t.name));
  if (history.length > 0) {
    const steps = Math.max(...history.map((t) => (Array.isArray(t.value) ? t.value.length : 1)));
    items.push({ kind: "edit-history", category: history[0].category, value: String(steps), fate: fate(history[0].category) });
  }

  return { version: 1, gps: gpsFinding(tags, fate), items };
}

function fateResolver(report: Pick<ProcessingReport, "metadata">) {
  const kept = new Set(report.metadata.retained.map((r) => r.category));
  const still = new Set(report.metadata.stillPresent);
  return (category: MetadataCategory): FindingFate =>
    still.has(category) ? "still-present" : kept.has(category) ? "kept" : "removed";
}

function applyRule(rule: Rule, byName: Map<string, Tag[]>, fate: (c: MetadataCategory) => FindingFate): MetadataFinding | null {
  const values: string[] = [];
  let source: Tag | null = null;
  for (const name of rule.names) {
    for (const tag of byName.get(name) ?? []) {
      const text = rule.format ? rule.format(tag.value, tag) : clean(tag.value);
      if (!text || values.some((v) => v.toLowerCase() === text.toLowerCase())) continue;
      values.push(text);
      source ??= tag;
      if (!rule.join || values.length >= MAX_PARTS) break;
    }
    if (values.length > 0 && (!rule.join || values.length >= MAX_PARTS)) break;
  }
  if (!source) return null;
  return {
    kind: rule.kind,
    category: source.category,
    value: truncate(values.join(rule.separator ?? " · ")),
    fate: fate(source.category),
  };
}

function deviceFinding(byName: Map<string, Tag[]>, fate: (c: MetadataCategory) => FindingFate): MetadataFinding | null {
  const make = byName.get("Make")?.map((t) => ({ tag: t, text: clean(t.value) })).find((m) => m.text);
  const model = byName.get("Model")?.map((t) => ({ tag: t, text: clean(t.value) })).find((m) => m.text);
  const source = model ?? make;
  if (!source) return null;
  // "Apple" + "iPhone 15 Pro", but not "Canon" + "Canon EOS R6".
  const text =
    make && model && !model.text!.toLowerCase().startsWith(make.text!.toLowerCase().split(" ")[0])
      ? `${make.text} ${model.text}`
      : source.text!;
  return { kind: "device", category: source.tag.category, value: truncate(text), fate: fate(source.tag.category) };
}

/** Decimal degrees from Composite (signed), else EXIF/XMP with their hemisphere refs. */
function gpsFinding(tags: readonly ClassifiedTag[], fate: (c: MetadataCategory) => FindingFate): GpsFinding | null {
  const find = (group0: string, name: string) => tags.find((t) => t.group0 === group0 && t.name === name)?.value;
  const located = tags.some((t) => t.category === "location" && /^GPS(Latitude|Longitude|Position|Coordinates)/.test(t.name));
  if (!located) return null;

  let lat = toNumber(find("Composite", "GPSLatitude"));
  let lon = toNumber(find("Composite", "GPSLongitude"));
  if (lat === null || lon === null) {
    for (const group0 of ["EXIF", "XMP"]) {
      lat = signed(toNumber(find(group0, "GPSLatitude")), find(group0, "GPSLatitudeRef"), "S");
      lon = signed(toNumber(find(group0, "GPSLongitude")), find(group0, "GPSLongitudeRef"), "W");
      if (lat !== null && lon !== null) break;
    }
  }
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  let altitude = toNumber(find("Composite", "GPSAltitude"));
  if (altitude === null) {
    const raw = toNumber(find("EXIF", "GPSAltitude"));
    altitude = raw === null ? null : toNumber(find("EXIF", "GPSAltitudeRef")) === 1 ? -raw : raw;
  }
  return {
    latitude: round(lat, 6),
    longitude: round(lon, 6),
    altitude: altitude === null || Math.abs(altitude) > 100_000 ? null : round(altitude, 1),
    fate: fate("location"),
  };
}

function thumbnailValue(meta: readonly Tag[]): string {
  for (const tag of meta) {
    if (tag.category !== "thumbnails") continue;
    const match = /Binary data (\d+) bytes/.exec(String(tag.value));
    if (match) return match[1];
    if (/ThumbnailLength|PreviewImageLength/.test(tag.name)) {
      const n = toNumber(tag.value);
      if (n !== null && n > 0) return String(n);
    }
  }
  return "";
}

/** "2024:05:06 07:08:09+05:45" → "2024-05-06 07:08:09 +05:45". */
function formatDate(value: unknown): string | null {
  const text = clean(value);
  if (!text) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?/.exec(text);
  if (!m) return /^\d{4}-\d{2}-\d{2}/.test(text) ? text : null;
  if (m[1] === "0000") return null;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}${m[5] ? ` ${m[5]}` : ""}`;
}

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = formatValue(value, MAX_VALUE_LENGTH * 2);
  if (!text || text.startsWith("(Binary data") || text === "(binary data)" || text === "(structured data)") return null;
  if (BOILERPLATE.test(text) || /^[\s0.:-]*$/.test(text)) return null;
  return text;
}

function truncate(text: string): string {
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

function toNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function signed(value: number | null, ref: unknown, negative: "S" | "W"): number | null {
  if (value === null) return null;
  return typeof ref === "string" && ref.trim().toUpperCase().startsWith(negative) ? -Math.abs(value) : value;
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
