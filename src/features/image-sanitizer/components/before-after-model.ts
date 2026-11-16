import type { MetadataCategory, PixelIntegrity, ProcessingReport, RetainReason, VerificationStatus } from "@/lib/image/types";
import type { QueueItem } from "../types/queue";

/**
 * What the before/after showcase displays for one cleaned file. Derived only from
 * the server's report: on the server, every category found before cleaning is
 * exactly one of removed, retained (kept on purpose) or stillPresent (a failure).
 */

export type Fate = "removed" | "kept" | "remained";

export interface LedgerRow {
  category: MetadataCategory;
  before: number;
  after: number;
  fate: Fate;
  reason: RetainReason | null;
}

export interface Comparison {
  rows: LedgerRow[];
  fieldsBefore: number;
  fieldsAfter: number;
  /** Fields actually removed (what the counter counts down by). */
  fieldsRemoved: number;
  sizeBefore: number;
  sizeAfter: number;
  pixels: PixelIntegrity;
  verification: VerificationStatus;
  hasLocation: boolean;
}

const FATE_ORDER: Record<Fate, number> = { remained: 0, removed: 1, kept: 2 };

export function buildComparison(report: ProcessingReport, outputSize: number): Comparison {
  const retained = new Map(report.metadata.retained.map((r) => [r.category, r.reason]));
  const still = new Set(report.metadata.stillPresent);

  const rows: LedgerRow[] = report.metadata.before.map(({ category, count }) => {
    if (still.has(category)) return { category, before: count, after: count, fate: "remained", reason: null };
    const reason = retained.get(category);
    if (reason) return { category, before: count, after: count, fate: "kept", reason };
    return { category, before: count, after: 0, fate: "removed", reason: null };
  });
  // Problems first, then the removals (largest first: the headline), then deliberate keeps.
  rows.sort((a, b) => FATE_ORDER[a.fate] - FATE_ORDER[b.fate] || b.before - a.before);

  const fieldsBefore = rows.reduce((n, r) => n + r.before, 0);
  const fieldsAfter = rows.reduce((n, r) => n + r.after, 0);
  return {
    rows,
    fieldsBefore,
    fieldsAfter,
    fieldsRemoved: fieldsBefore - fieldsAfter,
    sizeBefore: report.input.size,
    sizeAfter: outputSize,
    pixels: report.pixelData.integrity,
    verification: report.verification.status,
    hasLocation: rows.some((r) => r.category === "location" && r.fate === "removed"),
  };
}

/** Files that can be shown: cleaned, with a downloadable output and a report. */
export function showcaseItems(items: readonly QueueItem[]): QueueItem[] {
  return items.filter((i) => (i.status === "success" || i.status === "partial") && i.output && i.report);
}
