"use client";

import { useSyncExternalStore } from "react";

/**
 * One app-wide, one-off frame-rate probe shared by every decorative effect.
 *
 *   pending → measuring (1 s warm-up, then 2 s of frames)
 *   high    → effects animate
 *   low     → effects render a single static frame (slow GPU, software
 *             rendering, or prefers-reduced-motion)
 *
 * The essential cleaning feedback (the chamber run) never depends on this.
 * The result is mirrored to <html data-perf> for diagnostics and tests.
 */

export type PerfTier = "pending" | "high" | "low";

const MIN_FPS = 40;
let tier: PerfTier = "pending";
let started = false;
/** Outstanding holds: while any exist the probe waits (see holdPerfProbe). */
let holds = 0;
let wanted = false;
const listeners = new Set<() => void>();

/**
 * Delays the probe until the returned release function is called, so it measures
 * real rendering rather than a page still loading its 3D assets. Release is idempotent.
 */
export function holdPerfProbe(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    if (holds === 0 && wanted) start();
  };
}

function set(next: PerfTier) {
  tier = next;
  document.documentElement.dataset.perf = next;
  listeners.forEach((l) => l());
}

function start() {
  if (started || typeof window === "undefined") return;
  if (holds > 0) {
    wanted = true;
    document.documentElement.dataset.perf = "pending";
    return;
  }
  started = true;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    set("low");
    return;
  }
  document.documentElement.dataset.perf = "pending";
  let first = 0;
  let from = 0;
  let frames = 0;
  const tick = (now: number) => {
    if (document.hidden) {
      first = from = frames = 0; // hidden tabs don't paint; measure once visible
    } else if (!first) {
      first = now;
    } else if (now - first >= 1000) {
      if (!from) from = now;
      frames += 1;
      const seconds = (now - from) / 1000;
      if (seconds >= 2) {
        set(frames / seconds >= MIN_FPS ? "high" : "low");
        return;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePerfTier(): PerfTier {
  return useSyncExternalStore(subscribe, () => tier, () => "pending");
}
