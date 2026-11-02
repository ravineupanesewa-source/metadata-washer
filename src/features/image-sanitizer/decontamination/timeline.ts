import type { QueueItem } from "../types/queue";

/**
 * The decontamination timeline: one pure function of elapsed time and the
 * *real* processing result. The 3D scene, the status text and the CSS
 * fallback all sample it, so they can never drift apart.
 *
 *  0.0–0.6  materialize   photo enters, chamber lights come on
 *  0.6–1.4  activate      arms start, core lights, edge traces
 *  1.4–2.5  scan          beam sweeps, particles emerge
 *  2.5–…    awaiting      only if the server is still working: restrained scan loop
 *  +1.3     purge         particles pulled into the core, compress, vanish
 *           (dissipate)   same slot when no metadata was found: particles fade, no pulse
 *  +0.7     clear         arms rest, shield forms, chamber turns mint
 *           fault         on failure, immediately: scan stops, chamber dims to red
 *           complete      stable final pose
 *
 * The purge never starts before the server has answered, so the animation
 * cannot imply success that hasn't happened.
 */

export type VisualPhase =
  | "materialize"
  | "activate"
  | "scan"
  | "awaiting"
  | "purge"
  | "dissipate"
  | "clear"
  | "fault"
  | "complete";

/** What actually happened, derived from real processing results. */
export type RunOutcome = "clean" | "no-metadata" | "error";

export interface TimelineConfig {
  materializeEnd: number;
  activateEnd: number;
  scanEnd: number;
  purge: number;
  clear: number;
  fault: number;
  /** Period of the restrained scan loop while waiting for the server. */
  scanLoop: number;
}

export const TIMELINE: TimelineConfig = {
  materializeEnd: 0.6,
  activateEnd: 1.4,
  scanEnd: 2.5,
  purge: 1.3,
  clear: 0.7,
  fault: 0.9,
  scanLoop: 1.6,
};

/** Reduced motion: same story, half the time, simplified visuals. */
export const REDUCED_TIMELINE: TimelineConfig = Object.fromEntries(
  Object.entries(TIMELINE).map(([key, value]) => [key, value * 0.5]),
) as unknown as TimelineConfig;

export function nominalDuration(config: TimelineConfig): number {
  return config.scanEnd + config.purge + config.clear;
}

export interface Resolution {
  /** Seconds since the run started when the real result arrived. */
  at: number;
  outcome: RunOutcome;
}

export interface TimelineSample {
  t: number;
  phase: VisualPhase;
  outcome: RunOutcome | null;
  /** 0..1 progress of each stage; stays at 1 once passed. */
  materialize: number;
  activate: number;
  scan: number;
  /** 0..1 progress of purge or dissipate. */
  purge: number;
  clear: number;
  fault: number;
  /** Beam position 0 (top) .. 1 (bottom); loops while awaiting. */
  scanLine: number;
  /** Beam visibility 0..1. */
  beam: number;
  /** Time the purge/dissipate started, or null. */
  releaseAt: number | null;
  done: boolean;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function sampleTimeline(t: number, resolution: Resolution | null, config: TimelineConfig): TimelineSample {
  const materialize = clamp01(t / config.materializeEnd);
  const activate = clamp01((t - config.materializeEnd) / (config.activateEnd - config.materializeEnd));
  const scan = clamp01((t - config.activateEnd) / (config.scanEnd - config.activateEnd));
  const loop = t > config.scanEnd ? ((t - config.scanEnd) % config.scanLoop) / config.scanLoop : 0;

  const base: TimelineSample = {
    t,
    phase: t < config.materializeEnd ? "materialize" : t < config.activateEnd ? "activate" : t < config.scanEnd ? "scan" : "awaiting",
    outcome: resolution?.outcome ?? null,
    materialize,
    activate,
    scan,
    purge: 0,
    clear: 0,
    fault: 0,
    scanLine: t < config.scanEnd ? scan : loop,
    beam: t < config.activateEnd ? 0 : Math.min(1, (t - config.activateEnd) / 0.15),
    releaseAt: null,
    done: false,
  };

  if (!resolution) return base;

  if (resolution.outcome === "error") {
    const fault = clamp01((t - resolution.at) / config.fault);
    return {
      ...base,
      phase: fault >= 1 ? "complete" : "fault",
      fault,
      beam: base.beam * (1 - clamp01(fault * 3)),
      done: fault >= 1,
    };
  }

  const releaseAt = Math.max(config.scanEnd, resolution.at);
  if (t < releaseAt) return base;

  const purge = clamp01((t - releaseAt) / config.purge);
  const clear = clamp01((t - releaseAt - config.purge) / config.clear);
  const releasing = resolution.outcome === "clean" ? "purge" : "dissipate";
  return {
    ...base,
    phase: purge < 1 ? releasing : clear < 1 ? "clear" : "complete",
    purge,
    clear,
    beam: base.beam * (1 - clamp01(purge * 4)),
    releaseAt,
    done: clear >= 1,
  };
}

/**
 * Derives the visual outcome from real queue results. Any verified output
 * counts as "clean" unless *every* successful file had no metadata at all.
 */
export function deriveOutcome(items: readonly Pick<QueueItem, "status" | "report">[]): RunOutcome {
  const succeeded = items.filter((i) => i.status === "success" || i.status === "partial");
  if (succeeded.length === 0) return "error";
  return succeeded.every((i) => i.report?.metadata.noMetadataDetected) ? "no-metadata" : "clean";
}

export function isFinished(item: Pick<QueueItem, "status">): boolean {
  return item.status !== "queued" && item.status !== "processing" && item.status !== "ready";
}
