/**
 * Late-bound Phase B job handlers (#627).
 *
 * Catalog types are registered at queue create time; domain-runtime assigns
 * the real handler once deps exist. Unbound handlers fail retryably so
 * accidental early enqueue does not permanent-fail before wiring.
 */

import type { TypedJobHandler } from "./job-registry.js";
import type { JobHandlerResult } from "./job-types.js";
import type { z } from "zod";

function unbound(typeId: string): () => Promise<JobHandlerResult> {
  return async () => ({
    status: "fail",
    retryable: true,
    error: `job handler not bound: ${typeId}`,
    retryAfterMs: 1_000,
  });
}

type AnyTypedHandler = TypedJobHandler<z.ZodTypeAny>;

export const phaseBHandlerBindings: {
  vaultIndexSync: AnyTypedHandler | null;
  reindexVaultBatch: AnyTypedHandler | null;
  refreshEmbeddings: AnyTypedHandler | null;
  syncPluginPull: AnyTypedHandler | null;
  generateCover: AnyTypedHandler | null;
  dropImportBatch: AnyTypedHandler | null;
} = {
  vaultIndexSync: null,
  reindexVaultBatch: null,
  refreshEmbeddings: null,
  syncPluginPull: null,
  generateCover: null,
  dropImportBatch: null,
};

export function boundPhaseBHandler(
  typeId: keyof typeof phaseBHandlerBindings,
): AnyTypedHandler {
  return async (job) => {
    const handler = phaseBHandlerBindings[typeId];
    if (!handler) {
      return unbound(typeId)();
    }
    return handler(job);
  };
}
