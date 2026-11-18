import "server-only";
import { getServerConfig } from "../config/server-config";
import { AppError, toAppError, toErrorBody } from "../security/errors";
import { Semaphore } from "./semaphore";
import type { MetadataFindings, ProcessingReport } from "../image/types";

/** Headers for every processing response: nothing may be cached or sniffed. */
export const PRIVATE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
} as const;

const globalKey = Symbol.for("cleanframe.semaphore");
type GlobalWithSemaphore = typeof globalThis & { [globalKey]?: Semaphore };

/** Process-wide limiter shared by all processing routes. */
export function getProcessingSemaphore(): Semaphore {
  const g = globalThis as GlobalWithSemaphore;
  if (!g[globalKey]) {
    const config = getServerConfig();
    g[globalKey] = new Semaphore(config.concurrency, config.maxQueuedRequests);
  }
  return g[globalKey];
}

export function encodeReportHeader(report: ProcessingReport): string {
  return Buffer.from(JSON.stringify(report), "utf8").toString("base64url");
}

/** Keeps the findings header well under common proxy header limits (8 KB per header). */
const MAX_FINDINGS_HEADER = 6 * 1024;

/**
 * Encodes findings for the `X-CleanFrame-Findings` header, dropping the least
 * important items if needed. Returns null when there is nothing worth sending.
 */
export function encodeFindingsHeader(findings: MetadataFindings | null): string | null {
  if (!findings) return null;
  const items = [...findings.items];
  for (;;) {
    if (!findings.gps && items.length === 0) return null;
    const encoded = Buffer.from(JSON.stringify({ ...findings, items }), "utf8").toString("base64url");
    if (encoded.length <= MAX_FINDINGS_HEADER) return encoded;
    if (items.length === 0) return null;
    items.pop();
  }
}

export function parseQuery<T>(request: Request, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }): T {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = schema.safeParse(params);
  if (!parsed.success) throw new AppError("INVALID_REQUEST");
  return parsed.data;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: PRIVATE_HEADERS });
}

/**
 * Converts any failure to a safe JSON error. Internal details are logged as
 * the error code only: never file contents, metadata values or paths.
 */
export function errorResponse(error: unknown, extra?: { report?: ProcessingReport }): Response {
  const appError = toAppError(error);
  if (appError.code === "PROCESSING_FAILED") {
    console.error(`[cleanframe] processing failed (${(appError.cause as Error | undefined)?.name ?? "unknown"})`);
  }
  return jsonResponse({ ...toErrorBody(appError), ...extra }, appError.status);
}

/** Requires the request to carry a raw binary body, not a form or JSON payload. */
export function assertBinaryRequest(request: Request): void {
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (type !== "application/octet-stream" && !type.startsWith("image/")) {
    throw new AppError("INVALID_REQUEST");
  }
}
