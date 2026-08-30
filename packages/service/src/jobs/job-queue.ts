import type { JobPermanentFailure } from "@collector/api";
import {
  JOB_PRIORITY_BULK,
  JOB_TYPE_CATALOG,
  dropImportBatchJobType,
  importFolderJobType,
  itemDerivedRefreshJobType,
  itemExtractAutoJobType,
  generateCoverJobType,
  isVaultMutatingBulkJobType,
  refreshEmbeddingsJobType,
  reindexVaultBatchJobType,
  syncPluginPullJobType,
  tagCatalogPruneJobType,
  testNoopJobType,
  vaultIndexSyncJobType,
  type TestNoopJobPayload,
} from "@collector/shared";
import { runJobsMigrations } from "@collector/db";
import { NodeSqliteExecutor } from "../host/node-sql.js";
import {
  createJobRegistry,
  type JobRegistry,
  type TypedJobHandler,
} from "./job-registry.js";
import { createJobRunner } from "./job-runner.js";
import {
  createJobStore,
  type JobRow,
  type JobStats,
  type JobStatusCounts,
} from "./job-store.js";
import { boundPhaseBHandler } from "./phase-b-bindings.js";

export type {
  JobHandler,
  JobHandlerInput,
  JobHandlerResult,
} from "./job-types.js";
export type { JobStats, JobStatusCounts, JobRow };
export type { JobRegistry, TypedJobHandler } from "./job-registry.js";
export { createJobRegistry } from "./job-registry.js";

export interface EnqueueInput {
  type: string;
  payload?: unknown;
  idempotencyKey?: string;
  priority?: number;
  delayMs?: number;
  maxAttempts?: number;
}

export interface EnqueueResult {
  id: string;
  deduped: boolean;
}

export interface JobQueue {
  enqueue(input: EnqueueInput): Promise<EnqueueResult>;
  cancel(id: string): Promise<boolean>;
  /** Cancel pending jobs whose idempotency key starts with prefix (#875). */
  cancelPendingByIdempotencyKeyPrefix(prefix: string): Promise<number>;
  getJob(id: string): Promise<JobRow | null>;
  /** Latest job for key (any status); for opt-in waitDerived (#770). */
  findByIdempotencyKey(key: string): Promise<JobRow | null>;
  /** Latest job whose idempotency key starts with prefix (#770). */
  findLatestByIdempotencyKeyPrefix(prefix: string): Promise<JobRow | null>;
  stats(): Promise<JobStats>;
  start(): void;
  stop(): Promise<void>;
}

export interface CreateJobQueueOptions {
  dbPath: string;
  registry: JobRegistry;
  concurrency?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => Date;
  createId?: () => string;
  /** Fired once when a job reaches terminal `failed`. */
  onPermanentFailure?: (info: JobPermanentFailure) => void;
  /** Fired after enqueue and when a claimed job settles (success/fail/retry). */
  onActivity?: () => void;
}

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_TIMEOUT_MS = 60_000;
/** Idle heartbeat for delayed jobs; enqueue wakes immediately. */
const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_MAX_ATTEMPTS = 3;

export async function createJobQueue(
  options: CreateJobQueueOptions,
): Promise<JobQueue> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => crypto.randomUUID());
  const { registry } = options;

  if (concurrency < 1) {
    throw new Error("job queue concurrency must be >= 1");
  }
  if (timeoutMs < 1) {
    throw new Error("job queue timeoutMs must be >= 1");
  }

  const sql = await NodeSqliteExecutor.open(options.dbPath);
  try {
    await runJobsMigrations(sql);
  } catch (err) {
    console.error(
      "[job-queue] runJobsMigrations failed; closing SQLite executor",
      { dbPath: options.dbPath, err },
    );
    await sql.close();
    throw err instanceof Error ? err : new Error(String(err));
  }
  const store = createJobStore(sql);
  const runner = createJobRunner({
    store,
    registry,
    concurrency,
    timeoutMs,
    pollIntervalMs,
    now,
    onPermanentFailure: options.onPermanentFailure,
    onActivity: options.onActivity,
  });

  return {
    async enqueue(input) {
      if (!input.type) {
        throw new Error("job enqueue requires a non-empty type");
      }
      registry.assertReady(input.type);
      const payload = registry.parsePayload(input.type, input.payload ?? {});

      const delayMs = input.delayMs ?? 0;
      if (delayMs < 0) {
        throw new Error("job enqueue delayMs must be >= 0");
      }
      const typeMaxAttempts = registry.requireEntry(input.type).type.maxAttempts;
      const maxAttempts =
        input.maxAttempts ?? typeMaxAttempts ?? DEFAULT_MAX_ATTEMPTS;
      if (maxAttempts < 1) {
        throw new Error("job enqueue maxAttempts must be >= 1");
      }
      if (isVaultMutatingBulkJobType(input.type)) {
        if (input.priority !== JOB_PRIORITY_BULK) {
          throw new Error(
            `job type ${input.type} requires priority JOB_PRIORITY_BULK (${JOB_PRIORITY_BULK}); got ${String(input.priority)}`,
          );
        }
      }
      const nowIso = now().toISOString();
      const availableAt = new Date(now().getTime() + delayMs).toISOString();
      const payloadJson = JSON.stringify(payload);
      const priority = input.priority ?? 0;
      const idempotencyKey = input.idempotencyKey ?? null;

      if (idempotencyKey) {
        const existing =
          await store.findActiveByIdempotencyKey(idempotencyKey);
        if (existing) {
          return { id: existing.id, deduped: true };
        }
      }

      const id = createId();
      try {
        await store.insertJob({
          id,
          type: input.type,
          payloadJson,
          priority,
          idempotencyKey,
          maxAttempts,
          availableAt,
          createdAt: nowIso,
        });
      } catch (err) {
        if (idempotencyKey) {
          const existing =
            await store.findActiveByIdempotencyKey(idempotencyKey);
          if (existing) {
            return { id: existing.id, deduped: true };
          }
        }
        throw err instanceof Error ? err : new Error(String(err));
      }
      runner.wake();
      options.onActivity?.();
      return { id, deduped: false };
    },

    cancel(id) {
      return store.cancelPending(id, now().toISOString());
    },

    cancelPendingByIdempotencyKeyPrefix(prefix) {
      return store.cancelPendingByIdempotencyKeyPrefix(
        prefix,
        now().toISOString(),
      );
    },

    getJob(id) {
      return store.getJob(id);
    },

    findByIdempotencyKey(key) {
      return store.findByIdempotencyKey(key);
    },

    findLatestByIdempotencyKeyPrefix(prefix) {
      return store.findLatestByIdempotencyKeyPrefix(prefix);
    },

    stats() {
      return store.stats();
    },

    start() {
      registry.assertAllRegistered();
      runner.start();
    },

    async stop() {
      await runner.stop();
      await sql.close();
    },
  };
}

/** Built-in handler for host wiring / smoke (#628 / #629). Payload already validated. */
export const testNoopHandler: TypedJobHandler<
  typeof testNoopJobType.payload
> = async (job) => {
  const payload: TestNoopJobPayload = job.payload;
  if (payload.fail === "permanent") {
    return { status: "fail", retryable: false, error: "noop permanent fail" };
  }
  if (payload.fail === "retryable") {
    return {
      status: "fail",
      retryable: true,
      error: "noop retryable fail",
      retryAfterMs: payload.retryAfterMs,
    };
  }
  return { status: "ok" };
};

/** Production/smoke registry: `JOB_TYPE_CATALOG` + built-in handlers. */
export function createHostJobRegistry(): JobRegistry {
  const registry = createJobRegistry(JOB_TYPE_CATALOG);
  registry.register(testNoopJobType, testNoopHandler);
  // Phase B: real handlers late-bound via phaseBHandlerBindings (#627).
  registry.register(vaultIndexSyncJobType, boundPhaseBHandler("vaultIndexSync"));
  registry.register(
    reindexVaultBatchJobType,
    boundPhaseBHandler("reindexVaultBatch"),
  );
  registry.register(
    itemDerivedRefreshJobType,
    boundPhaseBHandler("itemDerivedRefresh"),
  );
  registry.register(
    itemExtractAutoJobType,
    boundPhaseBHandler("itemExtractAuto"),
  );
  registry.register(
    refreshEmbeddingsJobType,
    boundPhaseBHandler("refreshEmbeddings"),
  );
  registry.register(syncPluginPullJobType, boundPhaseBHandler("syncPluginPull"));
  registry.register(generateCoverJobType, boundPhaseBHandler("generateCover"));
  registry.register(
    dropImportBatchJobType,
    boundPhaseBHandler("dropImportBatch"),
  );
  registry.register(importFolderJobType, boundPhaseBHandler("importFolder"));
  registry.register(tagCatalogPruneJobType, boundPhaseBHandler("tagCatalogPrune"));
  return registry;
}
