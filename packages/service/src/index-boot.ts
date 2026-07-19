/**
 * In-process index DB boot: open + migrate, then health/rebuild (#146).
 * Adapters (SQL open, env prepare, rebuild side-effects) are injected — no Tauri here.
 */

import {
  ensureHealthyIndex,
  resetIndexSchema,
  runMigrations,
  type SqlMigrator,
} from "@collector/db";
import { createTwoPhaseBootGate, type TwoPhaseBootGate } from "@collector/core";

export interface ClosableSqlExecutor extends SqlMigrator {
  close(): Promise<void>;
}

export interface CollectorIndexBootDeps<TSql extends ClosableSqlExecutor> {
  /** Data dir / legacy cleanup before opening SQL. */
  prepareEnvironment: () => Promise<void>;
  openSql: () => Promise<TSql>;
  /**
   * Before reset+migrate on unhealthy index (clear vault sync caches, stop watcher,
   * UI rebuilding status, clear dashboard snapshot, etc.).
   */
  onUnhealthyRebuildStart?: () => Promise<void> | void;
  /** After rebuild attempt finishes (success or throw) — e.g. clear rebuilding status. */
  onUnhealthyRebuildFinally?: () => void;
}

export interface CollectorIndexBoot<TSql extends ClosableSqlExecutor> {
  open: () => Promise<void>;
  ensureHealthy: () => Promise<void>;
  isOpen: () => boolean;
  isHealthy: () => boolean;
  getSql: () => TSql | null;
  requireSql: () => TSql;
  /** Reset schema + migrate on the open session (caller must already hold sql). */
  rebuildSchema: () => Promise<void>;
}

export function createCollectorIndexBoot<TSql extends ClosableSqlExecutor>(
  deps: CollectorIndexBootDeps<TSql>,
): CollectorIndexBoot<TSql> {
  let sql: TSql | null = null;

  const rebuildSchema = async (): Promise<void> => {
    if (!sql) {
      throw new Error("Collector database is not initialized");
    }
    await resetIndexSchema(sql);
    await runMigrations(sql);
  };

  const openInternal = async (): Promise<void> => {
    let opened: TSql | null = null;
    try {
      await deps.prepareEnvironment();
      opened = await deps.openSql();
      sql = opened;
      await runMigrations(sql);
    } catch (err) {
      if (opened) {
        await opened.close().catch(() => {});
        sql = null;
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  };

  const runHealthChecks = async (): Promise<void> => {
    if (!sql) {
      throw new Error("Collector database is not initialized");
    }

    let health = await ensureHealthyIndex(sql);
    if (health.ok) {
      return;
    }

    console.warn(
      "[collector] SQLite index unhealthy, rebuilding from vault files:",
      health.errors,
    );

    try {
      await deps.onUnhealthyRebuildStart?.();
      await rebuildSchema();

      if (!sql) {
        throw new Error("Collector database rebuild failed to reopen");
      }

      health = await ensureHealthyIndex(sql);
      if (!health.ok) {
        throw new Error(
          `Index database failed startup checks: ${health.errors.join("; ")}`,
        );
      }
    } finally {
      deps.onUnhealthyRebuildFinally?.();
    }
  };

  const gate: TwoPhaseBootGate = createTwoPhaseBootGate({
    open: openInternal,
    health: runHealthChecks,
  });

  return {
    open: () => gate.open(),
    ensureHealthy: () => gate.ensureHealthy(),
    isOpen: () => gate.isOpen(),
    isHealthy: () => gate.isHealthy(),
    getSql: () => sql,
    requireSql: () => {
      if (!sql) {
        throw new Error("Collector database is not initialized");
      }
      return sql;
    },
    rebuildSchema,
  };
}
