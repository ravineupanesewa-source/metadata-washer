import { describe, expect, it } from "vitest";
import type { ProcessingReport } from "@/lib/image/types";
import type { QueueItem } from "../types/queue";
import { queueReducer } from "./queue-reducer";

const item = (id: string, status: QueueItem["status"] = "ready"): QueueItem => ({
  id,
  file: new File(["x"], `${id}.jpg`),
  name: `${id}.jpg`,
  size: 1,
  format: status === "invalid" ? null : "jpeg",
  previewUrl: null,
  width: null,
  height: null,
  status,
  options: null,
  error: null,
  report: null,
  output: null,
});

const options = { mode: "privacy", orientationPolicy: "preserve-tag" } as const;
const report = (status: ProcessingReport["status"]) => ({ status }) as ProcessingReport;

describe("queueReducer", () => {
  it("enqueues valid items only and captures options", () => {
    const state = queueReducer([item("a"), item("b", "invalid")], { type: "enqueue", ids: ["a", "b"], options });
    expect(state.map((i) => i.status)).toEqual(["queued", "invalid"]);
    expect(state[0].options).toEqual(options);
  });

  it("moves through processing to success or partial", () => {
    let state = queueReducer([item("a"), item("b")], { type: "enqueue", ids: ["a", "b"], options });
    state = queueReducer(state, { type: "start", id: "a" });
    state = queueReducer(state, { type: "start", id: "b" });
    const output = { blob: new Blob(), url: "blob:x", filename: "a-clean.jpg" };
    state = queueReducer(state, { type: "succeed", id: "a", report: report("success"), output });
    state = queueReducer(state, { type: "succeed", id: "b", report: report("partial"), output });
    expect(state.map((i) => i.status)).toEqual(["success", "partial"]);
  });

  it("ignores late results for cancelled or removed items", () => {
    let state = queueReducer([item("a", "processing")], { type: "cancel" });
    state = queueReducer(state, { type: "fail", id: "a", error: { code: "X", message: "x", retryable: true }, report: null });
    expect(state[0].status).toBe("cancelled");
    expect(queueReducer([], { type: "start", id: "zzz" })).toEqual([]);
  });

  it("retries a failed item by re-enqueueing and clearing old results", () => {
    const failed = { ...item("a", "failed"), error: { code: "BUSY", message: "busy", retryable: true } };
    const [retried] = queueReducer([failed], { type: "enqueue", ids: ["a"], options });
    expect(retried.status).toBe("queued");
    expect(retried.error).toBeNull();
  });
});
