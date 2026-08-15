import {
  buildFtsMatchQuery,
  buildMetadataFtsMatchQuery,
  syncVaultIndexFromFilesystem,
  type IndexSyncProgress,
  type VaultContext,
} from "@collector/core";
import {
  reportEnqueueFailure,
  type JobPermanentFailureStore,
} from "../../job-permanent-failure.js";
import { enqueueVaultIndexSync } from "../../jobs/handlers/vault-index-sync.js";
import type { JobQueue } from "../../jobs/job-queue.js";
import type { VaultIndexSyncStatusStore } from "../../sync-status.js";
import type { VaultLayoutGuardRunner } from "../../vault-layout-guard-runner.js";
import type { NodeVaultFilesystemWatcher } from "../vault-fs-watcher.js";
import { createThrottledPublisher } from "./throttled-publisher.js";

const SYNC_STATUS_THROTTLE_MS = 200;

export type VaultSyncListener = {
  onBatch?: (p: IndexSyncProgress) => void;
  onComplete?: () => void;
};

export type ForceVaultIndexResync = (
  vaultId: string,
  vaultPath: string,
  options?: { restartWatcher?: boolean },
) => void;

export interface VaultIndexSyncRuntimeDeps {
  getContext: () => VaultContext;
  vaultIndexSyncStatus: VaultIndexSyncStatusStore;
  vaultFsWatcher: NodeVaultFilesystemWatcher;
  vaultLayoutGuard: VaultLayoutGuardRunner;
  requireJobs: () => JobQueue;
  jobPermanentFailure: JobPermanentFailureStore;
  isRuntimeClosed: () => boolean;
  watcherDisabledVaultIds: Set<string>;
}

export function createVaultIndexSyncRuntime(deps: VaultIndexSyncRuntimeDeps) {
  const syncedVaultIds = new Set<string>();
  const vaultSyncPromises = new Map<string, Promise<void>>();
  const vaultSyncListeners = new Map<string, Set<VaultSyncListener>>();

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
        !deps.watcherDisabledVaultIds.has(vaultId) &&
        !deps.vaultFsWatcher.isWatching()
      ) {
        void deps.vaultFsWatcher
          .start(vaultId, vaultPath)
          .catch((error: unknown) => {
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
          !deps.watcherDisabledVaultIds.has(vaultId)
        ) {
          void deps.vaultFsWatcher
            .start(vaultId, vaultPath)
            .catch((error: unknown) => {
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

  const forceVaultIndexResync: ForceVaultIndexResync = (
    vaultId,
    vaultPath,
    options = {},
  ) => {
    if (options.restartWatcher === false) {
      deps.watcherDisabledVaultIds.add(vaultId);
    }
    syncedVaultIds.delete(vaultId);
    kickoffVaultIndexSync(vaultId, vaultPath, "force");
  };

  function isVaultFtsReady(vaultId: string): boolean {
    return syncedVaultIds.has(vaultId);
  }

  function buildSearchFtsQuery(
    userQuery: string,
    vaultId: string,
  ): string | null {
    const trimmed = userQuery.trim();
    if (!trimmed) {
      return null;
    }
    if (isVaultFtsReady(vaultId)) {
      return buildFtsMatchQuery(trimmed);
    }
    return buildMetadataFtsMatchQuery(trimmed);
  }

  function resetForRebuild(): void {
    syncedVaultIds.clear();
    vaultSyncPromises.clear();
    vaultSyncListeners.clear();
  }

  return {
    syncedVaultIds,
    vaultSyncPromises,
    vaultSyncListeners,
    addVaultSyncListener,
    startVaultIndexSync,
    kickoffVaultIndexSync,
    forceVaultIndexResync,
    notifyWatchItemsSynced,
    isVaultFtsReady,
    buildSearchFtsQuery,
    resetForRebuild,
  };
}
