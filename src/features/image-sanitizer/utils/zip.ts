import JSZip from "jszip";
import { dedupeFilenames } from "@/lib/files/filename";
import type { QueueItem } from "../types/queue";

/**
 * Builds a ZIP of verified outputs only. `report.json` contains categories and
 * verification results, never metadata values or original filenames.
 */
export async function buildResultsZip(items: readonly QueueItem[]): Promise<Blob> {
  const done = items.filter((i) => (i.status === "success" || i.status === "partial") && i.output && i.report);
  const names = dedupeFilenames(done.map((i) => i.output!.filename));
  const zip = new JSZip();

  done.forEach((item, index) => {
    zip.file(names[index], item.output!.blob, { binary: true, date: new Date(0) });
  });

  const report = {
    generatedBy: "CleanFrame",
    files: done.map((item, index) => ({ file: names[index], ...item.report! })),
  };
  zip.file("report.json", JSON.stringify(report, null, 2), { date: new Date(0) });

  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

export function zipFilename(now = new Date()): string {
  return `cleanframe-${now.toISOString().slice(0, 10)}.zip`;
}

/** Triggers a download for a blob/object URL without navigating away. */
export function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
