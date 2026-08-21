/**
 * Periodic embedding reconcile / catch-up (#742).
 *
 * Backstop for write-path refreshEmbeddings gaps: find items missing a vector
 * (or stale model_id) with enough buildEmbedText signal, then enqueue the same
 * refreshEmbeddings path as post-save.
 *
 * Defaults (documented here next to the scheduler):
 * - interval: 3 minutes
 * - batchSize: 50 enqueue inputs per tick
 * - scanLimit: 200 missing/stale candidates scanned per tick
 */

import type { SqlExecutor, SqlReader } from "@collector/db";
import {
  planEmbeddingReconcileTick,
  type EmbeddingReconcileTickOptions,
  type EmbeddingReconcileTickResult,
  type ItemEmbeddingRefreshInput,
} from "@collector/core";

/** Default reconcile wake interval: 3 minutes (#742). */
export const DEFAULT_EMBEDDING_RECONCILE_INTERVAL_MS = 180_000;

/** Max refreshEmbeddings inputs enqueued per tick (#742). */
export const DEFAULT_EMBEDDING_RECONCILE_BATCH_SIZE = 50;

/** Max missing/stale candidates scanned per tick (#742). */
export const DEFAULT_EMBEDDING_RECONCILE_SCAN_LIMIT = 200;

export type EmbeddingReconcileTickLog = {
  vaultId: string;
  scanned: number;
  enqueued: number;
  skippedNoSignal: number;
  deferred: number;
  batchFull: boolean;
  errors: number;
};

type SqlDb = SqlExecutor & SqlReader;

export interface EmbeddingReconcileSchedulerDeps {
  isHealthy: () => boolean;
  resolveActiveVaultId: () => string | null;
  getDb: () => SqlDb;
  getModelId: () => string;
  /** Same path as write-path flushEmbeddingRefresh → enqueueRefreshEmbeddings. */
  enqueueRefresh: (
    vaultId: string,
    inputs: ItemEmbeddingRefreshInput[],
  ) => Promise<void>;
  intervalMs?: number;
  batchSize?: number;
  scanLimit?: number;
  planTick?: (
    db: SqlDb,
    options: EmbeddingReconcileTickOptions,
  ) => Promise<EmbeddingReconcileTickResult>;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  logTick?: (log: EmbeddingReconcileTickLog) => void;
  onTickError?: (error: unknown) => void;
}

export interface EmbeddingReconcileScheduler {
  start(): void;
  dispose(): void;
  /**
   * Schedule a tick soon. No-op until `start()` (timer armed) or after dispose.
   * Host calls this on vault-ready so the first useful catch-up is not delayed
   * by a full interval after boot (`open` runs before ensureActiveVault).
   */
  wake(): void;
  /** Exposed for tests / manual wake. */
  runTick(): Promise<EmbeddingReconcileTickLog | null>;
}

function requirePositive(name: string, value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`embedding-reconcile: invalid ${name}`);
  }
  return value;
}

export function createEmbeddingReconcileScheduler(
  deps: EmbeddingReconcileSchedulerDeps,
): EmbeddingReconcileScheduler {
  const intervalMs = requirePositive(
    "intervalMs",
    deps.intervalMs ?? DEFAULT_EMBEDDING_RECONCILE_INTERVAL_MS,
  );
  const batchSize = requirePositive(
    "batchSize",
    deps.batchSize ?? DEFAULT_EMBEDDING_RECONCILE_BATCH_SIZE,
  );
  const scanLimit = requirePositive(
    "scanLimit",
    deps.scanLimit ?? DEFAULT_EMBEDDING_RECONCILE_SCAN_LIMIT,
  );
  const planTick = deps.planTick ?? planEmbeddingReconcileTick;
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;

  let disposed = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let tickInFlight = false;
  /** Keyset cursor: advance past consumed ids so permanent fails cannot HOL-block. */
  let scanAfterItemId: string | undefined;

  const logTick =
    deps.logTick ??
    ((log: EmbeddingReconcileTickLog) => {
      if (log.errors > 0) {
        console.error("[collector] embedding reconcile tick", log);
      } else {
        console.info("[collector] embedding reconcile tick", log);
      }
    });

  const onTickError =
    deps.onTickError ??
    ((error: unknown) => {
      console.error("[collector] embedding reconcile tick failed", error);
    });

  async function planWithWrap(
    vaultId: string,
  ): Promise<EmbeddingReconcileTickResult> {
    const baseOptions: EmbeddingReconcileTickOptions = {
      vaultId,
      modelId: deps.getModelId(),
      batchSize,
      scanLimit,
    };
    if (scanAfterItemId !== undefined) {
      baseOptions.afterItemId = scanAfterItemId;
    }

    let planned = await planTick(deps.getDb(), baseOptions);
    if (
      planned.inputs.length === 0 &&
      planned.stats.scanned === 0 &&
      scanAfterItemId !== undefined
    ) {
      // Past end of keyset — wrap to the start once this tick.
      scanAfterItemId = undefined;
      planned = await planTick(deps.getDb(), {
        vaultId,
        modelId: deps.getModelId(),
        batchSize,
        scanLimit,
      });
    }
    return planned;
  }

  async function runTick(): Promise<EmbeddingReconcileTickLog | null> {
    if (disposed || !deps.isHealthy()) {
      return null;
    }
    const vaultId = deps.resolveActiveVaultId();
    if (vaultId === null || !vaultId.trim()) {
      return null;
    }

    const planned = await planWithWrap(vaultId);

    let enqueued = 0;
    let errors = 0;
    // Per-item enqueue so idempotency keys match write-path single-item jobs.
    // Per-item catch continues the bulk backstop; failures stay error-severity
    // via structured per-item logs and error-level tick summary when errors > 0.
    for (const input of planned.inputs) {
      try {
        await deps.enqueueRefresh(vaultId, [input]);
        enqueued += 1;
      } catch (error) {
        errors += 1;
        console.error("[collector] embedding reconcile enqueue failed", {
          vaultId,
          itemId: input.itemId,
          error,
        });
      }
    }

    // Advance past consumed ids (including enqueue failures) so permanently
    // broken head items do not monopolize every subsequent tick.
    scanAfterItemId =
      planned.nextAfterItemId === null
        ? undefined
        : planned.nextAfterItemId;

    const log: EmbeddingReconcileTickLog = {
      vaultId,
      scanned: planned.stats.scanned,
      enqueued,
      skippedNoSignal: planned.stats.skippedNoSignal,
      deferred: planned.stats.deferred,
      batchFull: planned.stats.batchFull,
      errors,
    };
    logTick(log);
    return log;
  }

  const wake = (): void => {
    if (disposed || tickInFlight) {
      return;
    }
    tickInFlight = true;
    void (async () => {
      try {
        await runTick();
      } catch (error) {
        onTickError(error);
      } finally {
        tickInFlight = false;
      }
    })();
  };

  function publicWake(): void {
    if (disposed || timer === null) {
      return;
    }
    wake();
  }

  return {
    start() {
      if (disposed) {
        throw new Error("embedding-reconcile: disposed");
      }
      if (timer !== null) {
        return;
      }
      timer = setIntervalFn(wake, intervalMs);
      // Immediate first tick so catch-up does not wait a full interval.
      wake();
    },
    dispose() {
      disposed = true;
      if (timer !== null) {
        clearIntervalFn(timer);
        timer = null;
      }
    },
    wake: publicWake,
    runTick,
  };
}
