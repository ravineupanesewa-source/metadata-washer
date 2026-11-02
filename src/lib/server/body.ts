import { AppError } from "../security/errors";

/**
 * Reads a raw request body with a hard byte limit. Rejects early from
 * Content-Length when present, and while streaming otherwise, so oversized
 * uploads never get fully buffered.
 */
export async function readLimitedBody(request: Request, limit: number): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) throw new AppError("INVALID_REQUEST");
    if (length > limit) throw new AppError("FILE_TOO_LARGE");
  }
  if (!request.body) throw new AppError("EMPTY_FILE");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new AppError("FILE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new AppError("EMPTY_FILE");

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
