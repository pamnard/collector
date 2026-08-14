/**
 * Late-bound Phase B job handlers (#627).
 *
 * Catalog types are registered at queue create time; domain-runtime (or a
 * focused wire module) assigns the real handler once deps exist.
 * Unbound handlers fail retryably so accidental early enqueue does not
 * permanent-fail before wiring.
 */

import type { z } from "zod";
import type {
  GenerateCoverJobPayload,
  DropImportBatchJobPayload,
  RefreshEmbeddingsJobPayload,
  ReindexVaultBatchJobPayload,
  SyncPluginPullJobPayload,
  VaultIndexSyncJobPayload,
} from "@collector/shared";
import type { TypedJobHandler } from "./job-registry.js";
import type { JobHandlerResult } from "./job-types.js";

function unbound(typeId: string): () => Promise<JobHandlerResult> {
  return async () => ({
    status: "fail",
    retryable: true,
    error: `job handler not bound: ${typeId}`,
    retryAfterMs: 1_000,
  });
}

export const phaseBHandlerBindings: {
  vaultIndexSync: TypedJobHandler<z.ZodType<VaultIndexSyncJobPayload>> | null;
  reindexVaultBatch: TypedJobHandler<
    z.ZodType<ReindexVaultBatchJobPayload>
  > | null;
  refreshEmbeddings: TypedJobHandler<
    z.ZodType<RefreshEmbeddingsJobPayload>
  > | null;
  syncPluginPull: TypedJobHandler<z.ZodType<SyncPluginPullJobPayload>> | null;
  generateCover: TypedJobHandler<z.ZodType<GenerateCoverJobPayload>> | null;
  dropImportBatch: TypedJobHandler<
    z.ZodType<DropImportBatchJobPayload>
  > | null;
} = {
  vaultIndexSync: null,
  reindexVaultBatch: null,
  refreshEmbeddings: null,
  syncPluginPull: null,
  generateCover: null,
  dropImportBatch: null,
};

export function boundPhaseBHandler<P>(
  typeId: keyof typeof phaseBHandlerBindings,
): TypedJobHandler<z.ZodType<P>> {
  return async (job) => {
    const handler = phaseBHandlerBindings[typeId] as TypedJobHandler<
      z.ZodType<P>
    > | null;
    if (!handler) {
      return unbound(typeId)();
    }
    return handler(job);
  };
}
