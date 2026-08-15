/**
 * Vault index sync orchestration for the service domain runtime (#328, #419).
 *
 * Owns listener maps, kickoff/force resync, filesystem sync progress, and
 * watch-item sync notifications. Shared mutable state is passed in as deps.
 */

import {
  syncVaultIndexFromFilesystem,
  type IndexSyncProgress,
} from "@collector/core";
import type { VaultIndexSyncStatusStore } from "../sync-status.js";
import type { JobQueue } from "../jobs/job-queue.js";
import {
  reportEnqueueFailure,
  type JobPermanentFailureStore,
} from "../job-permanent-failure.js";
import { enqueueVaultIndexSync } from "../jobs/handlers/vault-index-sync.js";
import {
  createThrottledPublisher,
  SYNC_STATUS_THROTTLE_MS,
} from "./domain-runtime-throttled-publisher.js";

export type VaultSyncListener = {
  onBatch?: (p: IndexSyncProgress) => void;
  onComplete?: () => void;
};

export type VaultIndexSyncControllerDeps = {
  syncedVaultIds: Set<string>;
  vaultSyncPromises: Map<string, Promise<void>>;
  vaultSyncListeners: Map<string, Set<VaultSyncListener>>;
  vaultIndexSyncStatus: VaultIndexSyncStatusStore;
  watcherDisabledVaultIds: Set<string>;
  isRuntimeClosed: () => boolean;
  getContext: () => Parameters<typeof syncVaultIndexFromFilesystem>[0];
  vaultFsWatcher: {
    start: (vaultId: string, vaultPath: string) => Promise<void>;
    isWatching: () => boolean;
  };
  requireJobs: () => JobQueue;
  jobPermanentFailure: JobPermanentFailureStore;
  scheduleVaultLayoutGuard: (vaultId: string, vaultPath: string) => void;
};

export function createVaultIndexSyncController(
  deps: VaultIndexSyncControllerDeps,
) {
  const {
    syncedVaultIds,
    vaultSyncPromises,
    vaultSyncListeners,
    vaultIndexSyncStatus,
    watcherDisabledVaultIds,
    isRuntimeClosed,
    getContext,
    vaultFsWatcher,
    requireJobs,
    jobPermanentFailure,
    scheduleVaultLayoutGuard,
  } = deps;

  function addVaultSyncListener(
    vaultId: string,
    listener: VaultSyncListener,
  ): () => void {
    let set = vaultSyncListeners.get(vaultId);
    if (!set) {
      set = new Set();
      vaultSyncListeners.set(vaultId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) {
        vaultSyncListeners.delete(vaultId);
      }
    };
  }

  function emitComplete(vaultId: string): void {
    const set = vaultSyncListeners.get(vaultId);
    if (!set) return;
    for (const listener of set) {
      listener.onComplete?.();
    }
  }

  function notifyWatchItemsSynced(vaultId: string): void {
    const previous = vaultIndexSyncStatus.get();
    vaultIndexSyncStatus.set({
      vaultId,
      status: "running",
      progress: previous.progress,
      metadataReady: true,
      ftsReady: previous.ftsReady || previous.status === "done",
    });
    emitComplete(vaultId);
    setTimeout(() => {
      vaultIndexSyncStatus.set({
        vaultId,
        status: "done",
        progress: previous.progress,
        metadataReady: true,
        ftsReady: true,
      });
    }, 0);
  }

  async function startVaultIndexSync(
    vaultId: string,
    vaultPath: string,
  ): Promise<void> {
    if (syncedVaultIds.has(vaultId)) {
      if (
        !isRuntimeClosed() &&
        !watcherDisabledVaultIds.has(vaultId) &&
        !vaultFsWatcher.isWatching()
      ) {
        void vaultFsWatcher.start(vaultId, vaultPath).catch((error: unknown) => {
          console.error("[collector] start vault filesystem watcher:", error);
        });
      }
      return;
    }
    const inflight = vaultSyncPromises.get(vaultId);
    if (inflight) {
      return inflight;
    }

    let metadataReady = true;
    let ftsReady = false;

    vaultIndexSyncStatus.set({
      vaultId,
      status: "running",
      progress: {
        phase: "metadata",
        processed: 0,
        total: 0,
        skipped: 0,
        patched: 0,
        indexed: 0,
        contentIndexed: 0,
        removed: 0,
      },
      metadataReady,
      ftsReady,
    });

    let latestProgress: IndexSyncProgress = {
      phase: "metadata",
      processed: 0,
      total: 0,
      skipped: 0,
      patched: 0,
      indexed: 0,
      contentIndexed: 0,
      removed: 0,
    };

    const publishRunningStatus = createThrottledPublisher(() => {
      vaultIndexSyncStatus.set({
        vaultId,
        status: "running",
        progress: latestProgress,
        metadataReady,
        ftsReady,
      });
    }, SYNC_STATUS_THROTTLE_MS);

    const noteProgress = (progress: IndexSyncProgress) => {
      latestProgress = progress;
      if (
        metadataReady &&
        progress.phase === "metadata" &&
        progress.processed < progress.total
      ) {
        metadataReady = false;
        publishRunningStatus.flush();
        return;
      }
      publishRunningStatus.schedule();
    };

    const promise = (async () => {
      try {
        const report = await syncVaultIndexFromFilesystem(
          getContext(),
          vaultPath,
          {
            onProgress: (progress) => {
              noteProgress(progress);
            },
            onBatch: (progress) => {
              noteProgress(progress);
              const set = vaultSyncListeners.get(vaultId);
              if (set) {
                for (const listener of set) {
                  listener.onBatch?.(progress);
                }
              }
            },
            onMetadataComplete: (progress) => {
              latestProgress = progress;
              metadataReady = true;
              publishRunningStatus.flush();
            },
          },
        );
        if (report.vaultId !== vaultId) {
          throw new Error(
            `Vault id mismatch during index sync: expected ${vaultId}, got ${report.vaultId}`,
          );
        }
        syncedVaultIds.add(vaultId);
        metadataReady = true;
        ftsReady = true;
        const finalProgress: IndexSyncProgress = {
          phase: "content",
          processed: report.indexed + report.patched + report.skipped,
          total: report.indexed + report.patched + report.skipped,
          skipped: report.skipped,
          patched: report.patched,
          indexed: report.indexed,
          contentIndexed: report.contentIndexed,
          removed: report.removed,
        };
        publishRunningStatus.cancel();
        vaultIndexSyncStatus.set({
          vaultId,
          status: "done",
          progress: finalProgress,
          metadataReady,
          ftsReady,
        });
        emitComplete(vaultId);
        if (!isRuntimeClosed() && !watcherDisabledVaultIds.has(vaultId)) {
          void vaultFsWatcher.start(vaultId, vaultPath).catch((error: unknown) => {
            console.error("[collector] start vault filesystem watcher:", error);
          });
        }
      } catch (error) {
        publishRunningStatus.cancel();
        vaultIndexSyncStatus.set({
          vaultId,
          status: "idle",
          progress: null,
          metadataReady: false,
          ftsReady: false,
        });
        throw error;
      }
    })().finally(() => {
      vaultSyncPromises.delete(vaultId);
    });
    vaultSyncPromises.set(vaultId, promise);
    return promise;
  }

  function kickoffVaultIndexSync(
    vaultId: string,
    vaultPath: string,
    reason: "kickoff" | "force" | "recovery" = "kickoff",
  ): void {
    scheduleVaultLayoutGuard(vaultId, vaultPath);
    void enqueueVaultIndexSync(requireJobs(), {
      vaultId,
      vaultPath,
      reason,
    }).catch((error: unknown) => {
      reportEnqueueFailure(jobPermanentFailure, "vaultIndexSync", error);
    });
  }

  function forceVaultIndexResync(
    vaultId: string,
    vaultPath: string,
    options: { restartWatcher?: boolean } = {},
  ): void {
    if (options.restartWatcher === false) {
      watcherDisabledVaultIds.add(vaultId);
    }
    syncedVaultIds.delete(vaultId);
    kickoffVaultIndexSync(vaultId, vaultPath, "force");
  }

  function isVaultFtsReady(vaultId: string): boolean {
    return syncedVaultIds.has(vaultId);
  }

  return {
    addVaultSyncListener,
    notifyWatchItemsSynced,
    startVaultIndexSync,
    kickoffVaultIndexSync,
    forceVaultIndexResync,
    isVaultFtsReady,
  };
}

export type VaultIndexSyncController = ReturnType<
  typeof createVaultIndexSyncController
>;
