import { z } from "zod";
import {
  IMAGE_FORMATS,
  METADATA_CATEGORIES,
  METADATA_MODES,
  ORIENTATION_POLICIES,
} from "@/lib/image/types";

/** Query parameters for POST /api/sanitize. */
export const sanitizeQuerySchema = z
  .object({
    mode: z.enum(METADATA_MODES).default("privacy"),
    orientation: z.enum(ORIENTATION_POLICIES).default("preserve-tag"),
  })
  .strict();

/** Query parameters for POST /api/inspect. */
export const inspectQuerySchema = z
  .object({
    reveal: z.enum(["0", "1"]).default("0"),
  })
  .strict();

const category = z.enum(METADATA_CATEGORIES);
const facts = z.object({
  format: z.enum(IMAGE_FORMATS),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  frameCount: z.number().int().positive(),
});

/** Validates the report received by the client (it crosses a trust boundary via a header). */
export const processingReportSchema = z.object({
  version: z.literal(1),
  status: z.enum(["success", "partial", "failed"]),
  mode: z.enum(METADATA_MODES),
  input: facts,
  output: facts.nullable(),
  metadata: z.object({
    before: z.array(z.object({ category, count: z.number().int().nonnegative() })),
    removed: z.array(category),
    retained: z.array(z.object({ category, reason: z.enum(["color-rendering", "visible-orientation"]) })),
    stillPresent: z.array(category),
    noMetadataDetected: z.boolean(),
  }),
  icc: z.object({ present: z.boolean(), retained: z.boolean() }),
  orientation: z.object({
    original: z.number().int().nullable(),
    action: z.enum(["none", "kept-tag", "lossless-transform", "reencode-transform"]),
  }),
  pixelData: z.object({
    reencoded: z.boolean(),
    integrity: z.enum(["identical", "not-verifiable", "transformed", "mismatch"]),
  }),
  verification: z.object({
    status: z.enum(["verified", "partial", "failed"]),
    checks: z.array(
      z.object({
        id: z.enum(["format", "dimensions", "frames", "pixel-data", "metadata-removed", "output-readable"]),
        status: z.enum(["pass", "fail", "unverifiable"]),
      }),
    ),
  }),
  notices: z.array(
    z.enum([
      "icc-retained",
      "icc-removed-color-may-change",
      "orientation-tag-kept",
      "orientation-lossless-transform",
      "orientation-reencoded",
      "pixel-integrity-not-verifiable",
      "format-container-orientation",
      "untested-format",
    ]),
  ),
});

export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
  report: processingReportSchema.optional(),
});

export const inspectionResultSchema = z.object({
  format: z.enum(IMAGE_FORMATS),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  frameCount: z.number().int(),
  orientation: z.number().int().nullable(),
  categories: z.array(z.object({ category, count: z.number().int() })),
  tags: z.array(z.object({ group: z.string(), name: z.string(), category, value: z.string().optional() })),
});

export const REPORT_HEADER = "x-cleanframe-report";

