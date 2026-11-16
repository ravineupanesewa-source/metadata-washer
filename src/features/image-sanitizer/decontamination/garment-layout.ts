/**
 * Pure layout for a batch of photos in the washer scene: where each hangs on the
 * clothesline, and how a shared flight (line -> drum, drum -> line) is staggered
 * so photos leave one after another. No three.js, so it is unit-testable.
 */

/** Most photos the line (and drum) show at once; the dock says "+N more" for the rest. */
export const MAX_GARMENTS = 6;
/** Gap between neighbouring photos on the line (world units). */
export const LINE_GAP = 0.12;

export interface Slot {
  /** Centre of the slot along the line. */
  x: number;
  /** Largest photo width that fits the slot. */
  width: number;
}

/** Spreads n photos evenly, centred on the line, each as wide as fits (capped at maxWidth). */
export function lineSlots(n: number, usable: number, maxWidth: number): Slot[] {
  if (n <= 0) return [];
  const width = Math.min(maxWidth, (usable - LINE_GAP * (n - 1)) / n);
  const span = width * n + LINE_GAP * (n - 1);
  return Array.from({ length: n }, (_, i) => ({ x: -span / 2 + width / 2 + i * (width + LINE_GAP), width }));
}

/**
 * Photo i of n's share of a shared 0..1 flight: each starts a little after the one
 * before, and every photo has landed by the time the shared flight reaches 1.
 */
export function staggered(flight: number, i: number, n: number): number {
  if (n <= 1) return flight;
  const step = Math.min(0.12, 0.45 / (n - 1));
  const t = (flight - i * step) / (1 - step * (n - 1));
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
