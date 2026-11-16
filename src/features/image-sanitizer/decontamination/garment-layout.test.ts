import { describe, expect, it } from "vitest";
import { LINE_GAP, MAX_GARMENTS, lineSlots, staggered } from "./garment-layout";

describe("lineSlots", () => {
  const usable = 3.2;
  const maxWidth = 1.15;

  it("centres a single photo at full size", () => {
    expect(lineSlots(1, usable, maxWidth)).toEqual([{ x: 0, width: maxWidth }]);
  });

  it("fits every batch size up to the cap inside the usable line, without overlap", () => {
    for (let n = 1; n <= MAX_GARMENTS; n++) {
      const slots = lineSlots(n, usable, maxWidth);
      expect(slots).toHaveLength(n);
      const left = slots[0].x - slots[0].width / 2;
      const right = slots[n - 1].x + slots[n - 1].width / 2;
      expect(left).toBeGreaterThanOrEqual(-usable / 2 - 1e-9);
      expect(right).toBeLessThanOrEqual(usable / 2 + 1e-9);
      expect(left + right).toBeCloseTo(0); // centred
      for (let i = 1; i < n; i++) {
        const gap = slots[i].x - slots[i].width / 2 - (slots[i - 1].x + slots[i - 1].width / 2);
        expect(gap).toBeCloseTo(LINE_GAP);
      }
    }
  });

  it("returns nothing for an empty batch", () => {
    expect(lineSlots(0, usable, maxWidth)).toEqual([]);
  });
});

describe("staggered", () => {
  it("passes a single photo's flight through unchanged", () => {
    expect(staggered(0.37, 0, 1)).toBe(0.37);
  });

  it("starts later photos later, and lands every photo by the end", () => {
    for (const n of [2, 3, MAX_GARMENTS]) {
      for (let i = 0; i < n; i++) {
        expect(staggered(0, i, n)).toBe(0);
        expect(staggered(1, i, n)).toBe(1);
        // Never ahead of the photo before it (both may still be waiting at 0).
        if (i > 0) expect(staggered(0.3, i, n)).toBeLessThanOrEqual(staggered(0.3, i - 1, n));
      }
      // ...and genuinely staggered: the first is under way before the last has left.
      expect(staggered(0.3, 0, n)).toBeGreaterThan(staggered(0.3, n - 1, n));
    }
  });

  it("never leaves 0..1", () => {
    for (let f = -0.5; f <= 1.5; f += 0.05) {
      const v = staggered(f, 2, 4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
