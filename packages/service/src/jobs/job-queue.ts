import {
  JOB_TYPE_CATALOG,
  testNoopJobType,
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
import { createJobStore, type JobStats } from "./job-store.js";

export type {
  JobHandler,
  JobHandlerInput,
  JobHandlerResult,
} from "./job-types.js";
export type { JobStats };
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

  const sql = NodeSqliteExecutor.open(options.dbPath);
  await runJobsMigrations(sql);
  const store = createJobStore(sql);
  const runner = createJobRunner({
    store,
    registry,
    concurrency,
    timeoutMs,
    pollIntervalMs,
    now,
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
      const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
      if (maxAttempts < 1) {
        throw new Error("job enqueue maxAttempts must be >= 1");
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
      return { id, deduped: false };
    },

    cancel(id) {
      return store.cancelPending(id, now().toISOString());
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
  return registry;
}
