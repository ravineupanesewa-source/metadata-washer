import { describe, expect, it } from "vitest";
import { detectSignature } from "./signature";

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

function ftyp(major: string, ...compatible: string[]) {
  const size = 16 + compatible.length * 4;
  return bytes([0, 0, 0, size], "ftyp", major, [0, 0, 0, 0], ...compatible);
}

describe("detectSignature", () => {
  it.each([
    ["jpeg", bytes([0xff, 0xd8, 0xff, 0xe1])],
    ["png", bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["webp", bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ")],
    ["tiff", bytes([0x49, 0x49, 0x2a, 0x00])],
    ["tiff", bytes([0x4d, 0x4d, 0x00, 0x2a])],
    ["gif", bytes("GIF89a")],
    ["gif", bytes("GIF87a")],
    ["avif", ftyp("avif", "mif1", "miaf")],
    ["avif", ftyp("mif1", "avif")],
    ["heic", ftyp("heic", "mif1")],
    ["heic", ftyp("mif1", "heic")],
  ])("detects %s", (format, input) => {
    expect(detectSignature(input)).toEqual({ kind: "supported", format });
  });

  it.each([
    ["BMP", bytes("BM", [0, 0])],
    ["PDF", bytes("%PDF-1.7")],
    ["SVG", bytes('<?xml version="1.0"?><svg xmlns="x">')],
    ["SVG", bytes("  <svg width='1'>")],
    ["BigTIFF", bytes([0x49, 0x49, 0x2b, 0x00])],
    ["ISO media (video or other container)", ftyp("isom", "mp41")],
  ])("labels %s as unsupported", (label, input) => {
    expect(detectSignature(input)).toEqual({ kind: "unsupported", label });
  });

  it("returns unknown for text and empty input", () => {
    expect(detectSignature(bytes("hello world"))).toEqual({ kind: "unknown" });
    expect(detectSignature(new Uint8Array())).toEqual({ kind: "unknown" });
  });

  it("does not trust a truncated signature", () => {
    expect(detectSignature(bytes([0x89, 0x50, 0x4e]))).toEqual({ kind: "unknown" });
  });
});
