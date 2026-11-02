import type { ImageFormat, ProcessingOptions, ProcessingReport } from "@/lib/image/types";

export type ItemStatus =
  | "ready"
  | "invalid"
  | "queued"
  | "processing"
  | "success"
  | "partial"
  | "failed"
  | "cancelled";

export interface ItemError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ItemOutput {
  blob: Blob;
  url: string;
  filename: string;
}

export interface QueueItem {
  id: string;
  file: File;
  /** Original filename. Untrusted: always rendered as text. */
  name: string;
  size: number;
  format: ImageFormat | null;
  previewUrl: string | null;
  width: number | null;
  height: number | null;
  status: ItemStatus;
  /** Options captured when the item was queued, so mid-batch changes don't apply. */
  options: ProcessingOptions | null;
  error: ItemError | null;
  report: ProcessingReport | null;
  output: ItemOutput | null;
}

export const FINISHED_STATUSES: readonly ItemStatus[] = ["success", "partial", "failed", "cancelled"];
export const ACTIVE_STATUSES: readonly ItemStatus[] = ["queued", "processing"];
