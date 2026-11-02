/** Art direction and budgets for the decontamination chamber. */

export const PALETTE = {
  /* Graphite interior with ember-orange light; cyan marks "verified clean". */
  stage: "#0A0B0E",
  stageDeep: "#050608",
  /** Working accent (LEDs, face screen, pegs, strips). */
  accent: "#FF7A1A",
  blue: "#5CA8FF",
  /** Verified-clean accent. */
  mint: "#5CE1E6",
  mintSoft: "#9BEFF2",
  teal: "#B5530F",
  muted: "#8F8A86",
  fault: "#FF5C6C",
  metal: "#16181D",
  metalLight: "#2A2E36",
  glass: "#FFD2A8",
} as const;

/** Chamber geometry in world units (photo plane sits near the origin). */
export const CHAMBER = {
  width: 3.4,
  height: 2.9,
  depth: 1.8,
  centerY: 0.05,
  photoMaxWidth: 2.4,
  photoMaxHeight: 1.72,
  photoY: 0.04,
  gantryRadius: 2.25,
  gantryY: 1.2,
  platformRadius: 2.55,
  core: { x: 0, y: -1.12, z: 0.42 },
} as const;

export type QualityTier = "full" | "compact" | "reduced";

export interface TierBudget {
  particles: number;
  /** Arms travel around the gantry. */
  armTravel: boolean;
  cameraMotion: boolean;
  edgeTraces: boolean;
  /** 0..1 strength of the core pulse and shockwave. */
  pulse: number;
  /** Floor detail: number of concentric rings drawn by the floor shader. */
  floorRings: number;
  maxDpr: number;
}

export const TIER_BUDGETS: Record<QualityTier, TierBudget> = {
  full: { particles: 240, armTravel: true, cameraMotion: true, edgeTraces: true, pulse: 1, floorRings: 7, maxDpr: 1.5 },
  compact: { particles: 120, armTravel: true, cameraMotion: true, edgeTraces: false, pulse: 0.85, floorRings: 4, maxDpr: 1.5 },
  reduced: { particles: 40, armTravel: false, cameraMotion: false, edgeTraces: false, pulse: 0.35, floorRings: 4, maxDpr: 1.5 },
};

export function pickTier(reduced: boolean, canvasWidth: number): QualityTier {
  if (reduced) return "reduced";
  return canvasWidth < 560 ? "compact" : "full";
}

/** Longest texture edge uploaded to the GPU. */
export const MAX_TEXTURE_SIZE = 1024;

/** Idle/ready scenes redraw at this rate; full rate only while something is happening. */
export const IDLE_FPS = 24;
