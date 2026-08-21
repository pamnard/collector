/**
 * Typed background job catalog (#629).
 *
 * How to add a new job type:
 * 1. `defineJobType({ id, payload, timeoutMs?, maxAttempts? })` here (Zod schema for the payload).
 * 2. Append the def to `JOB_TYPE_CATALOG` (sole production type-id list).
 * 3. In the host: `registry.register(thatType, handler)` — no runner/poll edits.
 * 4. Enqueue with `{ type: id, payload }` — unknown types and invalid payloads fail fast.
 *    Optional `timeoutMs` / `maxAttempts` on the type override queue defaults (long-running /
 *    non-retryable contracts).
 *
 * Timers and RPC paths must only enqueue — never call business handlers directly (#639).
 *
 * Scheduling policy (#746): interactive vault open/browse/get stays preferred over
 * bulk vault-mutating work. Bulk mutators enqueue at JOB_PRIORITY_BULK; the runner
 * allows at most one such job in flight under default concurrency so the second
 * slot remains available. Interactive create/update stay direct RPC (not jobs).
 * Priority alone does not make sync SQLite non-blocking.
 */

import { z } from "zod";

/** Interactive-class jobs (claim before bulk). */
export const JOB_PRIORITY_INTERACTIVE = 100;
/** Vault-mutating bulk jobs (below default unset priority). */
export const JOB_PRIORITY_BULK = -10;

/** Production vault-mutating bulk types that share the single bulk mutator slot. */
export const VAULT_MUTATING_BULK_JOB_TYPE_IDS = [
  "dropImportBatch",
  "syncPluginPull",
  "vaultIndexSync",
  "reindexVaultBatch",
] as const;

export type VaultMutatingBulkJobTypeId =
  (typeof VAULT_MUTATING_BULK_JOB_TYPE_IDS)[number];

const vaultMutatingBulkJobTypeIdSet: ReadonlySet<string> = new Set(
  VAULT_MUTATING_BULK_JOB_TYPE_IDS,
);

export function isVaultMutatingBulkJobType(type: string): boolean {
  return vaultMutatingBulkJobTypeIdSet.has(type);
}

export function isLowPriorityVaultMutatingJob(job: {
  type: string;
  priority: number;
}): boolean {
  return (
    isVaultMutatingBulkJobType(job.type) &&
    job.priority <= JOB_PRIORITY_BULK
  );
}

export type JobTypeDef<T extends z.ZodTypeAny = z.ZodTypeAny> = {
  readonly id: string;
  readonly payload: T;
  /**
   * Per-type run timeout. When set, overrides the queue default for this type
   * so long-running work (e.g. folder import) is not killed at 60s.
   */
  readonly timeoutMs?: number;
  /**
   * Default maxAttempts when enqueue omits it. Use 1 for non-retryable types
   * where a timed-out Promise.race must not re-enter the same tree.
   */
  readonly maxAttempts?: number;
};

export function defineJobType<T extends z.ZodTypeAny>(def: {
  id: string;
  payload: T;
  timeoutMs?: number;
  maxAttempts?: number;
}): JobTypeDef<T> {
  if (!def.id) {
    throw new Error("job type id must be non-empty");
  }
  if (def.timeoutMs !== undefined && def.timeoutMs < 1) {
    throw new Error(`job type ${def.id} timeoutMs must be >= 1`);
  }
  if (def.maxAttempts !== undefined && def.maxAttempts < 1) {
    throw new Error(`job type ${def.id} maxAttempts must be >= 1`);
  }
  return {
    id: def.id,
    payload: def.payload,
    ...(def.timeoutMs !== undefined ? { timeoutMs: def.timeoutMs } : {}),
    ...(def.maxAttempts !== undefined ? { maxAttempts: def.maxAttempts } : {}),
  };
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
export const embeddingRefreshInputSchema = z.object({
  itemId: z.string().min(1),
  title: z.string(),
  description: z.string(),
  tagNames: z.array(z.string()),
  body: z.string().optional(),
  contentRevision: z.number().int(),
});

export const refreshEmbeddingsJobPayloadSchema = z.object({
  vaultId: z.string().min(1),
  inputs: z.array(embeddingRefreshInputSchema).min(1),
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
  absolutePath: z.string().min(1),
  filename: z.string().min(1),
  mediaType: z.enum(["image", "video"]),
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

/** Host-path folder bulk import (#747). Large trees may run for hours. */
export const IMPORT_FOLDER_JOB_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** Host-path folder bulk import (#747). */
export const importFolderJobPayloadSchema = z.object({
  vaultId: z.string().min(1),
  sourceDirAbs: z.string().min(1),
  targetFolderPath: z.string().optional(),
});
export type ImportFolderJobPayload = z.infer<
  typeof importFolderJobPayloadSchema
>;
export const importFolderJobType = defineJobType({
  id: "importFolder",
  payload: importFolderJobPayloadSchema,
  // Explicit long-running contract: do not inherit the 60s queue default.
  timeoutMs: IMPORT_FOLDER_JOB_TIMEOUT_MS,
  // Never retry: Promise.race timeouts do not cancel the in-flight handler,
  // and notes without a canonical url are not idempotent across re-runs.
  maxAttempts: 1,
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
  importFolderJobType,
] as const;

export type JobTypeId = (typeof JOB_TYPE_CATALOG)[number]["id"];
