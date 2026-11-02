import { describe, expect, it } from "vitest";
import { parseServerConfig, toPublicLimits } from "./server-config";

describe("parseServerConfig", () => {
  it("applies safe defaults", () => {
    const c = parseServerConfig({});
    expect(c.maxFileSizeBytes).toBe(25 * 1024 * 1024);
    expect(c.maxFilesPerBatch).toBe(20);
    expect(c.concurrency).toBe(2);
    expect(c.jpegtranPath).toBeNull();
  });

  it("parses overrides and treats empty strings as unset", () => {
    const c = parseServerConfig({ CLEANFRAME_MAX_FILE_SIZE_MB: "50", CLEANFRAME_TEMP_DIR: "" });
    expect(c.maxFileSizeBytes).toBe(50 * 1024 * 1024);
  });

  it.each([
    { CLEANFRAME_MAX_FILE_SIZE_MB: "-1" },
    { CLEANFRAME_MAX_FILE_SIZE_MB: "abc" },
    { CLEANFRAME_PROCESSING_CONCURRENCY: "0" },
    { CLEANFRAME_TEMP_DIR: "relative/dir" },
    { CLEANFRAME_JPEGTRAN_PATH: "jpegtran" },
  ])("rejects invalid values %o", (env) => {
    expect(() => parseServerConfig(env)).toThrow(/Invalid CleanFrame configuration/);
  });

  it("exposes only non-sensitive limits to the client", () => {
    expect(Object.keys(toPublicLimits(parseServerConfig({}))).sort()).toEqual([
      "clientConcurrency",
      "maxFileSizeBytes",
      "maxFilesPerBatch",
    ]);
  });
});
