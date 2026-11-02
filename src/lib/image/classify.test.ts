import { describe, expect, it } from "vitest";
import { countCategories, parseExifToolJson } from "./classify";

describe("parseExifToolJson", () => {
  const tags = parseExifToolJson({
    SourceFile: "/tmp/x.jpg",
    "File:System:FileSize": 10,
    "File:Comment": "hello",
    "EXIF:IFD0:Make": "Canon",
    "EXIF:IFD0:Orientation": 6,
    "EXIF:IFD0:YCbCrPositioning": 1,
    "EXIF:ExifIFD:DateTimeOriginal": "2024:01:01 00:00:00",
    "EXIF:ExifIFD:ExposureTime": 0.01,
    "EXIF:ExifIFD:BodySerialNumber": "123",
    "EXIF:GPS:GPSLatitude": 1,
    "EXIF:IFD1:ThumbnailImage": "base64:...",
    "MakerNotes:Canon:LensType": 1,
    "IPTC:City": "Paris",
    "IPTC:Keywords": ["a"],
    "XMP:XMP-photoshop:City": "Paris",
    "XMP:XMP-dc:Creator": "me",
    "ICC_Profile:ICC-header:ProfileVersion": "4",
    "PNG:Comment": "x",
    "PNG:BitDepth": 8,
    "GIF:Comment": "x",
    "GIF:FrameCount": 3,
    "Composite:GPSPosition": "1 2",
    "Photoshop:IPTCDigest": "abc",
  });
  const byName = Object.fromEntries(tags.map((t) => [`${t.group0}:${t.name}`, t.category]));

  it.each([
    ["File:FileSize", "structural"],
    ["File:Comment", "comments"],
    ["EXIF:Make", "device"],
    ["EXIF:Orientation", "orientation"],
    ["EXIF:YCbCrPositioning", "structural"],
    ["EXIF:DateTimeOriginal", "timestamps"],
    ["EXIF:ExposureTime", "camera-settings"],
    ["EXIF:BodySerialNumber", "device"],
    ["EXIF:GPSLatitude", "location"],
    ["EXIF:ThumbnailImage", "thumbnails"],
    ["MakerNotes:LensType", "maker-notes"],
    ["IPTC:City", "location"],
    ["IPTC:Keywords", "iptc"],
    ["XMP:City", "location"],
    ["XMP:Creator", "xmp"],
    ["ICC_Profile:ProfileVersion", "icc-profile"],
    ["PNG:Comment", "text-chunks"],
    ["PNG:BitDepth", "structural"],
    ["GIF:Comment", "comments"],
    ["GIF:FrameCount", "structural"],
    ["Composite:GPSPosition", "structural"],
    ["Photoshop:IPTCDigest", "photoshop"],
  ])("%s → %s", (key, category) => {
    expect(byName[key]).toBe(category);
  });

  it("ignores ungrouped keys and counts only metadata", () => {
    expect(tags.some((t) => t.name === "SourceFile")).toBe(false);
    const counts = countCategories(tags);
    expect(counts.find((c) => c.category === "location")?.count).toBe(3);
    expect(counts.some((c) => (c.category as string) === "structural")).toBe(false);
  });
});
