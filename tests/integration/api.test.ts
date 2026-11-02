import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { POST as sanitize } from "@/app/api/sanitize/route";
import { POST as inspect } from "@/app/api/inspect/route";
import { processingReportSchema, inspectionResultSchema, apiErrorSchema } from "@/features/image-sanitizer/schemas/api";
import { shutdownExifTool } from "@/lib/image/exiftool";

const FIXTURES = path.resolve(import.meta.dirname, "../fixtures");
const fixture = (name: string) => readFile(path.join(FIXTURES, name));

function post(route: string, body: BodyInit | null, init: { query?: string; type?: string; headers?: Record<string, string> } = {}) {
  return new Request(`http://localhost/api/${route}${init.query ?? ""}`, {
    method: "POST",
    body,
    headers: { "content-type": init.type ?? "application/octet-stream", ...init.headers },
    // @ts-expect-error Node's Request needs duplex for streamed bodies
    duplex: "half",
  });
}

function decodeReport(response: Response) {
  const header = response.headers.get("x-cleanframe-report");
  expect(header).toBeTruthy();
  return processingReportSchema.parse(JSON.parse(Buffer.from(header!, "base64url").toString("utf8")));
}

afterAll(async () => {
  await shutdownExifTool();
});

describe("POST /api/sanitize", () => {
  it("returns the sanitized file with a valid report and no-store headers", async () => {
    const res = await sanitize(post("sanitize", await fixture("jpeg-full-orient6.jpg")));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="image-clean.jpg"; filename*=UTF-8''image-clean.jpg`,
    );
    const report = decodeReport(res);
    expect(report.status).toBe("success");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.byteLength).toBe(report.output?.size);
    expect(body.toString("latin1")).not.toContain("SN-0042-SECRET");
  });

  it("honours strict mode", async () => {
    const res = await sanitize(post("sanitize", await fixture("jpeg-icc.jpg"), { query: "?mode=strict" }));
    expect(decodeReport(res).icc.retained).toBe(false);
  });

  it.each([
    ["?mode=everything", "INVALID_REQUEST"],
    ["?orientation=rotate", "INVALID_REQUEST"],
    ["?mode=privacy&extra=1", "INVALID_REQUEST"],
  ])("rejects bad query %s", async (query, code) => {
    const res = await sanitize(post("sanitize", await fixture("jpeg-icc.jpg"), { query }));
    expect(res.status).toBe(400);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe(code);
  });

  it("rejects multipart and JSON payloads", async () => {
    const form = new FormData();
    form.append("file", new Blob([await fixture("jpeg-icc.jpg")]), "a.jpg");
    const res = await sanitize(new Request("http://localhost/api/sanitize", { method: "POST", body: form }));
    expect(res.status).toBe(400);
    const json = await sanitize(post("sanitize", "{}", { type: "application/json" }));
    expect(json.status).toBe(400);
  });

  it("detects MIME spoofing from content, not headers", async () => {
    const res = await sanitize(post("sanitize", await fixture("not-an-image.jpg"), { type: "image/jpeg" }));
    expect(res.status).toBe(415);
    const svg = await sanitize(post("sanitize", await fixture("vector.svg"), { type: "image/png" }));
    expect(svg.status).toBe(415);
  });

  it("rejects an oversized declared Content-Length before reading the body", async () => {
    const res = await sanitize(
      post("sanitize", new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "content-length": String(1024 * 1024 * 1024) } }),
    );
    expect(res.status).toBe(413);
  });

  it("rejects an oversized streamed body without Content-Length", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ > 40) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const res = await sanitize(post("sanitize", stream));
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(40);
  });

  it("rejects empty and truncated files with structured errors", async () => {
    expect((await sanitize(post("sanitize", new Uint8Array()))).status).toBe(400);
    const truncated = await sanitize(post("sanitize", await fixture("truncated.jpg")));
    expect(truncated.status).toBe(422);
    const body = apiErrorSchema.parse(await truncated.json());
    expect(body.error.code).toBe("MALFORMED_IMAGE");
    expect(JSON.stringify(body)).not.toMatch(/\/tmp|cleanframe-|exiftool/i);
  });

  it("refuses unsafe orientation handling instead of rotating the image", async () => {
    const res = await sanitize(
      post("sanitize", await fixture("jpeg-full-orient6.jpg"), { query: "?mode=strict&orientation=lossless-or-fail" }),
    );
    // 200 only if a lossless jpegtran is installed on this machine.
    if (res.status !== 200) {
      expect(res.status).toBe(422);
      expect(apiErrorSchema.parse(await res.json()).error.code).toBe("ORIENTATION_UNSAFE");
    }
  });
});

describe("POST /api/inspect", () => {
  it("returns categories without values by default", async () => {
    const res = await inspect(post("inspect", await fixture("jpeg-full-orient6.jpg")));
    expect(res.status).toBe(200);
    const body = inspectionResultSchema.parse(await res.json());
    expect(body.categories.map((c) => c.category)).toContain("location");
    expect(JSON.stringify(body)).not.toContain("SN-0042-SECRET");
  });

  it("returns values only with reveal=1", async () => {
    const res = await inspect(post("inspect", await fixture("jpeg-full-orient6.jpg"), { query: "?reveal=1" }));
    expect(JSON.stringify(await res.json())).toContain("SN-0042-SECRET");
  });
});
