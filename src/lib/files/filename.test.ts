import { describe, expect, it } from "vitest";
import { contentDisposition, dedupeFilenames, safeStem, sanitizedFilename } from "./filename";

describe("safeStem", () => {
  it.each([
    ["../../etc/passwd", "passwd"],
    ["..\\..\\windows\\win.ini", "win"],
    ["photo.jpg", "photo"],
    ["holiday photo.final.JPG", "holiday photo.final"],
    ["a\r\nSet-Cookie: x=1.jpg", "aSet-Cookie_ x_1"],
    ['"quoted"<script>.png', "quoted__script_"],
    ["...", "image"],
    ["", "image"],
    [".hidden.png", "hidden"],
    ["$(rm -rf ~).jpg", "(rm -rf ~)"],
  ])("%j → %j", (input, expected) => {
    expect(safeStem(input)).toBe(expected);
  });

  it("caps length", () => {
    expect(safeStem(`${"a".repeat(500)}.jpg`).length).toBeLessThanOrEqual(80);
  });
});

describe("sanitizedFilename", () => {
  it("adds the suffix and keeps a matching extension", () => {
    expect(sanitizedFilename("IMG_0001.JPEG", "jpeg")).toBe("IMG_0001-clean.jpeg");
  });
  it("uses the detected format's extension when the name lies", () => {
    expect(sanitizedFilename("fake.jpg", "png")).toBe("fake-clean.png");
  });
});

describe("dedupeFilenames", () => {
  it("never produces colliding names (case-insensitive)", () => {
    const out = dedupeFilenames(["a-clean.jpg", "A-clean.jpg", "a-clean.jpg", "a-clean (2).jpg"]);
    expect(new Set(out.map((n) => n.toLowerCase())).size).toBe(out.length);
    expect(out[0]).toBe("a-clean.jpg");
  });
});

describe("contentDisposition", () => {
  it("cannot be used for header injection", () => {
    const header = contentDisposition('evil"\r\nX-Injected: 1.jpg');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toMatch(/^attachment; filename="[^"]*"; filename\*=UTF-8''/);
  });
  it("encodes unicode in the extended parameter", () => {
    expect(contentDisposition("फोटो-clean.jpg")).toContain("filename*=UTF-8''%E0%A4");
  });
});
