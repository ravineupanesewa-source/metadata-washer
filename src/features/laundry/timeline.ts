/**
 * Washing-machine run, shared by the page controller and the 3D scene.
 *
 *   idle → loading (picture hangs, door opens, it is pulled in, door closes)
 *        → washing (drum spins until background removal resolves)
 *        → unloading (drum stops, door opens, clean picture pops out)
 *        → done (result shown as a DOM card)
 *        → closing (door shuts) → idle
 */

export type WashPhase = "idle" | "loading" | "washing" | "unloading" | "done" | "closing";

export const LOAD_MS = 3200;
export const MIN_WASH_MS = 2600;
export const UNLOAD_MS = 1900;
export const CLOSE_MS = 800;

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Progress of `t` through the window [a, b], clamped to 0..1. */
export const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeOutBack = (t: number) => {
  const c = 1.70158;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
