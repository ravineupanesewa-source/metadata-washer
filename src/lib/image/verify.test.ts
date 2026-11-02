import { describe, expect, it } from "vitest";
import type { ClassifiedTag } from "./classify";
import { verifyOutput, type FileFacts, type VerificationContext } from "./verify";

const tag = (category: ClassifiedTag["category"], value: unknown = "x"): ClassifiedTag => ({
  group0: "EXIF",
  group1: "IFD0",
  name: category,
  value,
  category,
});

const before: FileFacts = {
  fileType: "JPEG",
  width: 100,
  height: 50,
  frameCount: 1,
  orientation: 6,
  pixelHash: "abc",
  tags: [tag("location"), tag("icc-profile"), tag("orientation", 6)],
  malformed: false,
};

const ctx: VerificationContext = {
  mode: "privacy",
  keepOrientationTag: true,
  pixelsTransformed: false,
  dimensionsSwapped: false,
  supportsIcc: true,
  acceptedFileTypes: ["JPEG"],
};

const clean: FileFacts = { ...before, tags: [tag("icc-profile"), tag("orientation", 6)] };

describe("verifyOutput", () => {
  it("verifies a clean output and lists intentionally retained categories", () => {
    const result = verifyOutput(before, clean, ctx);
    expect(result.status).toBe("verified");
    expect(result.retained.map((r) => r.category).sort()).toEqual(["icc-profile", "orientation"]);
    expect(result.pixelIntegrity).toBe("identical");
  });

  it("fails when targeted metadata survives", () => {
    const result = verifyOutput(before, { ...clean, tags: [...clean.tags, tag("location")] }, ctx);
    expect(result.status).toBe("failed");
    expect(result.stillPresent).toEqual(["location"]);
  });

  it("fails when ICC survives strict mode", () => {
    const result = verifyOutput(before, clean, { ...ctx, mode: "strict", keepOrientationTag: false });
    expect(result.status).toBe("failed");
    expect(result.stillPresent).toContain("icc-profile");
  });

  it("ignores a harmless Orientation=1 that a format cannot drop", () => {
    const result = verifyOutput(before, { ...clean, tags: [tag("orientation", 1)] }, { ...ctx, mode: "strict", keepOrientationTag: false });
    expect(result.status).toBe("verified");
  });

  it("fails on pixel hash mismatch, wrong format, dimensions or frames", () => {
    expect(verifyOutput(before, { ...clean, pixelHash: "zzz" }, ctx).status).toBe("failed");
    expect(verifyOutput(before, { ...clean, fileType: "PNG" }, ctx).status).toBe("failed");
    expect(verifyOutput(before, { ...clean, width: 99 }, ctx).status).toBe("failed");
    expect(verifyOutput(before, { ...clean, frameCount: 2 }, ctx).status).toBe("failed");
    expect(verifyOutput(before, { ...clean, malformed: true }, ctx).status).toBe("failed");
  });

  it("is partial (never verified) when pixel data cannot be hashed", () => {
    const result = verifyOutput({ ...before, pixelHash: null }, { ...clean, pixelHash: null }, ctx);
    expect(result.status).toBe("partial");
    expect(result.pixelIntegrity).toBe("not-verifiable");
  });

  it("expects swapped dimensions after a 90° transform", () => {
    const rotated = { ...clean, width: 50, height: 100, pixelHash: "new" };
    const result = verifyOutput(before, rotated, { ...ctx, pixelsTransformed: true, dimensionsSwapped: true });
    expect(result.status).toBe("verified");
    expect(result.pixelIntegrity).toBe("transformed");
  });
});
