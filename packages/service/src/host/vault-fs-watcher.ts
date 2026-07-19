/**
 * Node filesystem watcher for out-of-band service host (#164).
 * Drives targeted index updates in the host process (not the UI).
 */

import { existsSync, watch, type FSWatcher } from "node:fs";
import {
  createVaultWatchBatcher,
  parseVaultItemWatchPath,
  syncIndexItemsFromFilesystem,
  type VaultContext,
} from "@collector/core";

const VAULT_WATCH_DEBOUNCE_MS = 300;

export interface NodeVaultFilesystemWatcherDeps {
  getContext: () => VaultContext;
  getActiveVaultId: () => string | null;
  onItemsSynced: (vaultId: string) => void;
  forceVaultIndexResync: (vaultId: string, vaultPath: string) => void;
}

export interface NodeVaultFilesystemWatcher {
  start: (vaultId: string, vaultPath: string) => Promise<void>;
  stop: () => Promise<void>;
  isWatching: () => boolean;
}

export function createNodeVaultFilesystemWatcher(
  deps: NodeVaultFilesystemWatcherDeps,
): NodeVaultFilesystemWatcher {
  let active: {
    vaultId: string;
    vaultPath: string;
    batcher: ReturnType<typeof createVaultWatchBatcher>;
    watcher: FSWatcher;
  } | null = null;
  const pendingWatchItemIds = new Set<string>();
  let watchApplyPromise: Promise<void> | null = null;

  async function drainWatchQueue(
    vaultId: string,
    vaultPath: string,
  ): Promise<void> {
    while (pendingWatchItemIds.size > 0) {
      const itemIds = [...pendingWatchItemIds];
      pendingWatchItemIds.clear();
      const report = await syncIndexItemsFromFilesystem(
        deps.getContext(),
        vaultPath,
        vaultId,
        itemIds,
      );
      if (report.errors.length > 0) {
        const summary = report.errors
          .map((entry: { message: string }) => entry.message)
          .join("; ");
        throw new Error(`targeted index sync failed: ${summary}`);
      }
      deps.onItemsSynced(vaultId);
    }
  }

  function scheduleWatchApply(vaultId: string, vaultPath: string): void {
    if (watchApplyPromise) {
      return;
    }
    watchApplyPromise = drainWatchQueue(vaultId, vaultPath)
      .catch((error: unknown) => {
        console.error("[collector] vault watch index sync failed:", error);
        deps.forceVaultIndexResync(vaultId, vaultPath);
      })
      .finally(() => {
        watchApplyPromise = null;
        if (pendingWatchItemIds.size > 0) {
          scheduleWatchApply(vaultId, vaultPath);
        }
      });
  }

  async function stop(): Promise<void> {
    if (!active) {
      return;
    }
    const { batcher, watcher } = active;
    active = null;
    pendingWatchItemIds.clear();
    batcher.dispose();
    watcher.close();
  }

  async function start(vaultId: string, vaultPath: string): Promise<void> {
    await stop();

    const { existsSync } = await import("node:fs");
    if (!existsSync(vaultPath)) {
      throw new Error(`vault path does not exist for watcher: ${vaultPath}`);
    }

    const batcher = createVaultWatchBatcher({
      debounceMs: VAULT_WATCH_DEBOUNCE_MS,
      onFlush: (itemIds: string[]) => {
        if (deps.getActiveVaultId() !== vaultId) {
          return;
        }
        for (const itemId of itemIds) {
          pendingWatchItemIds.add(itemId);
        }
        scheduleWatchApply(vaultId, vaultPath);
      },
    });

    const watcher = watch(
      vaultPath,
      { recursive: true },
      (_eventType, filename) => {
        if (!filename) {
          return;
        }
        if (deps.getActiveVaultId() !== vaultId) {
          return;
        }
        const changedPath = `${vaultPath.replace(/\/+$/, "")}/${String(filename).replace(/\\/g, "/")}`;
        const itemId = parseVaultItemWatchPath(vaultPath, changedPath);
        if (!itemId) {
          return;
        }
        batcher.enqueue(itemId);
      },
    );

    watcher.on("error", (error) => {
      console.error("[collector] vault filesystem watcher error:", error);
      void stop().then(() => {
        deps.forceVaultIndexResync(vaultId, vaultPath);
      });
    });

    active = { vaultId, vaultPath, batcher, watcher };
  }

  return {
    start,
    stop,
    isWatching: () => active !== null,
  };
}
