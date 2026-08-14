import { runJobsMigrations } from "@collector/db";
import { NodeSqliteExecutor } from "../host/node-sql.js";
import { createJobRunner } from "./job-runner.js";
import { createJobStore, type JobStats } from "./job-store.js";
import type { JobHandler, JobHandlers } from "./job-types.js";

export type {
  JobHandler,
  JobHandlerInput,
  JobHandlerResult,
  JobHandlers,
} from "./job-types.js";
export type { JobStats };

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
  handlers: JobHandlers;
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
    handlers: options.handlers,
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
      const nowIso = now().toISOString();
      const delayMs = input.delayMs ?? 0;
      if (delayMs < 0) {
        throw new Error("job enqueue delayMs must be >= 0");
      }
      const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
      if (maxAttempts < 1) {
        throw new Error("job enqueue maxAttempts must be >= 1");
      }
      const availableAt = new Date(now().getTime() + delayMs).toISOString();
      const payloadJson = JSON.stringify(input.payload ?? {});
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
      runner.start();
    },

    async stop() {
      await runner.stop();
      await sql.close();
    },
  };
}

/** Built-in handler for host wiring / smoke (#628). */
export const testNoopHandler: JobHandler = async (job) => {
  const payload = job.payload as {
    fail?: "retryable" | "permanent";
    retryAfterMs?: number;
  };
  if (payload?.fail === "permanent") {
    return { status: "fail", retryable: false, error: "noop permanent fail" };
  }
  if (payload?.fail === "retryable") {
    return {
      status: "fail",
      retryable: true,
      error: "noop retryable fail",
      retryAfterMs: payload.retryAfterMs,
    };
  }
  return { status: "ok" };
};
