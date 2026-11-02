import { getCapability } from "./capabilities";
import type { ImageFormat, MetadataMode, OrientationPolicy } from "./types";

/**
 * Pure decision logic for EXIF orientation. Removing an Orientation tag that
 * is not 1 would rotate the visible image, so we either keep the tag, rotate
 * the pixels losslessly (jpegtran -perfect), re-encode with explicit consent,
 * or refuse.
 */

export type OrientationDecision =
  | { action: "none" }
  | { action: "keep-tag" }
  | { action: "lossless-transform"; transform: JpegTransform }
  | { action: "reencode-transform" }
  | { action: "reject"; reason: "lossless-unavailable" | "reencode-unsupported" };

/** jpegtran arguments for each EXIF orientation value (2–8). */
export type JpegTransform =
  | ["-flip", "horizontal"]
  | ["-rotate", "180"]
  | ["-flip", "vertical"]
  | ["-transpose"]
  | ["-rotate", "90"]
  | ["-transverse"]
  | ["-rotate", "270"];

const JPEG_TRANSFORMS: Record<number, JpegTransform> = {
  2: ["-flip", "horizontal"],
  3: ["-rotate", "180"],
  4: ["-flip", "vertical"],
  5: ["-transpose"],
  6: ["-rotate", "90"],
  7: ["-transverse"],
  8: ["-rotate", "270"],
};

export interface OrientationInput {
  format: ImageFormat;
  orientation: number | null;
  mode: MetadataMode;
  policy: OrientationPolicy;
  losslessToolAvailable: boolean;
}

export function needsOrientationHandling(orientation: number | null): boolean {
  return orientation !== null && orientation >= 2 && orientation <= 8;
}

/** Orientations 5–8 swap width and height when applied to pixels. */
export function swapsDimensions(orientation: number | null): boolean {
  return orientation !== null && orientation >= 5 && orientation <= 8;
}

export function decideOrientation(input: OrientationInput): OrientationDecision {
  const capability = getCapability(input.format);
  if (capability.orientation !== "exif" || !needsOrientationHandling(input.orientation)) {
    return { action: "none" };
  }
  if (input.mode === "privacy" || input.policy === "preserve-tag") {
    return { action: "keep-tag" };
  }

  const losslessPossible = input.format === "jpeg" && input.losslessToolAvailable;
  if (losslessPossible) {
    return { action: "lossless-transform", transform: JPEG_TRANSFORMS[input.orientation!] };
  }
  if (input.policy === "allow-reencode") {
    return capability.reencodable
      ? { action: "reencode-transform" }
      : { action: "reject", reason: "reencode-unsupported" };
  }
  return { action: "reject", reason: "lossless-unavailable" };
}
