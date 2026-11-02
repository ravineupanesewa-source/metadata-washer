import { getCapability } from "./capabilities";
import { countCategories, type ClassifiedTag } from "./classify";
import type { VerificationOutcome } from "./verify";
import type {
  ImageFacts,
  ImageFormat,
  MetadataCategory,
  MetadataMode,
  NoticeCode,
  OrientationAction,
  ProcessingReport,
  ProcessingStatus,
} from "./types";

/**
 * Builds the client-facing report. It contains categories and counts only:
 * never tag values, so it is safe to show, log-free, and include in ZIPs.
 */

export interface ReportInput {
  format: ImageFormat;
  mode: MetadataMode;
  input: Omit<ImageFacts, "format" | "mimeType">;
  output: Omit<ImageFacts, "format" | "mimeType"> | null;
  beforeTags: readonly ClassifiedTag[];
  orientation: { original: number | null; action: OrientationAction };
  reencoded: boolean;
  verification: VerificationOutcome;
}

export function buildReport(r: ReportInput): ProcessingReport {
  const capability = getCapability(r.format);
  const before = countCategories(r.beforeTags);
  const beforeSet = new Set(before.map((c) => c.category));
  const retainedSet = new Set(r.verification.retained.map((c) => c.category));
  const stillSet = new Set(r.verification.stillPresent);
  const removed = [...beforeSet].filter((c) => !retainedSet.has(c) && !stillSet.has(c));

  const iccPresent = beforeSet.has("icc-profile");
  const iccRetained = retainedSet.has("icc-profile");
  const status: ProcessingStatus =
    r.verification.status === "verified" ? "success" : r.verification.status === "partial" ? "partial" : "failed";

  return {
    version: 1,
    status,
    mode: r.mode,
    input: { ...r.input, format: r.format, mimeType: capability.mimeType },
    output: r.output && status !== "failed" ? { ...r.output, format: r.format, mimeType: capability.mimeType } : null,
    metadata: {
      before,
      removed: removed as MetadataCategory[],
      retained: r.verification.retained,
      stillPresent: r.verification.stillPresent,
      noMetadataDetected: before.length === 0,
    },
    icc: { present: iccPresent, retained: iccRetained },
    orientation: r.orientation,
    pixelData: { reencoded: r.reencoded, integrity: r.verification.pixelIntegrity },
    verification: { status: r.verification.status, checks: r.verification.checks },
    notices: notices(r, capability.fixtureVerified, iccPresent, iccRetained),
  };
}

function notices(r: ReportInput, fixtureVerified: boolean, iccPresent: boolean, iccRetained: boolean): NoticeCode[] {
  const list: NoticeCode[] = [];
  if (iccRetained) list.push("icc-retained");
  if (iccPresent && !iccRetained) list.push("icc-removed-color-may-change");
  if (r.orientation.action === "kept-tag") list.push("orientation-tag-kept");
  if (r.orientation.action === "lossless-transform") list.push("orientation-lossless-transform");
  if (r.orientation.action === "reencode-transform") list.push("orientation-reencoded");
  if (r.verification.pixelIntegrity === "not-verifiable") list.push("pixel-integrity-not-verifiable");
  if (getCapability(r.format).orientation === "container") list.push("format-container-orientation");
  if (!fixtureVerified) list.push("untested-format");
  return list;
}
