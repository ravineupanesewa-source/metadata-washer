import type { InspectionResult, MetadataFindings, ProcessingOptions, ProcessingReport } from "@/lib/image/types";

/**
 * The UI depends only on this interface, so a future in-browser (WASM)
 * engine can replace the HTTP engine without UI changes.
 */
export interface SanitizerEngine {
  sanitize(file: Blob, options: ProcessingOptions, signal: AbortSignal): Promise<SanitizeResult>;
  inspect(file: Blob, reveal: boolean, signal: AbortSignal): Promise<InspectionResult>;
}

export type SanitizeResult =
  /** `findings` is null when the original revealed nothing or the header was missing/invalid. */
  | { ok: true; report: ProcessingReport; blob: Blob; findings: MetadataFindings | null }
  | { ok: false; error: EngineError; report: ProcessingReport | null };

export interface EngineError {
  code: string;
  message: string;
  /** Whether retrying the same request might succeed. */
  retryable: boolean;
}
