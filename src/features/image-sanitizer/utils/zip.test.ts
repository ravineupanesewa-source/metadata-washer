import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { ProcessingReport } from "@/lib/image/types";
import type { QueueItem } from "../types/queue";
import { buildResultsZip } from "./zip";

const item = (id: string, status: QueueItem["status"], filename: string): QueueItem => ({
  id,
  file: new File(["x"], "secret-name.jpg"),
  name: "secret-name.jpg",
  size: 1,
  format: "jpeg",
  previewUrl: null,
  width: null,
  height: null,
  status,
  options: null,
  error: null,
  report: { status: status === "failed" ? "failed" : "success" } as ProcessingReport,
  output: status === "failed" ? null : { blob: new Blob([id]), url: "blob:x", filename },
  findings: {
    version: 1,
    gps: { latitude: 27.7172, longitude: 85.324, altitude: null, fate: "removed" },
    items: [{ kind: "serial", category: "device", value: "SN-0042-SECRET", fate: "removed" }],
  },
});

describe("buildResultsZip", () => {
  it("contains only successful files, with unique names and a value-free report", async () => {
    const blob = await buildResultsZip([
      item("a", "success", "photo-clean.jpg"),
      item("b", "partial", "photo-clean.jpg"),
      item("c", "failed", "broken-clean.jpg"),
    ]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(["photo-clean (2).jpg", "photo-clean.jpg", "report.json"]);
    const report = await zip.file("report.json")!.async("string");
    expect(report).not.toContain("secret-name");
    // Findings carry real values and must never be persisted into the ZIP.
    expect(report).not.toContain("SN-0042-SECRET");
    expect(report).not.toContain("27.7172");
    expect(JSON.parse(report).files).toHaveLength(2);
  });
});
