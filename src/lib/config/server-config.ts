import "server-only";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { PublicLimits } from "./limits";

const MB = 1024 * 1024;

export const serverConfigSchema = z.object({
  CLEANFRAME_MAX_FILE_SIZE_MB: z.coerce.number().positive().max(512).default(25),
  CLEANFRAME_MAX_FILES_PER_BATCH: z.coerce.number().int().min(1).max(200).default(20),
  CLEANFRAME_PROCESSING_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  CLEANFRAME_MAX_QUEUED_REQUESTS: z.coerce.number().int().min(0).max(1000).default(20),
  CLEANFRAME_PROCESSING_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000),
  CLEANFRAME_TEMP_DIR: z
    .string()
    .trim()
    .min(1)
    .refine((value) => path.isAbsolute(value), "must be an absolute path")
    .optional(),
  CLEANFRAME_JPEGTRAN_PATH: z
    .string()
    .trim()
    .min(1)
    .refine((value) => path.isAbsolute(value), "must be an absolute path")
    .optional(),
});

export interface ServerConfig {
  maxFileSizeBytes: number;
  maxFilesPerBatch: number;
  concurrency: number;
  maxQueuedRequests: number;
  timeoutMs: number;
  tempRoot: string;
  jpegtranPath: string | null;
}

export function parseServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const parsed = serverConfigSchema.safeParse(
    Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== "")),
  );
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid CleanFrame configuration: ${fields}`);
  }
  const c = parsed.data;
  return {
    maxFileSizeBytes: Math.floor(c.CLEANFRAME_MAX_FILE_SIZE_MB * MB),
    maxFilesPerBatch: c.CLEANFRAME_MAX_FILES_PER_BATCH,
    concurrency: c.CLEANFRAME_PROCESSING_CONCURRENCY,
    maxQueuedRequests: c.CLEANFRAME_MAX_QUEUED_REQUESTS,
    timeoutMs: c.CLEANFRAME_PROCESSING_TIMEOUT_MS,
    tempRoot: c.CLEANFRAME_TEMP_DIR ?? os.tmpdir(),
    jpegtranPath: c.CLEANFRAME_JPEGTRAN_PATH ?? null,
  };
}

let cached: ServerConfig | null = null;

export function getServerConfig(): ServerConfig {
  cached ??= parseServerConfig(process.env);
  return cached;
}

export function toPublicLimits(config: ServerConfig): PublicLimits {
  return {
    maxFileSizeBytes: config.maxFileSizeBytes,
    maxFilesPerBatch: config.maxFilesPerBatch,
    clientConcurrency: Math.min(config.concurrency, 3),
  };
}
