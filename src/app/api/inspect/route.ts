import { inspectQuerySchema } from "@/features/image-sanitizer/schemas/api";
import { getServerConfig } from "@/lib/config/server-config";
import { inspectImage } from "@/lib/image/inspect";
import { readLimitedBody } from "@/lib/server/body";
import {
  assertBinaryRequest,
  errorResponse,
  getProcessingSemaphore,
  jsonResponse,
  parseQuery,
} from "@/lib/server/http";

/**
 * POST /api/inspect?reveal=0|1
 * Body: the raw image bytes. Returns metadata categories and tag names;
 * tag values only when reveal=1 (explicit user request).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertBinaryRequest(request);
    const query = parseQuery(request, inspectQuerySchema);
    const bytes = await readLimitedBody(request, getServerConfig().maxFileSizeBytes);
    const result = await getProcessingSemaphore().run(() => inspectImage(bytes, query.reveal === "1"), request.signal);
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
