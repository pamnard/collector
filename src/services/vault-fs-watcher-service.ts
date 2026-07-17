import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  createVaultWatchBatcher,
  parseVaultItemWatchPath,
  syncIndexItemsFromFilesystem,
  type VaultContext,
} from "@collector/core";
import { reportServiceError } from "./runtime-error";

const VAULT_WATCH_DEBOUNCE_MS = 300;

export interface VaultFilesystemWatcherConfig {
  getContext: () => VaultContext;
  getActiveVaultId: () => string | null;
  onItemsSynced: (vaultId: string) => void;
  forceVaultIndexResync: (vaultId: string, vaultPath: string) => void;
}

interface ActiveVaultWatch {
  vaultId: string;
  vaultPath: string;
  batcher: ReturnType<typeof createVaultWatchBatcher>;
  unlisten: UnlistenFn;
  unlistenError: UnlistenFn;
}

let config: VaultFilesystemWatcherConfig | null = null;
let activeWatch: ActiveVaultWatch | null = null;
const pendingWatchItemIds = new Set<string>();
let watchApplyPromise: Promise<void> | null = null;

export function configureVaultFilesystemWatcher(
  next: VaultFilesystemWatcherConfig,
): void {
  config = next;
}

async function drainWatchQueue(vaultId: string, vaultPath: string): Promise<void> {
  while (pendingWatchItemIds.size > 0) {
    const itemIds = [...pendingWatchItemIds];
    pendingWatchItemIds.clear();
    const report = await syncIndexItemsFromFilesystem(
      config!.getContext(),
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
    config!.onItemsSynced(vaultId);
  }
}

function scheduleWatchApply(vaultId: string, vaultPath: string): void {
  if (watchApplyPromise) {
    return;
  }
  watchApplyPromise = drainWatchQueue(vaultId, vaultPath)
    .catch((error: unknown) => {
      reportServiceError("vault watch index sync", error);
      config?.forceVaultIndexResync(vaultId, vaultPath);
    })
    .finally(() => {
      watchApplyPromise = null;
      if (pendingWatchItemIds.size > 0) {
        scheduleWatchApply(vaultId, vaultPath);
      }
    });
}

export async function startVaultFilesystemWatcher(
  vaultId: string,
  vaultPath: string,
): Promise<void> {
  if (!config) {
    throw new Error("vault filesystem watcher is not configured");
  }

  await stopVaultFilesystemWatcher();

  const batcher = createVaultWatchBatcher({
    debounceMs: VAULT_WATCH_DEBOUNCE_MS,
    onFlush: (itemIds: string[]) => {
      if (config!.getActiveVaultId() !== vaultId) {
        return;
      }
      for (const itemId of itemIds) {
        pendingWatchItemIds.add(itemId);
      }
      scheduleWatchApply(vaultId, vaultPath);
    },
  });

  try {
    await invoke("start_vault_items_watcher", { vaultPath });
  } catch (error) {
    reportServiceError("vault filesystem watcher start", error);
    batcher.dispose();
    config.forceVaultIndexResync(vaultId, vaultPath);
    return;
  }

  const unlisten = await listen<{ vaultPath: string; changedPath: string }>(
    "vault-item-fs-change",
    (event) => {
      if (event.payload.vaultPath !== vaultPath) {
        return;
      }
      if (config!.getActiveVaultId() !== vaultId) {
        return;
      }
      const itemId = parseVaultItemWatchPath(vaultPath, event.payload.changedPath);
      if (!itemId) {
        return;
      }
      batcher.enqueue(itemId);
    },
  );

  const unlistenError = await listen<{ vaultPath: string; message: string }>(
    "vault-items-watcher-error",
    (event) => {
      if (event.payload.vaultPath !== vaultPath) {
        return;
      }
      reportServiceError(
        "vault filesystem watcher",
        new Error(event.payload.message),
      );
      void stopVaultFilesystemWatcher();
      config!.forceVaultIndexResync(vaultId, vaultPath);
    },
  );

  activeWatch = { vaultId, vaultPath, batcher, unlisten, unlistenError };
}

export async function stopVaultFilesystemWatcher(): Promise<void> {
  if (!activeWatch) {
    return;
  }

  const { vaultPath, batcher, unlisten, unlistenError } = activeWatch;
  activeWatch = null;
  pendingWatchItemIds.clear();
  batcher.dispose();
  unlisten();
  unlistenError();

  try {
    await invoke("stop_vault_items_watcher", { vaultPath });
  } catch (error) {
    reportServiceError("vault filesystem watcher stop", error);
  }
}
