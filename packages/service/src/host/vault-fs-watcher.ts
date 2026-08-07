/**
 * Node filesystem watcher for out-of-band service host (#164 / #567).
 * Drives targeted index updates in the host process (not the UI).
 */

import { watch, type FSWatcher } from "node:fs";
import {
  createVaultWatchBatcher,
  reconcileIndexFolderPrefixFromFilesystem,
  resolveVaultWatchTarget,
  syncIndexItemsFromFilesystem,
  type VaultContext,
} from "@collector/core";

const VAULT_WATCH_DEBOUNCE_MS = 300;

export interface NodeVaultFilesystemWatcherDeps {
  getContext: () => VaultContext;
  getActiveVaultId: () => string | null;
  onItemsSynced: (vaultId: string) => void;
  forceVaultIndexResync: (vaultId: string, vaultPath: string) => void;
  /** Fired after a successful targeted watch apply (non-blocking hooks). */
  onWatchApplied?: (vaultId: string, vaultPath: string) => void;
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
  const pendingWatchFolderPaths = new Set<string>();
  let watchApplyPromise: Promise<void> | null = null;

  function throwIfSyncErrors(
    report: { errors: Array<{ message: string }> },
    label: string,
  ): void {
    if (report.errors.length === 0) {
      return;
    }
    const summary = report.errors.map((entry) => entry.message).join("; ");
    throw new Error(`${label}: ${summary}`);
  }

  async function drainWatchQueue(
    vaultId: string,
    vaultPath: string,
  ): Promise<void> {
    while (pendingWatchItemIds.size > 0 || pendingWatchFolderPaths.size > 0) {
      const itemIds = [...pendingWatchItemIds];
      const folderPaths = [...pendingWatchFolderPaths];
      pendingWatchItemIds.clear();
      pendingWatchFolderPaths.clear();

      for (const folderPath of folderPaths) {
        const report = await reconcileIndexFolderPrefixFromFilesystem(
          deps.getContext(),
          vaultPath,
          vaultId,
          folderPath,
        );
        throwIfSyncErrors(report, "folder prefix index sync failed");
      }

      if (itemIds.length > 0) {
        const report = await syncIndexItemsFromFilesystem(
          deps.getContext(),
          vaultPath,
          vaultId,
          itemIds,
        );
        throwIfSyncErrors(report, "targeted index sync failed");
      }

      deps.onItemsSynced(vaultId);
      deps.onWatchApplied?.(vaultId, vaultPath);
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
        if (pendingWatchItemIds.size > 0 || pendingWatchFolderPaths.size > 0) {
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
    pendingWatchFolderPaths.clear();
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
      onFlush: (batch) => {
        if (deps.getActiveVaultId() !== vaultId) {
          return;
        }
        for (const itemId of batch.itemIds) {
          pendingWatchItemIds.add(itemId);
        }
        for (const folderPath of batch.folderPaths) {
          pendingWatchFolderPaths.add(folderPath);
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
        void resolveVaultWatchTarget(deps.getContext().fs, vaultPath, changedPath).then(
          (target) => {
            if (!target) {
              return;
            }
            if (deps.getActiveVaultId() !== vaultId) {
              return;
            }
            if (target.kind === "item") {
              batcher.enqueueItem(target.itemId);
              return;
            }
            batcher.enqueueFolder(target.folderPath);
          },
        );
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
