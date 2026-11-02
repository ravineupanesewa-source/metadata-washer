import { describe, expect, it } from "vitest";
import { buildResidualArgs, buildStripArgs } from "./strip-args";

describe("buildStripArgs", () => {
  it("privacy mode restores ICC (and orientation when needed)", () => {
    expect(buildStripArgs({ format: "jpeg", mode: "privacy", keepOrientationTag: true }, "/w/in.jpg", "/w/out.jpg")).toEqual([
      "-all=",
      "-tagsFromFile",
      "@",
      "-ICC_Profile",
      "-EXIF:Orientation",
      "-o",
      "/w/out.jpg",
      "/w/in.jpg",
    ]);
  });

  it("strict mode removes everything", () => {
    expect(buildStripArgs({ format: "webp", mode: "strict", keepOrientationTag: false }, "i", "o")).toEqual(["-all=", "-o", "o", "i"]);
  });

  it("keeps PNG colour chunks in privacy mode", () => {
    const args = buildStripArgs({ format: "png", mode: "privacy", keepOrientationTag: false }, "i", "o");
    expect(args).toContain("-PNG:Gamma");
  });

  it("explicitly deletes TIFF IFD0 descriptive tags", () => {
    const args = buildStripArgs({ format: "tiff", mode: "strict", keepOrientationTag: false }, "i", "o");
    expect(args).toEqual(expect.arrayContaining(["-IFD0:Make=", "-IFD0:Artist=", "-IFD0:Orientation="]));
    expect(args.slice(-3)).toEqual(["-o", "o", "i"]);
  });
});

describe("buildResidualArgs", () => {
  it("only emits well-formed deletions for EXIF tags", () => {
    const args = buildResidualArgs(
      [
        { group0: "EXIF", group1: "IFD0", name: "Make", value: "x", category: "device" },
        { group0: "EXIF", group1: "IFD0", name: "Bad\nName", value: "x", category: "device" },
        { group0: "XMP", group1: "XMP-dc", name: "Creator", value: "x", category: "xmp" },
      ],
      "/w/out.tif",
    );
    expect(args).toEqual(["-IFD0:Make=", "-overwrite_original", "/w/out.tif"]);
  });

  it("returns null when nothing is left to delete", () => {
    expect(buildResidualArgs([], "f")).toBeNull();
  });
});
