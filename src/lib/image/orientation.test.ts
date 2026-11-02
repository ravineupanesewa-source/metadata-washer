import { describe, expect, it } from "vitest";
import { decideOrientation, swapsDimensions, type OrientationInput } from "./orientation";

const base: OrientationInput = {
  format: "jpeg",
  orientation: 6,
  mode: "strict",
  policy: "lossless-or-fail",
  losslessToolAvailable: false,
};

describe("decideOrientation", () => {
  it("does nothing for upright images or formats without EXIF orientation", () => {
    expect(decideOrientation({ ...base, orientation: 1 })).toEqual({ action: "none" });
    expect(decideOrientation({ ...base, orientation: null })).toEqual({ action: "none" });
    expect(decideOrientation({ ...base, orientation: 9 })).toEqual({ action: "none" });
    expect(decideOrientation({ ...base, format: "avif" })).toEqual({ action: "none" });
    expect(decideOrientation({ ...base, format: "gif" })).toEqual({ action: "none" });
  });

  it("always keeps the tag in privacy mode", () => {
    expect(decideOrientation({ ...base, mode: "privacy", policy: "allow-reencode" })).toEqual({ action: "keep-tag" });
  });

  it("keeps the tag in strict mode with preserve-tag", () => {
    expect(decideOrientation({ ...base, policy: "preserve-tag" })).toEqual({ action: "keep-tag" });
  });

  it("uses a lossless JPEG transform when a tool is available", () => {
    expect(decideOrientation({ ...base, losslessToolAvailable: true })).toEqual({
      action: "lossless-transform",
      transform: ["-rotate", "90"],
    });
  });

  it("refuses rather than silently re-encoding", () => {
    expect(decideOrientation(base)).toEqual({ action: "reject", reason: "lossless-unavailable" });
    expect(decideOrientation({ ...base, format: "png" })).toEqual({ action: "reject", reason: "lossless-unavailable" });
  });

  it("re-encodes only with explicit consent", () => {
    expect(decideOrientation({ ...base, policy: "allow-reencode" })).toEqual({ action: "reencode-transform" });
  });

  it("knows which orientations swap dimensions", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(swapsDimensions)).toEqual([false, false, false, false, true, true, true, true]);
  });
});
