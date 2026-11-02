import { describe, expect, it } from "vitest";
import { createParticleAttributes } from "./particle-seeds";
import { TIMELINE } from "./timeline";

describe("createParticleAttributes", () => {
  it("is deterministic for replay", () => {
    const a = createParticleAttributes(64, TIMELINE);
    const b = createParticleAttributes(64, TIMELINE);
    expect(a.timing).toEqual(b.timing);
    expect(a.home).toEqual(b.home);
  });

  it("emerges particles during activation or as the beam passes them", () => {
    const { home, timing } = createParticleAttributes(200, TIMELINE);
    for (let i = 0; i < 200; i++) {
      const emergeAt = timing[i * 4];
      expect(emergeAt).toBeGreaterThanOrEqual(TIMELINE.materializeEnd);
      expect(emergeAt).toBeLessThanOrEqual(TIMELINE.scanEnd);
      const v = home[i * 2 + 1];
      expect(Math.abs(v)).toBeLessThanOrEqual(0.5);
    }
  });

  it("keeps a small share of larger particles", () => {
    const { timing } = createParticleAttributes(500, TIMELINE);
    const big = Array.from({ length: 500 }, (_, i) => timing[i * 4 + 3]).filter((s) => s > 0.12).length;
    expect(big).toBeGreaterThan(20);
    expect(big).toBeLessThan(90);
  });
});
