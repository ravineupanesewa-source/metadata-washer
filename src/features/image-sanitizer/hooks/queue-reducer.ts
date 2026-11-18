import type { MetadataFindings, ProcessingOptions, ProcessingReport } from "@/lib/image/types";
import type { ItemError, ItemOutput, QueueItem } from "../types/queue";

export type QueueAction =
  | { type: "add"; items: QueueItem[] }
  | { type: "dimensions"; id: string; width: number; height: number }
  | { type: "remove"; id: string }
  | { type: "clear" }
  | { type: "enqueue"; ids: string[]; options: ProcessingOptions }
  | { type: "start"; id: string }
  | { type: "succeed"; id: string; report: ProcessingReport; output: ItemOutput; findings?: MetadataFindings | null }
  | { type: "fail"; id: string; error: ItemError; report: ProcessingReport | null }
  | { type: "cancel" };

function update(items: QueueItem[], id: string, patch: (item: QueueItem) => Partial<QueueItem>): QueueItem[] {
  return items.map((item) => (item.id === id ? { ...item, ...patch(item) } : item));
}

export function queueReducer(items: QueueItem[], action: QueueAction): QueueItem[] {
  switch (action.type) {
    case "add":
      return [...items, ...action.items];
    case "dimensions":
      return update(items, action.id, () => ({ width: action.width, height: action.height }));
    case "remove":
      return items.filter((item) => item.id !== action.id);
    case "clear":
      return [];
    case "enqueue": {
      const ids = new Set(action.ids);
      return items.map((item) =>
        ids.has(item.id) && item.status !== "invalid" && item.status !== "processing"
          ? { ...item, status: "queued", options: action.options, error: null, report: null, output: null, findings: null }
          : item,
      );
    }
    case "start":
      return update(items, action.id, (item) => (item.status === "queued" ? { status: "processing" } : {}));
    case "succeed":
      return update(items, action.id, (item) =>
        item.status === "processing"
          ? { status: action.report.status === "success" ? "success" : "partial", report: action.report, output: action.output, findings: action.findings ?? null }
          : {},
      );
    case "fail":
      return update(items, action.id, (item) =>
        item.status === "processing" ? { status: "failed", error: action.error, report: action.report } : {},
      );
    case "cancel":
      return items.map((item) =>
        item.status === "queued" || item.status === "processing" ? { ...item, status: "cancelled" } : item,
      );
  }
}
