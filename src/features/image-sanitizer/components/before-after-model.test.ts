import { describe, expect, it } from "vitest";
import type { ProcessingReport } from "@/lib/image/types";
import type { QueueItem } from "../types/queue";
import { buildComparison, showcaseItems } from "./before-after-model";

function report(metadata: Partial<ProcessingReport["metadata"]>): ProcessingReport {
  return {
    version: 1,
    status: "success",
    mode: "privacy",
    input: { format: "jpeg", mimeType: "image/jpeg", size: 2000, width: 10, height: 10, frameCount: 1 },
    output: { format: "jpeg", mimeType: "image/jpeg", size: 1500, width: 10, height: 10, frameCount: 1 },
    metadata: { before: [], removed: [], retained: [], stillPresent: [], noMetadataDetected: false, ...metadata },
    icc: { present: true, retained: true },
    orientation: { original: null, action: "none" },
    pixelData: { reencoded: false, integrity: "identical" },
    verification: { status: "verified", checks: [] },
    notices: [],
  };
}

describe("buildComparison", () => {
  it("counts removed fields down to zero and keeps deliberate retentions", () => {
    const c = buildComparison(
      report({
        before: [
          { category: "timestamps", count: 4 },
          { category: "location", count: 7 },
          { category: "icc-profile", count: 3 },
        ],
        removed: ["timestamps", "location"],
        retained: [{ category: "icc-profile", reason: "color-rendering" }],
      }),
      1500,
    );
    expect(c.fieldsBefore).toBe(14);
    expect(c.fieldsAfter).toBe(3);
    expect(c.fieldsRemoved).toBe(11);
    expect(c.hasLocation).toBe(true);
    // Removals first, largest first; deliberate keeps last.
    expect(c.rows.map((r) => [r.category, r.fate, r.after])).toEqual([
      ["location", "removed", 0],
      ["timestamps", "removed", 0],
      ["icc-profile", "kept", 3],
    ]);
    expect(c.rows[2].reason).toBe("color-rendering");
    expect(c.sizeBefore).toBe(2000);
    expect(c.sizeAfter).toBe(1500);
  });

  it("surfaces categories that should have been removed but remain, ahead of everything else", () => {
    const c = buildComparison(
      report({
        before: [
          { category: "xmp", count: 2 },
          { category: "device", count: 5 },
        ],
        removed: ["device"],
        stillPresent: ["xmp"],
      }),
      1500,
    );
    expect(c.rows[0]).toMatchObject({ category: "xmp", fate: "remained", after: 2 });
    expect(c.fieldsAfter).toBe(2);
    expect(c.hasLocation).toBe(false);
  });

  it("handles a file that had no metadata", () => {
    const c = buildComparison(report({ noMetadataDetected: true }), 2000);
    expect(c.rows).toEqual([]);
    expect(c.fieldsBefore).toBe(0);
    expect(c.fieldsRemoved).toBe(0);
  });
});

describe("showcaseItems", () => {
  const base = { output: { blob: new Blob(), url: "blob:x", filename: "a.jpg" }, report: report({}) };
  it("keeps only cleaned files that have an output and a report", () => {
    const items = [
      { id: "1", status: "success", ...base },
      { id: "2", status: "partial", ...base },
      { id: "3", status: "failed", ...base },
      { id: "4", status: "success", output: null, report: null },
    ] as unknown as QueueItem[];
    expect(showcaseItems(items).map((i) => i.id)).toEqual(["1", "2"]);
  });
});
