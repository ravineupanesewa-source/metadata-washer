import type { ImageFormat } from "./types";

/**
 * Content-based format detection. Filenames and declared MIME types are never
 * trusted; only the leading bytes of the file decide the format.
 * Pure function so it runs identically in the browser and on the server.
 */

export type SignatureResult =
  | { kind: "supported"; format: ImageFormat }
  | { kind: "unsupported"; label: string }
  | { kind: "unknown" };

/** Bytes needed to identify every format we know about. */
export const SIGNATURE_BYTES = 64;

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1", "mif2"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (bytes.length < start + length) return "";
  let out = "";
  for (let i = start; i < start + length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

function detectIsoBmff(bytes: Uint8Array): SignatureResult | null {
  if (ascii(bytes, 4, 4) !== "ftyp") return null;
  const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  const end = Math.min(bytes.length, boxSize >= 16 ? boxSize : 16);
  const brands = [ascii(bytes, 8, 4)];
  for (let offset = 16; offset + 4 <= end; offset += 4) brands.push(ascii(bytes, offset, 4));

  // AVIF files also list mif1, so check AVIF brands first.
  if (brands.some((b) => AVIF_BRANDS.has(b))) return { kind: "supported", format: "avif" };
  if (brands.some((b) => HEIF_BRANDS.has(b))) return { kind: "supported", format: "heic" };
  return { kind: "unsupported", label: "ISO media (video or other container)" };
}

export function detectSignature(bytes: Uint8Array): SignatureResult {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: "supported", format: "jpeg" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: "supported", format: "png" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { kind: "supported", format: "webp" };
  }
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return { kind: "supported", format: "tiff" };
  }
  if (startsWith(bytes, [0x49, 0x49, 0x2b, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2b])) {
    return { kind: "unsupported", label: "BigTIFF" };
  }
  const gifHeader = ascii(bytes, 0, 6);
  if (gifHeader === "GIF87a" || gifHeader === "GIF89a") return { kind: "supported", format: "gif" };

  const iso = detectIsoBmff(bytes);
  if (iso) return iso;

  if (ascii(bytes, 0, 2) === "BM") return { kind: "unsupported", label: "BMP" };
  if (ascii(bytes, 0, 4) === "%PDF") return { kind: "unsupported", label: "PDF" };
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return { kind: "unsupported", label: "ICO" };
  if (startsWith(bytes, [0xff, 0x0a]) || startsWith(bytes, [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20])) {
    return { kind: "unsupported", label: "JPEG XL" };
  }
  if (looksLikeSvg(bytes)) return { kind: "unsupported", label: "SVG" };
  return { kind: "unknown" };
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = ascii(bytes, 0, Math.min(bytes.length, SIGNATURE_BYTES)).trimStart().toLowerCase();
  return head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"));
}
