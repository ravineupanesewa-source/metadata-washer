"use client";

import { useSyncExternalStore } from "react";
import { SUPPORT_PAID_SNOOZE_DAYS, SUPPORT_SNOOZE_DAYS, supportEnabled } from "./support-config";

/**
 * The support modal's state. It opens only after the user downloads a cleaned file
 * (a beat later, so the download clearly happened first) and never instead of it.
 * "Maybe later" snoozes it on this device for SUPPORT_SNOOZE_DAYS; "I've sent it" for
 * SUPPORT_PAID_SNOOZE_DAYS. Nothing is sent anywhere: the snooze is one timestamp in
 * this browser's localStorage.
 */

/** What the user just got out of CleanFrame, from their own real results. */
export interface SupportImpact {
  images: number;
  fieldsRemoved: number;
  location: boolean;
}

interface SupportState {
  open: boolean;
  impact: SupportImpact | null;
}

const SNOOZE_KEY = "cleanframe.support.snoozedUntil";
const DAY_MS = 24 * 60 * 60 * 1000;
/** Let the browser's download UI appear before the modal does. */
export const OPEN_DELAY_MS = 600;

let state: SupportState = { open: false, impact: null };
let pending: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function set(next: SupportState) {
  state = next;
  listeners.forEach((l) => l());
}

function snoozed(now = Date.now()): boolean {
  try {
    const until = Number(window.localStorage.getItem(SNOOZE_KEY));
    return Number.isFinite(until) && until > now;
  } catch {
    // Storage blocked (private mode, disabled cookies): fall back to this page view only.
    return false;
  }
}

function snooze(days: number, now: number) {
  try {
    window.localStorage.setItem(SNOOZE_KEY, String(now + days * DAY_MS));
  } catch {
    // Not persisted; it still stays closed for the rest of this page view.
  }
}

/** Call when a download starts. Opens the modal shortly after, unless it's off or snoozed. */
export function requestSupport(impact?: SupportImpact): void {
  if (!supportEnabled || state.open || pending || snoozed()) return;
  pending = setTimeout(() => {
    pending = null;
    if (!snoozed()) set({ open: true, impact: impact ?? null });
  }, OPEN_DELAY_MS);
}

/** "Maybe later", the close button, Escape or a click outside: close and snooze. */
export function dismissSupport(now = Date.now()): void {
  snooze(SUPPORT_SNOOZE_DAYS, now);
  set({ ...state, open: false });
}

/** "I've sent it" (honour system): snooze for longer; the modal shows its thank-you view. */
export function markSupported(now = Date.now()): void {
  snooze(SUPPORT_PAID_SNOOZE_DAYS, now);
}

/** Close after the thank-you view (already snoozed by markSupported). */
export function closeSupport(): void {
  set({ ...state, open: false });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverState: SupportState = { open: false, impact: null };

export function useSupport(): SupportState {
  return useSyncExternalStore(subscribe, () => state, () => serverState);
}

/** Test helper: reset module state between tests. */
export function resetSupportForTests(): void {
  if (pending) clearTimeout(pending);
  pending = null;
  state = { open: false, impact: null };
  listeners.clear();
}
