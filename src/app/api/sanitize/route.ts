import { sanitizeQuerySchema } from "@/features/image-sanitizer/schemas/api";
import { getServerConfig } from "@/lib/config/server-config";
import { contentDisposition, sanitizedFilename } from "@/lib/files/filename";
import { sanitizeImage } from "@/lib/image/sanitize";
import { AppError } from "@/lib/security/errors";
import { readLimitedBody } from "@/lib/server/body";
import {
  PRIVATE_HEADERS,
  assertBinaryRequest,
  encodeFindingsHeader,
  encodeReportHeader,
  errorResponse,
  getProcessingSemaphore,
  parseQuery,
} from "@/lib/server/http";

/**
 * POST /api/sanitize?mode=privacy|strict&orientation=preserve-tag|lossless-or-fail|allow-reencode
 * Body: the raw image bytes (application/octet-stream).
 *
 * 200 → sanitized bytes; report in the `X-CleanFrame-Report` header (base64url JSON) and,
 *       when the original revealed anything, value highlights in `X-CleanFrame-Findings`
 *       (base64url JSON, same no-store response; never logged or persisted).
 * 422 → { error, report } when verification failed; no file is returned.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertBinaryRequest(request);
    const query = parseQuery(request, sanitizeQuerySchema);
    const config = getServerConfig();
    const bytes = await readLimitedBody(request, config.maxFileSizeBytes);

    const outcome = await getProcessingSemaphore().run(
      () =>
        sanitizeImage({
          bytes,
          options: { mode: query.mode, orientationPolicy: query.orientation },
          signal: request.signal,
        }),
      request.signal,
    );

    if (!outcome.output) {
      return errorResponse(new AppError("VERIFICATION_FAILED"), { report: outcome.report });
    }

    const findings = encodeFindingsHeader(outcome.findings);
    return new Response(new Uint8Array(outcome.output), {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": outcome.report.output?.mimeType ?? "application/octet-stream",
        "Content-Length": String(outcome.output.byteLength),
        "Content-Disposition": contentDisposition(sanitizedFilename("image", outcome.format)),
        "X-CleanFrame-Report": encodeReportHeader(outcome.report),
        ...(findings ? { "X-CleanFrame-Findings": findings } : {}),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
