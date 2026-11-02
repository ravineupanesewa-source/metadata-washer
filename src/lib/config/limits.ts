import { z } from "zod";

/**
 * Limits shared with the client. The server re-validates every request; the
 * client copy only drives UX (early rejection and copy).
 */
export const publicLimitsSchema = z.object({
  maxFileSizeBytes: z.number().int().positive(),
  maxFilesPerBatch: z.number().int().positive(),
  clientConcurrency: z.number().int().positive(),
});

export type PublicLimits = z.infer<typeof publicLimitsSchema>;
