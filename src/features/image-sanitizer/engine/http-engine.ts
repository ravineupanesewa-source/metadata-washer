import { ERROR_TEXT } from "../strings";
import {
  FINDINGS_HEADER,
  REPORT_HEADER,
  metadataFindingsSchema,
  apiErrorSchema,
  inspectionResultSchema,
  processingReportSchema,
} from "../schemas/api";
import type { MetadataFindings, ProcessingReport } from "@/lib/image/types";
import type { EngineError, SanitizerEngine } from "./types";

const RETRYABLE = new Set(["BUSY", "TIMEOUT", "PROCESSING_FAILED", "NETWORK"]);

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

async function readError(response: Response): Promise<{ error: EngineError; report: ProcessingReport | null }> {
  try {
    const body = apiErrorSchema.parse(await response.json());
    return {
      error: { ...body.error, retryable: RETRYABLE.has(body.error.code) },
      report: body.report ?? null,
    };
  } catch {
    return {
      error: { code: "PROCESSING_FAILED", message: "The server returned an unexpected response.", retryable: true },
      report: null,
    };
  }
}

/** Findings are a nice-to-have: anything unreadable degrades to "no findings", never to a failure. */
function readFindings(header: string | null): MetadataFindings | null {
  if (!header) return null;
  try {
    const parsed = metadataFindingsSchema.safeParse(JSON.parse(decodeBase64Url(header)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const networkError = (): EngineError => ({ code: "NETWORK", message: ERROR_TEXT.NETWORK!, retryable: true });

/** Sends raw bytes to the CleanFrame API: one upload per file, no base64. */
export function createHttpEngine(baseUrl = ""): SanitizerEngine {
  return {
    async sanitize(file, options, signal) {
      const query = new URLSearchParams({ mode: options.mode, orientation: options.orientationPolicy });
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/api/sanitize?${query}`, {
          method: "POST",
          body: file,
          headers: { "content-type": "application/octet-stream" },
          cache: "no-store",
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw error;
        return { ok: false, error: networkError(), report: null };
      }

      if (!response.ok) return { ok: false, ...(await readError(response)) };

      const header = response.headers.get(REPORT_HEADER);
      let parsed: ReturnType<typeof processingReportSchema.safeParse> | null = null;
      try {
        parsed = header ? processingReportSchema.safeParse(JSON.parse(decodeBase64Url(header))) : null;
      } catch {
        parsed = null;
      }
      if (!parsed?.success) {
        return {
          ok: false,
          error: { code: "PROCESSING_FAILED", message: "The server's report could not be read.", retryable: true },
          report: null,
        };
      }
      const blob = await response.blob();
      return {
        ok: true,
        report: parsed.data,
        blob: blob.slice(0, blob.size, parsed.data.output?.mimeType),
        findings: readFindings(response.headers.get(FINDINGS_HEADER)),
      };
    },

    async inspect(file, reveal, signal) {
      const response = await fetch(`${baseUrl}/api/inspect?reveal=${reveal ? "1" : "0"}`, {
        method: "POST",
        body: file,
        headers: { "content-type": "application/octet-stream" },
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error((await readError(response)).error.message);
      return inspectionResultSchema.parse(await response.json());
    },
  };
}
