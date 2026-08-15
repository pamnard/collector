import {
  syncVaultIndexFromFilesystem,
  type IndexSyncProgress,
} from "@collector/core";
import type { VaultIndexSyncStatusStore } from "../../sync-status.js";
import type { createVaultLayoutGuardRunner } from "../../vault-layout-guard-runner.js";
import type { createNodeVaultFilesystemWatcher } from "../vault-fs-watcher.js";
import type { JobQueue } from "../../jobs/job-queue.js";
import { reportEnqueueFailure } from "../../job-permanent-failure.js";
import type { createJobPermanentFailureStore } from "../../job-permanent-failure.js";
import { enqueueVaultIndexSync } from "../../jobs/handlers/vault-index-sync.js";
import {
  createThrottledPublisher,
  SYNC_STATUS_THROTTLE_MS,
} from "./throttle.js";

type VaultLayoutGuard = ReturnType<typeof createVaultLayoutGuardRunner>;
type VaultFsWatcher = ReturnType<typeof createNodeVaultFilesystemWatcher>;

export interface VaultSyncControllerDeps {
  getContext: () => import("@collector/core").VaultContext;
  vaultIndexSyncStatus: VaultIndexSyncStatusStore;
  vaultFsWatcher: VaultFsWatcher;
  vaultLayoutGuard: VaultLayoutGuard;
  requireJobs: () => JobQueue;
  jobPermanentFailure: ReturnType<typeof createJobPermanentFailureStore>;
  isRuntimeClosed: () => boolean;
}

export interface VaultSyncController {
  syncedVaultIds: Set<string>;
  watcherDisabledVaultIds: Set<string>;
  vaultSyncPromises: Map<string, Promise<void>>;
  addVaultSyncListener: (
    vaultId: string,
    listener: {
      onBatch?: (p: IndexSyncProgress) => void;
      onComplete?: () => void;
    },
  ) => () => void;
  notifyWatchItemsSynced: (vaultId: string) => void;
  startVaultIndexSync: (vaultId: string, vaultPath: string) => Promise<void>;
  kickoffVaultIndexSync: (
    vaultId: string,
    vaultPath: string,
    reason?: "kickoff" | "force" | "recovery",
  ) => void;
  forceVaultIndexResync: (
    vaultId: string,
    vaultPath: string,
    options?: { restartWatcher?: boolean },
  ) => void;
  resetOnUnhealthyRebuild: () => Promise<void>;
}

export function createVaultSyncController(
  deps: VaultSyncControllerDeps,
): VaultSyncController {
  const syncedVaultIds = new Set<string>();
  const vaultSyncPromises = new Map<string, Promise<void>>();
  const vaultSyncListeners = new Map<
    string,
    Set<{
      onBatch?: (p: IndexSyncProgress) => void;
      onComplete?: () => void;
    }>
  >();
  const watcherDisabledVaultIds = new Set<string>();

  function addVaultSyncListener(
    vaultId: string,
    listener: {
      onBatch?: (p: IndexSyncProgress) => void;
      onComplete?: () => void;
    },
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
    const previous = deps.vaultIndexSyncStatus.get();
    deps.vaultIndexSyncStatus.set({
      vaultId,
      status: "running",
      progress: previous.progress,
      metadataReady: true,
      ftsReady: previous.ftsReady || previous.status === "done",
    });
    emitComplete(vaultId);
    setTimeout(() => {
      deps.vaultIndexSyncStatus.set({
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
        !deps.isRuntimeClosed() &&
        !watcherDisabledVaultIds.has(vaultId) &&
        !deps.vaultFsWatcher.isWatching()
      ) {
        void deps.vaultFsWatcher.start(vaultId, vaultPath).catch((error: unknown) => {
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

    deps.vaultIndexSyncStatus.set({
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
      deps.vaultIndexSyncStatus.set({
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
          deps.getContext(),
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
        deps.vaultIndexSyncStatus.set({
          vaultId,
          status: "done",
          progress: finalProgress,
          metadataReady,
          ftsReady,
        });
        emitComplete(vaultId);
        if (
          !deps.isRuntimeClosed() &&
          !watcherDisabledVaultIds.has(vaultId)
        ) {
          void deps.vaultFsWatcher.start(vaultId, vaultPath).catch((error: unknown) => {
            console.error("[collector] start vault filesystem watcher:", error);
          });
        }
      } catch (error) {
        publishRunningStatus.cancel();
        deps.vaultIndexSyncStatus.set({
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
    deps.vaultLayoutGuard.schedule(vaultId, vaultPath);
    void enqueueVaultIndexSync(deps.requireJobs(), {
      vaultId,
      vaultPath,
      reason,
    }).catch((error: unknown) => {
      reportEnqueueFailure(deps.jobPermanentFailure, "vaultIndexSync", error);
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

  async function resetOnUnhealthyRebuild(): Promise<void> {
    const pending = [...vaultSyncPromises.values()];
    await Promise.allSettled(pending);
    syncedVaultIds.clear();
    vaultSyncPromises.clear();
    vaultSyncListeners.clear();
    watcherDisabledVaultIds.clear();
  }

  return {
    syncedVaultIds,
    watcherDisabledVaultIds,
    vaultSyncPromises,
    addVaultSyncListener,
    notifyWatchItemsSynced,
    startVaultIndexSync,
    kickoffVaultIndexSync,
    forceVaultIndexResync,
    resetOnUnhealthyRebuild,
  };
}
