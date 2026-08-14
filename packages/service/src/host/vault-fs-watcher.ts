/**
 * Node filesystem watcher for out-of-band service host (#164 / #567).
 * Debounced batches enqueue durable reindex jobs (#632).
 */

import { watch, type FSWatcher } from "node:fs";
import {
  createVaultWatchBatcher,
  resolveVaultWatchTarget,
  type VaultContext,
} from "@collector/core";
import type { ReindexVaultBatchJobPayload } from "@collector/shared";

const VAULT_WATCH_DEBOUNCE_MS = 300;

export interface NodeVaultFilesystemWatcherDeps {
  getContext: () => VaultContext;
  getActiveVaultId: () => string | null;
  enqueueReindexVaultBatch: (
    payload: ReindexVaultBatchJobPayload,
  ) => Promise<unknown>;
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
  const pendingWatchFolderPaths = new Set<string>();
  let watchEnqueuePromise: Promise<void> | null = null;

  async function drainWatchQueue(
    vaultId: string,
    vaultPath: string,
  ): Promise<void> {
    while (pendingWatchItemIds.size > 0 || pendingWatchFolderPaths.size > 0) {
      const itemIds = [...pendingWatchItemIds];
      const folderPaths = [...pendingWatchFolderPaths];
      pendingWatchItemIds.clear();
      pendingWatchFolderPaths.clear();
      await deps.enqueueReindexVaultBatch({
        vaultId,
        vaultPath,
        itemIds,
        folderPaths,
      });
    }
  }

  function scheduleWatchEnqueue(vaultId: string, vaultPath: string): void {
    if (watchEnqueuePromise) {
      return;
    }
    watchEnqueuePromise = drainWatchQueue(vaultId, vaultPath)
      .catch((error: unknown) => {
        console.error("[collector] vault watch enqueue failed:", error);
        deps.forceVaultIndexResync(vaultId, vaultPath);
      })
      .finally(() => {
        watchEnqueuePromise = null;
        if (pendingWatchItemIds.size > 0 || pendingWatchFolderPaths.size > 0) {
          scheduleWatchEnqueue(vaultId, vaultPath);
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
        scheduleWatchEnqueue(vaultId, vaultPath);
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
