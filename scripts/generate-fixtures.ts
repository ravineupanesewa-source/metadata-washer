/**
 * Generates deterministic test fixtures with real, known metadata.
 * Run with: npm run fixtures
 *
 * Sharp creates the pixel data; ExifTool writes the metadata so the
 * fixtures exercise the same parser the application relies on.
 */
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ExifTool } from "exiftool-vendored";

const OUT = path.resolve(import.meta.dirname, "../tests/fixtures");
const et = new ExifTool({ maxProcs: 1, taskTimeoutMillis: 30_000 });

const PRIVATE_TAGS = {
  "EXIF:Make": "FixtureCam",
  "EXIF:Model": "FC-1000",
  "EXIF:SerialNumber": "SN-0042-SECRET",
  "EXIF:LensModel": "FixtureLens 35mm",
  "EXIF:DateTimeOriginal": "2024:05:06 07:08:09",
  "EXIF:Software": "FixtureEditor 1.0",
  "EXIF:GPSLatitude": 27.7172,
  "EXIF:GPSLatitudeRef": "N",
  "EXIF:GPSLongitude": 85.324,
  "EXIF:GPSLongitudeRef": "E",
  "XMP:Creator": ["Jane Fixture"],
  "XMP:Rating": 4,
  "XMP:Label": "Red",
} as const;

const IPTC_TAGS = {
  "IPTC:By-line": "Jane Fixture",
  "IPTC:Caption-Abstract": "Secret caption",
  "IPTC:Keywords": ["home", "family"],
  "IPTC:City": "Kathmandu",
} as const;

function gradient(width: number, height: number) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      data[i] = Math.round((x / width) * 255);
      data[i + 1] = Math.round((y / height) * 255);
      data[i + 2] = 128;
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } });
}

async function write(name: string, buf: Buffer) {
  const file = path.join(OUT, name);
  await writeFile(file, buf);
  return file;
}

async function tag(file: string, tags: Record<string, unknown>, extraArgs: string[] = []) {
  await et.write(file, tags as never, { writeArgs: ["-overwrite_original", ...extraArgs] });
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // JPEG: GPS, camera, timestamps, IPTC, XMP, comment, EXIF thumbnail, orientation 6.
  const thumb = await write("_thumb.jpg", await gradient(16, 12).jpeg().toBuffer());
  const jpegOriented = await write("jpeg-full-orient6.jpg", await gradient(64, 48).jpeg({ quality: 90 }).toBuffer());
  await tag(jpegOriented, { ...PRIVATE_TAGS, ...IPTC_TAGS, "EXIF:Orientation": 6, "File:Comment": "secret comment" }, ["-n"]);
  await et.write(jpegOriented, {} as never, { writeArgs: ["-overwrite_original", `-ThumbnailImage<=${thumb}`] });
  await rm(thumb);

  // JPEG with orientation 1 and an embedded Display-P3 ICC profile.
  const jpegIcc = await write("jpeg-icc.jpg", await gradient(64, 48).withIccProfile("p3").jpeg({ quality: 90 }).toBuffer());
  await tag(jpegIcc, { ...PRIVATE_TAGS, "EXIF:Orientation": 1 }, ["-n"]);

  // JPEG without any metadata.
  await write("jpeg-clean.jpg", await gradient(32, 32).jpeg().toBuffer());

  // PNG with textual chunks, eXIf and an iCCP profile.
  const png = await write("png-text.png", await gradient(40, 30).withIccProfile("p3").png().toBuffer());
  await tag(png, { ...PRIVATE_TAGS, "PNG:Author": "Jane Fixture", "PNG:Comment": "secret png comment", "PNG:Description": "home address" });

  // WebP with EXIF and XMP chunks.
  const webp = await write("webp-meta.webp", await gradient(40, 30).withIccProfile("p3").webp({ quality: 90 }).toBuffer());
  await tag(webp, PRIVATE_TAGS);

  // TIFF with representative metadata.
  const tiff = await write("tiff-meta.tif", await gradient(40, 30).tiff({ compression: "lzw" }).toBuffer());
  await tag(tiff, { ...PRIVATE_TAGS, ...IPTC_TAGS, "EXIF:Artist": "Jane Fixture", "EXIF:Orientation": 1 }, ["-n"]);

  // AVIF (HEIF container) with EXIF/XMP.
  const avif = await write("avif-meta.avif", await gradient(40, 30).avif({ quality: 70 }).toBuffer());
  await tag(avif, PRIVATE_TAGS);

  // Animated GIF (3 frames) with a comment and XMP.
  const frames = await Promise.all([0, 1, 2].map((i) => gradient(20, 20).modulate({ hue: i * 90 }).png().toBuffer()));
  const gif = await write("gif-animated.gif", await sharp(frames, { join: { animated: true } }).gif({ delay: [100, 200, 300], loop: 0 }).toBuffer());
  await tag(gif, { Comment: "secret gif comment", "XMP:Creator": ["Jane Fixture"] });

  // Negative fixtures.
  const valid = await readFile(jpegIcc);
  await write("truncated.jpg", valid.subarray(0, Math.floor(valid.length / 2)));
  await write("png-named-as.jpg", await readFile(png));
  await write("not-an-image.jpg", Buffer.from("this is plain text pretending to be a jpeg\n"));
  await write("empty.png", Buffer.alloc(0));
  await write("vector.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
  await write("bitmap.bmp", bmp(8, 8));
}

/** Minimal 24-bit BMP; used only as an unsupported-format fixture. */
function bmp(width: number, height: number) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowSize * height;
  const b = Buffer.alloc(size);
  b.write("BM", 0, "ascii");
  b.writeUInt32LE(size, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(width, 18);
  b.writeInt32LE(height, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  return b;
}

main()
  .then(() => console.log(`Fixtures written to ${OUT}`))
  .finally(() => et.end());
