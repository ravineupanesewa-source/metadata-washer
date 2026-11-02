import { createHash } from "node:crypto";

/**
 * Hashes only the parts of a GIF that affect rendering: logical screen
 * descriptor, global colour table, graphic control extensions (timing,
 * disposal, transparency), NETSCAPE looping extension, image descriptors,
 * local colour tables and LZW image data. Comment, XMP and other application
 * extensions are skipped, so the hash is equal before and after metadata
 * removal if and only if the animation itself is unchanged.
 *
 * Returns null for malformed input.
 */
export function gifRenderHash(bytes: Uint8Array): { hash: string; frames: number } | null {
  const hash = createHash("sha256");
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  if (header !== "GIF87a" && header !== "GIF89a") return null;
  if (bytes.length < 13) return null;

  let pos = 6;
  const lsdFlags = bytes[pos + 4];
  hash.update(bytes.subarray(pos, pos + 7));
  pos += 7;
  if (lsdFlags & 0x80) {
    const size = 3 * 2 ** ((lsdFlags & 0x07) + 1);
    if (pos + size > bytes.length) return null;
    hash.update(bytes.subarray(pos, pos + size));
    pos += size;
  }

  let frames = 0;
  while (pos < bytes.length) {
    const introducer = bytes[pos];
    if (introducer === 0x3b) return { hash: hash.digest("hex"), frames };

    if (introducer === 0x21) {
      const label = bytes[pos + 1];
      const start = pos;
      const end = skipSubBlocks(bytes, pos + 2);
      if (end === null) return null;
      const isGraphicControl = label === 0xf9;
      const isLoopExtension = label === 0xff && appIdentifier(bytes, pos + 2) === "NETSCAPE2.0";
      if (isGraphicControl || isLoopExtension) hash.update(bytes.subarray(start, end));
      pos = end;
      continue;
    }

    if (introducer === 0x2c) {
      if (pos + 10 > bytes.length) return null;
      const flags = bytes[pos + 9];
      let end = pos + 10;
      if (flags & 0x80) end += 3 * 2 ** ((flags & 0x07) + 1);
      end += 1; // LZW minimum code size
      const dataEnd = skipSubBlocks(bytes, end);
      if (dataEnd === null) return null;
      hash.update(bytes.subarray(pos, dataEnd));
      frames += 1;
      pos = dataEnd;
      continue;
    }
    return null;
  }
  return null; // missing trailer
}

function skipSubBlocks(bytes: Uint8Array, start: number): number | null {
  let pos = start;
  while (pos < bytes.length) {
    const size = bytes[pos];
    pos += 1;
    if (size === 0) return pos;
    pos += size;
  }
  return null;
}

function appIdentifier(bytes: Uint8Array, pos: number): string {
  if (bytes[pos] !== 11) return "";
  return String.fromCharCode(...bytes.subarray(pos + 1, pos + 12));
}
