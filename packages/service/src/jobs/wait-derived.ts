/**
 * Opt-in await of per-item derived completion for scripts/agents (#770).
 *
 * Default mutate remains fire-and-forget. Ordinary UI save must not call this.
 * Built on {@link waitForJobTerminal} + idempotency-key lookup of
 * `itemDerivedRefresh` jobs (#766 seam).
 */

import {
  itemDerivedRefreshIdempotencyKey,
  itemDerivedRefreshIdempotencyKeyPrefix,
  itemDerivedRefreshJobType,
} from "@collector/shared";
import type { JobQueue } from "./job-queue.js";
import type { JobRow } from "./job-store.js";
import {
  waitForJobTerminal,
  type TerminalJobStatus,
} from "./job-wait.js";

export type WaitDerivedResult = {
  status: TerminalJobStatus;
  jobId: string;
  contentRevision: number;
};

export type WaitDerivedQueue = Pick<
  JobQueue,
  "getJob" | "findByIdempotencyKey" | "findLatestByIdempotencyKeyPrefix"
>;

const DEFAULT_TIMEOUT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findDerivedJobRow(
  queue: WaitDerivedQueue,
  vaultId: string,
  itemId: string,
  contentRevision: number,
  fileMtimeMs?: number,
): Promise<JobRow | null> {
  if (fileMtimeMs !== undefined) {
    return queue.findByIdempotencyKey(
      itemDerivedRefreshIdempotencyKey({
        vaultId,
        itemId,
        contentRevision,
        fileMtimeMs,
      }),
    );
  }
  return queue.findLatestByIdempotencyKeyPrefix(
    itemDerivedRefreshIdempotencyKeyPrefix({
      vaultId,
      itemId,
      contentRevision,
    }),
  );
}

/**
 * Wait until the `itemDerivedRefresh` job for (vaultId, itemId, revision)
 * reaches a terminal status. Polls for job appearance first (enqueue may lag
 * slightly behind the mutate RPC return), then reuses {@link waitForJobTerminal}.
 *
 * When `fileMtimeMs` is omitted, matches any enqueue snapshot for that revision
 * via idempotency-key prefix (successive writes share revision but not mtime).
 */
export async function waitDerived(options: {
  queue: WaitDerivedQueue;
  vaultId: string;
  itemId: string;
  contentRevision: number;
  fileMtimeMs?: number;
  timeoutMs?: number;
}): Promise<WaitDerivedResult> {
  const itemId = options.itemId.trim();
  if (!itemId) {
    throw new Error("waitDerived requires a non-empty itemId");
  }
  if (!Number.isInteger(options.contentRevision)) {
    throw new Error(
      `waitDerived requires integer contentRevision; got ${String(options.contentRevision)}`,
    );
  }
  if (
    options.fileMtimeMs !== undefined &&
    !Number.isFinite(options.fileMtimeMs)
  ) {
    throw new Error(
      `waitDerived fileMtimeMs must be a finite number; got ${String(options.fileMtimeMs)}`,
    );
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (timeoutMs < 1) {
    throw new Error(`waitDerived timeoutMs must be >= 1; got ${timeoutMs}`);
  }

  const startedAt = Date.now();
  let delayMs = 25;
  let row: JobRow | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    row = await findDerivedJobRow(
      options.queue,
      options.vaultId,
      itemId,
      options.contentRevision,
      options.fileMtimeMs,
    );
    if (row) {
      break;
    }
    await sleep(delayMs);
    delayMs = Math.min(delayMs * 2, 500);
  }

  if (!row) {
    const keyHint =
      options.fileMtimeMs !== undefined
        ? itemDerivedRefreshIdempotencyKey({
            vaultId: options.vaultId,
            itemId,
            contentRevision: options.contentRevision,
            fileMtimeMs: options.fileMtimeMs,
          })
        : itemDerivedRefreshIdempotencyKeyPrefix({
            vaultId: options.vaultId,
            itemId,
            contentRevision: options.contentRevision,
          });
    throw new Error(
      `waitDerived timed out waiting for ${itemDerivedRefreshJobType.id} job (${keyHint})`,
    );
  }

  if (row.type !== itemDerivedRefreshJobType.id) {
    throw new Error(
      `waitDerived expected job type ${itemDerivedRefreshJobType.id}; got ${row.type}`,
    );
  }

  const remainingMs = timeoutMs - (Date.now() - startedAt);
  if (remainingMs < 1) {
    throw new Error(`waitDerived timed out before awaiting job ${row.id}`);
  }

  const status = await waitForJobTerminal(
    options.queue,
    row.id,
    remainingMs,
  );
  return {
    status,
    jobId: row.id,
    contentRevision: options.contentRevision,
  };
}
