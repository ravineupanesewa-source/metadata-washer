"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { PublicLimits } from "@/lib/config/limits";
import { sanitizedFilename } from "@/lib/files/filename";
import { SIGNATURE_BYTES, detectSignature } from "@/lib/image/signature";
import type { ProcessingOptions } from "@/lib/image/types";
import type { SanitizerEngine } from "../engine/types";
import { ERROR_TEXT } from "../strings";
import type { QueueItem } from "../types/queue";
import { queueReducer } from "./queue-reducer";

/** Formats most browsers can preview natively. Others show a placeholder. */
const PREVIEWABLE = new Set(["jpeg", "png", "webp", "gif", "avif"]);

let counter = 0;
const nextId = () => `item-${Date.now().toString(36)}-${(counter++).toString(36)}`;

async function toQueueItem(file: File, limits: PublicLimits, accepted: boolean): Promise<QueueItem> {
  const base: QueueItem = {
    id: nextId(),
    file,
    name: file.name,
    size: file.size,
    format: null,
    previewUrl: null,
    width: null,
    height: null,
    status: "invalid",
    options: null,
    error: null,
    report: null,
    output: null,
  };
  const reject = (code: keyof typeof ERROR_TEXT) => ({
    ...base,
    error: { code, message: ERROR_TEXT[code]!, retryable: false },
  });

  if (!accepted) return reject("CLIENT_TOO_MANY");
  if (file.size > limits.maxFileSizeBytes) return reject("CLIENT_TOO_LARGE");
  if (file.size === 0) return reject("CLIENT_UNSUPPORTED");

  const head = new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer());
  const signature = detectSignature(head);
  if (signature.kind !== "supported") return reject("CLIENT_UNSUPPORTED");

  return {
    ...base,
    format: signature.format,
    status: "ready",
    previewUrl: PREVIEWABLE.has(signature.format) ? URL.createObjectURL(file) : null,
  };
}

export interface QueueSummary {
  total: number;
  valid: number;
  ready: number;
  active: number;
  success: number;
  partial: number;
  failed: number;
  finished: boolean;
}

export function useSanitizerQueue(engine: SanitizerEngine, limits: PublicLimits) {
  const [items, dispatch] = useReducer(queueReducer, []);
  const controllers = useRef(new Map<string, AbortController>());
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const revoke = useCallback((item: QueueItem) => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (item.output) URL.revokeObjectURL(item.output.url);
  }, []);

  // Revoke every object URL when the workspace unmounts.
  useEffect(() => {
    const active = controllers.current;
    return () => {
      itemsRef.current.forEach(revoke);
      active.forEach((c) => c.abort());
    };
  }, [revoke]);

  const addFiles = useCallback(
    async (files: readonly File[]) => {
      const existing = itemsRef.current.filter((i) => i.status !== "invalid").length;
      const capacity = Math.max(0, limits.maxFilesPerBatch - existing);
      const created = await Promise.all(files.map((file, i) => toQueueItem(file, limits, i < capacity)));
      dispatch({ type: "add", items: created });
      return {
        added: created.filter((i) => i.status === "ready").length,
        rejected: created.filter((i) => i.status === "invalid").length,
      };
    },
    [limits],
  );

  const setDimensions = useCallback((id: string, width: number, height: number) => {
    dispatch({ type: "dimensions", id, width, height });
  }, []);

  const remove = useCallback(
    (id: string) => {
      controllers.current.get(id)?.abort();
      const item = itemsRef.current.find((i) => i.id === id);
      if (item) revoke(item);
      dispatch({ type: "remove", id });
    },
    [revoke],
  );

  const clear = useCallback(() => {
    controllers.current.forEach((c) => c.abort());
    itemsRef.current.forEach(revoke);
    dispatch({ type: "clear" });
  }, [revoke]);

  const start = useCallback((options: ProcessingOptions) => {
    const ids = itemsRef.current.filter((i) => i.status === "ready").map((i) => i.id);
    dispatch({ type: "enqueue", ids, options });
    return ids;
  }, []);

  const retry = useCallback((id: string, options: ProcessingOptions) => {
    const item = itemsRef.current.find((i) => i.id === id);
    if (item?.output) URL.revokeObjectURL(item.output.url);
    dispatch({ type: "enqueue", ids: [id], options });
  }, []);

  const retryFailed = useCallback((options: ProcessingOptions) => {
    const ids = itemsRef.current.filter((i) => i.status === "failed" || i.status === "cancelled").map((i) => i.id);
    dispatch({ type: "enqueue", ids, options });
    return ids;
  }, []);

  const cancel = useCallback(() => {
    controllers.current.forEach((c) => c.abort());
    dispatch({ type: "cancel" });
  }, []);

  // Pump: start queued items while there are free slots (bounded concurrency).
  useEffect(() => {
    const processing = items.filter((i) => i.status === "processing").length;
    const slots = limits.clientConcurrency - processing;
    if (slots <= 0) return;

    // The controller map guards against double starts (React StrictMode re-runs effects).
    const queued = items.filter((i) => i.status === "queued" && !controllers.current.has(i.id));
    for (const item of queued.slice(0, slots)) {
      const controller = new AbortController();
      controllers.current.set(item.id, controller);
      dispatch({ type: "start", id: item.id });

      engine
        .sanitize(item.file, item.options!, controller.signal)
        .then((result) => {
          if (result.ok) {
            const filename = sanitizedFilename(item.name, result.report.output?.format ?? item.format!);
            const url = URL.createObjectURL(result.blob);
            if (controller.signal.aborted) {
              URL.revokeObjectURL(url);
              return;
            }
            dispatch({ type: "succeed", id: item.id, report: result.report, output: { blob: result.blob, url, filename } });
          } else {
            dispatch({ type: "fail", id: item.id, error: result.error, report: result.report });
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            dispatch({
              type: "fail",
              id: item.id,
              error: { code: "NETWORK", message: ERROR_TEXT.NETWORK!, retryable: true },
              report: null,
            });
          }
        })
        .finally(() => controllers.current.delete(item.id));
    }
  }, [items, engine, limits.clientConcurrency]);

  const summary = useMemo<QueueSummary>(() => {
    const count = (...s: QueueItem["status"][]) => items.filter((i) => s.includes(i.status)).length;
    const active = count("queued", "processing");
    const success = count("success");
    const partial = count("partial");
    const failed = count("failed", "cancelled");
    return {
      total: items.length,
      valid: items.length - count("invalid"),
      ready: count("ready"),
      active,
      success,
      partial,
      failed,
      finished: active === 0 && success + partial + failed > 0,
    };
  }, [items]);

  return { items, summary, addFiles, setDimensions, remove, clear, start, retry, retryFailed, cancel };
}
