import { describe, expect, it } from "vitest";
import { fitPhoto } from "./image-texture";

describe("fitPhoto", () => {
  it.each([
    [16 / 9, { width: 2.4, height: 1.35 }],
    [1, { width: 1.8, height: 1.8 }],
    [3 / 4, { width: 1.35, height: 1.8 }],
    [9 / 16, { width: 1.0125, height: 1.8 }],
  ])("keeps aspect %f inside the box without cropping", (aspect, expected) => {
    const fit = fitPhoto(aspect, 2.4, 1.8);
    expect(fit.width).toBeCloseTo(expected.width);
    expect(fit.height).toBeCloseTo(expected.height);
    expect(fit.width / fit.height).toBeCloseTo(aspect);
    expect(fit.width).toBeLessThanOrEqual(2.4 + 1e-9);
    expect(fit.height).toBeLessThanOrEqual(1.8 + 1e-9);
  });

  it("falls back to 4:3 for invalid aspects", () => {
    expect(fitPhoto(Number.NaN, 2.4, 1.8)).toEqual({ width: 2.4, height: 1.8 });
  });
});
