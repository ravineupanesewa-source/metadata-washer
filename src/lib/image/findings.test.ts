import { describe, expect, it } from "vitest";
import { parseExifToolJson } from "./classify";
import { extractFindings } from "./findings";
import type { ProcessingReport } from "./types";

const report = (metadata: Partial<ProcessingReport["metadata"]> = {}): Pick<ProcessingReport, "metadata"> => ({
  metadata: { before: [], removed: [], retained: [], stillPresent: [], noMetadataDetected: false, ...metadata },
});

/** Mirrors `tests/fixtures/jpeg-full-orient6.jpg` as read with `-j -G0:1 -a -n`. */
const FULL = {
  "File:FileType": "JPEG",
  "EXIF:IFD0:Make": "FixtureCam",
  "EXIF:IFD0:Model": "FC-1000",
  "EXIF:IFD0:Orientation": 6,
  "EXIF:IFD0:Software": "FixtureEditor 1.0",
  "EXIF:ExifIFD:DateTimeOriginal": "2024:05:06 07:08:09",
  "EXIF:ExifIFD:OffsetTimeOriginal": "+05:45",
  "EXIF:ExifIFD:SerialNumber": "SN-0042-SECRET",
  "EXIF:ExifIFD:LensModel": "FixtureLens 35mm",
  "EXIF:GPS:GPSLatitudeRef": "N",
  "EXIF:GPS:GPSLatitude": 27.7172,
  "EXIF:GPS:GPSLongitudeRef": "E",
  "EXIF:GPS:GPSLongitude": 85.324,
  "EXIF:IFD1:ThumbnailLength": 310,
  "EXIF:IFD1:ThumbnailImage": "(Binary data 310 bytes, use -b option to extract)",
  "IPTC:Keywords": ["home", "family"],
  "IPTC:By-line": "Jane Fixture",
  "IPTC:City": "Kathmandu",
  "IPTC:Caption-Abstract": "Secret caption",
  "XMP:XMP-dc:Creator": "Jane Fixture",
  "File:Comment": "secret comment",
  "Composite:GPSLatitude": 27.7172,
  "Composite:GPSLongitude": 85.324,
};

const byKind = (findings: ReturnType<typeof extractFindings>) => Object.fromEntries(findings.items.map((i) => [i.kind, i]));

describe("extractFindings", () => {
  it("surfaces the personal details a person would recognise", () => {
    const findings = extractFindings(parseExifToolJson(FULL), report());
    expect(findings.gps).toEqual({ latitude: 27.7172, longitude: 85.324, altitude: null, fate: "removed" });
    const k = byKind(findings);
    expect(k.place.value).toBe("Kathmandu");
    expect(k.serial.value).toBe("SN-0042-SECRET");
    expect(k.owner.value).toBe("Jane Fixture"); // By-line and Creator deduplicated
    expect(k.captured.value).toBe("2024-05-06 07:08:09");
    expect(k.device.value).toBe("FixtureCam FC-1000");
    expect(k.lens.value).toBe("FixtureLens 35mm");
    expect(k.software.value).toBe("FixtureEditor 1.0");
    expect(k.keywords.value).toBe("home, family");
    expect(k.description.value).toBe("Secret caption");
    expect(k.thumbnail).toMatchObject({ category: "thumbnails", value: "310" });
    // Capture time and device read as one story.
    const kinds = findings.items.map((i) => i.kind);
    expect(kinds.indexOf("device")).toBe(kinds.indexOf("captured") + 1);
  });

  it("never reports orientation, structure or binary blobs as findings", () => {
    const kinds = extractFindings(parseExifToolJson(FULL), report()).items.map((i) => i.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const item of extractFindings(parseExifToolJson(FULL), report()).items) {
      expect(item.value).not.toMatch(/Binary data/);
    }
  });

  it("reflects what happened to each category", () => {
    const findings = extractFindings(
      parseExifToolJson(FULL),
      report({ retained: [{ category: "device", reason: "color-rendering" }], stillPresent: ["location"] }),
    );
    expect(findings.gps?.fate).toBe("still-present");
    expect(byKind(findings).device.fate).toBe("kept");
    expect(byKind(findings).owner.fate).toBe("removed");
  });

  it("derives signed coordinates from EXIF refs when Composite is missing", () => {
    const findings = extractFindings(
      parseExifToolJson({
        "EXIF:GPS:GPSLatitudeRef": "S",
        "EXIF:GPS:GPSLatitude": 33.8688,
        "EXIF:GPS:GPSLongitudeRef": "W",
        "EXIF:GPS:GPSLongitude": 151.2093,
        "EXIF:GPS:GPSAltitude": 12.34,
        "EXIF:GPS:GPSAltitudeRef": 1,
      }),
      report(),
    );
    expect(findings.gps).toEqual({ latitude: -33.8688, longitude: -151.2093, altitude: -12.3, fate: "removed" });
  });

  it("rejects impossible coordinates and empty or boilerplate values", () => {
    const findings = extractFindings(
      parseExifToolJson({
        "EXIF:GPS:GPSLatitude": 123,
        "EXIF:GPS:GPSLongitude": 10,
        "EXIF:IFD0:ImageDescription": "OLYMPUS DIGITAL CAMERA",
        "EXIF:ExifIFD:DateTimeOriginal": "0000:00:00 00:00:00",
        "EXIF:IFD0:Artist": "   ",
      }),
      report(),
    );
    expect(findings.gps).toBeNull();
    expect(findings.items).toEqual([]);
  });

  it("does not repeat the make when the model already contains it", () => {
    const k = byKind(extractFindings(parseExifToolJson({ "EXIF:IFD0:Make": "Canon", "EXIF:IFD0:Model": "Canon EOS R6" }), report()));
    expect(k.device.value).toBe("Canon EOS R6");
  });

  it("truncates long values and strips control characters", () => {
    const k = byKind(
      extractFindings(parseExifToolJson({ "EXIF:IFD0:ImageDescription": `a\u0007b${"x".repeat(400)}` }), report()),
    );
    expect(k.description.value.startsWith("ab")).toBe(true);
    expect(k.description.value.length).toBeLessThanOrEqual(121);
  });

  it("counts XMP edit history steps", () => {
    const k = byKind(
      extractFindings(parseExifToolJson({ "XMP:XMP-xmpMM:HistoryAction": ["created", "saved", "saved"] }), report()),
    );
    expect(k["edit-history"].value).toBe("3");
  });
});
