/**
 * Typed background job catalog (#629).
 *
 * How to add a new job type:
 * 1. `defineJobType({ id, payload })` here (Zod schema for the payload).
 * 2. Append the def to `JOB_TYPE_CATALOG` (sole production type-id list).
 * 3. In the host: `registry.register(thatType, handler)` — no runner/poll edits.
 * 4. Enqueue with `{ type: id, payload }` — unknown types and invalid payloads fail fast.
 */

import { z } from "zod";

export type JobTypeDef<T extends z.ZodTypeAny = z.ZodTypeAny> = {
  readonly id: string;
  readonly payload: T;
};

export function defineJobType<T extends z.ZodTypeAny>(def: {
  id: string;
  payload: T;
}): JobTypeDef<T> {
  if (!def.id) {
    throw new Error("job type id must be non-empty");
  }
  return { id: def.id, payload: def.payload };
}

export const testNoopJobPayloadSchema = z.object({
  fail: z.enum(["retryable", "permanent"]).optional(),
  retryAfterMs: z.number().int().nonnegative().optional(),
});

export type TestNoopJobPayload = z.infer<typeof testNoopJobPayloadSchema>;

export const testNoopJobType = defineJobType({
  id: "__test_noop",
  payload: testNoopJobPayloadSchema,
});

/** Full / force vault index sync (#631 / #638). */
export const vaultIndexSyncJobPayloadSchema = z.object({
  vaultId: z.string().min(1),
  vaultPath: z.string().min(1),
  reason: z.enum(["kickoff", "force", "recovery"]).default("kickoff"),
});
export type VaultIndexSyncJobPayload = z.infer<
  typeof vaultIndexSyncJobPayloadSchema
>;
export const vaultIndexSyncJobType = defineJobType({
  id: "vaultIndexSync",
  payload: vaultIndexSyncJobPayloadSchema,
});

/** Targeted FS-watcher reindex batch (#632). */
export const reindexVaultBatchJobPayloadSchema = z.object({
  vaultId: z.string().min(1),
  vaultPath: z.string().min(1),
  itemIds: z.array(z.string().min(1)).default([]),
  folderPaths: z.array(z.string()).default([]),
});
export type ReindexVaultBatchJobPayload = z.infer<
  typeof reindexVaultBatchJobPayloadSchema
>;
export const reindexVaultBatchJobType = defineJobType({
  id: "reindexVaultBatch",
  payload: reindexVaultBatchJobPayloadSchema,
});

/** Embedding refresh batch (#633). */
export const refreshEmbeddingsJobPayloadSchema = z.object({
  vaultId: z.string().min(1),
  itemIds: z.array(z.string().min(1)).min(1),
});
export type RefreshEmbeddingsJobPayload = z.infer<
  typeof refreshEmbeddingsJobPayloadSchema
>;
export const refreshEmbeddingsJobType = defineJobType({
  id: "refreshEmbeddings",
  payload: refreshEmbeddingsJobPayloadSchema,
});

/** Sync plugin pull cycle (#634 / #635). */
export const syncPluginPullJobPayloadSchema = z.object({
  pluginId: z.string().min(1),
});
export type SyncPluginPullJobPayload = z.infer<
  typeof syncPluginPullJobPayloadSchema
>;
export const syncPluginPullJobType = defineJobType({
  id: "syncPluginPull",
  payload: syncPluginPullJobPayloadSchema,
});

/** Media cover generation (#636). */
export const generateCoverJobPayloadSchema = z.object({
  vaultId: z.string().min(1),
  itemId: z.string().min(1),
  mediaId: z.string().min(1),
});
export type GenerateCoverJobPayload = z.infer<
  typeof generateCoverJobPayloadSchema
>;
export const generateCoverJobType = defineJobType({
  id: "generateCover",
  payload: generateCoverJobPayloadSchema,
});

/** Drop-import heavy batch (#637). */
export const dropImportBatchJobPayloadSchema = z.object({
  vaultId: z.string().min(1),
  stagingDir: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
  targetFolderId: z.string().min(1).nullable().optional(),
});
export type DropImportBatchJobPayload = z.infer<
  typeof dropImportBatchJobPayloadSchema
>;
export const dropImportBatchJobType = defineJobType({
  id: "dropImportBatch",
  payload: dropImportBatchJobPayloadSchema,
});

/**
 * Production catalog — the single explicit list of job type ids (#629).
 * Phase B types join here; test suites may pass a local catalog to
 * `createJobRegistry` without mutating this array.
 */
export const JOB_TYPE_CATALOG = [
  testNoopJobType,
  vaultIndexSyncJobType,
  reindexVaultBatchJobType,
  refreshEmbeddingsJobType,
  syncPluginPullJobType,
  generateCoverJobType,
  dropImportBatchJobType,
] as const;

export type JobTypeId = (typeof JOB_TYPE_CATALOG)[number]["id"];
