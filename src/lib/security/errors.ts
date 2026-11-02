/**
 * Error model shared by the engine and API. Only `code` and the fixed message
 * for that code ever reach clients: never paths, stack traces or tool output.
 */

export const ERROR_CODES = {
  INVALID_REQUEST: { status: 400, message: "The request was not understood." },
  EMPTY_FILE: { status: 400, message: "The file is empty." },
  FILE_TOO_LARGE: { status: 413, message: "The file exceeds the maximum allowed size." },
  UNSUPPORTED_FORMAT: { status: 415, message: "This file type is not supported." },
  MALFORMED_IMAGE: { status: 422, message: "The image appears to be damaged or truncated." },
  ORIENTATION_UNSAFE: {
    status: 422,
    message:
      "This image needs rotation to stay upright, and that cannot be done losslessly here. Keep the orientation tag or allow re-encoding.",
  },
  VERIFICATION_FAILED: {
    status: 422,
    message: "Metadata removal could not be verified, so no file was produced.",
  },
  PROCESSING_FAILED: { status: 500, message: "The image could not be processed." },
  TIMEOUT: { status: 504, message: "Processing took too long and was stopped." },
  BUSY: { status: 503, message: "The server is busy. Please retry in a moment." },
  ABORTED: { status: 499, message: "The request was cancelled." },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, options?: { cause?: unknown }) {
    super(ERROR_CODES[code].message, options);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_CODES[code].status;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Normalises any thrown value into a safe AppError. */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  if (error instanceof Error && error.name === "AbortError") return new AppError("ABORTED", { cause: error });
  return new AppError("PROCESSING_FAILED", { cause: error });
}

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
}

export function toErrorBody(error: AppError): ApiErrorBody {
  return { error: { code: error.code, message: ERROR_CODES[error.code].message } };
}
