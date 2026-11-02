import { describe, expect, it } from "vitest";
import { AppError, toAppError, toErrorBody } from "./errors";

describe("error mapping", () => {
  it("never leaks internal messages", () => {
    const err = toAppError(new Error("ENOENT: /tmp/cleanframe-abc/input.jpg"));
    expect(err.code).toBe("PROCESSING_FAILED");
    expect(JSON.stringify(toErrorBody(err))).not.toContain("/tmp");
  });

  it("keeps AppErrors and maps aborts", () => {
    expect(toAppError(new AppError("FILE_TOO_LARGE")).status).toBe(413);
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(toAppError(abort).code).toBe("ABORTED");
  });
});
