"use client";

import { useSyncExternalStore } from "react";

/**
 * Small, synchronous device signals for adapting the experience to phones.
 * Each hook renders the server snapshot during hydration, then the real value,
 * so the server HTML and the first client render always match.
 */

/** Minimal shape of the Network Information API (Chromium only; absent elsewhere). */
interface NetworkInformation extends EventTarget {
  saveData?: boolean;
  effectiveType?: "slow-2g" | "2g" | "3g" | "4g";
}
const connection = (): NetworkInformation | undefined =>
  typeof navigator === "undefined" ? undefined : (navigator as Navigator & { connection?: NetworkInformation }).connection;

function mediaStore(query: string) {
  return {
    subscribe(onChange: () => void) {
      if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    get: () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
  };
}

const coarse = mediaStore("(pointer: coarse)");

/** Primary input is a finger (phones, tablets): no hover, no drag-and-drop from a desktop. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(coarse.subscribe, coarse.get, () => false);
}

/**
 * The user asked to save data (Save-Data / prefers-reduced-data) or is on a 2G-class
 * connection. Large optional downloads (the 3D washer) should be skipped.
 */
export function prefersLightweight(): boolean {
  const net = connection();
  if (net?.saveData) return true;
  if (net?.effectiveType === "slow-2g" || net?.effectiveType === "2g") return true;
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-data: reduce)").matches;
}
