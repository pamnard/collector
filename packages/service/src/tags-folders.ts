/**
 * In-process tags + folders (+ move item) ops (#148).
 * Host injects vault/index accessors.
 */

import type {
  FolderTreeNode,
  ServiceSubscribeHandlers,
  Subscription,
  TagWithCount,
} from "@collector/api";
import { asCollectorApiError, subscriptionFromTeardown } from "@collector/api";
import type { ItemFile, VaultMeta } from "@collector/shared";
import { folderPathFromItemPath } from "@collector/shared";
import {
  createFolder as createFolderOnVault,
  deleteFolder as deleteFolderOnVault,
  listFolderItems as listFolderItemsOnVault,
  listTagsWithCounts,
  moveItemToFolder,
  reconcileFolderTreeFromDisk,
  renameFolder as renameFolderOnVault,
  type IndexSyncProgress,
  type VaultContext,
} from "@collector/core";

import type { VaultPresentationChangedPayload } from "./vault-presentation-changed.js";

export type { ServiceSubscribeHandlers } from "@collector/api";

export type VaultSyncBatchListener = {
  onBatch?: (progress: IndexSyncProgress) => void;
  onComplete?: () => void;
};

export interface TagsFoldersServiceDeps {
  resolveActiveVault: () => Promise<{ vault: VaultMeta; path: string }>;
  getContext: () => VaultContext;
  kickoffVaultIndexSync: (vaultId: string, vaultPath: string) => void;
  addVaultSyncListener: (
    vaultId: string,
    listener: VaultSyncBatchListener,
  ) => () => void;
  syncRepublishThrottleMs?: number;
  onVaultPresentationChanged?: (
    payload: VaultPresentationChangedPayload,
  ) => void;
}

function createThrottledPublisher(
  fn: () => void,
  intervalMs: number,
): { schedule: () => void; flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRun = 0;

  const run = () => {
    lastRun = Date.now();
    fn();
  };

  return {
    schedule() {
      const elapsed = Date.now() - lastRun;
      if (elapsed >= intervalMs) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        run();
        return;
      }
      if (timer) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        run();
      }, intervalMs - elapsed);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      run();
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

function linkAbortSignal(signal: AbortSignal | undefined): {
  signal: AbortSignal;
  unsubscribe: () => void;
} {
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }
  return {
    signal: controller.signal,
    unsubscribe: () => controller.abort(),
  };
}

export interface TagsFoldersService {
  subscribeTags(
    onUpdate: (tags: TagWithCount[]) => void,
    handlers?: ServiceSubscribeHandlers,
    signal?: AbortSignal,
  ): Subscription;
  listTags(): Promise<TagWithCount[]>;
  subscribeFolderTree(
    onUpdate: (tree: FolderTreeNode[]) => void,
    handlers?: ServiceSubscribeHandlers,
    signal?: AbortSignal,
  ): Subscription;
  listFolderTree(): Promise<FolderTreeNode[]>;
  listFolderItems(folderPath: string): Promise<ItemFile[]>;
  createFolder(folderPath: string): Promise<string>;
  renameFolder(oldPath: string, newPath: string): Promise<string>;
  deleteFolder(folderPath: string): Promise<void>;
  moveItemToFolderPath(itemId: string, folderPath: string): Promise<ItemFile>;
}

export function createTagsFoldersService(
  deps: TagsFoldersServiceDeps,
): TagsFoldersService {
  const republishMs = deps.syncRepublishThrottleMs ?? 500;

  const listTags = async (): Promise<TagWithCount[]> => {
    const { vault, path } = await deps.resolveActiveVault();
    deps.kickoffVaultIndexSync(vault.id, path);
    return listTagsWithCounts(deps.getContext(), vault.id);
  };

  const subscribeTags = (
    onUpdate: (tags: TagWithCount[]) => void,
    handlers?: ServiceSubscribeHandlers,
    signal?: AbortSignal,
  ): Subscription => {
    const linked = linkAbortSignal(signal);
    void (async () => {
      const { vault, path } = await deps.resolveActiveVault();
      if (linked.signal.aborted) {
        return;
      }

      const publish = async () => {
        try {
          const tags = await listTagsWithCounts(deps.getContext(), vault.id);
          if (!linked.signal.aborted) {
            onUpdate(tags);
          }
        } catch (error) {
          handlers?.onError?.(
            "tags publish",
            asCollectorApiError(error),
          );
        }
      };

      const republish = createThrottledPublisher(() => {
        void publish();
      }, republishMs);

      const unsub = deps.addVaultSyncListener(vault.id, {
        onBatch: () => {
          republish.schedule();
        },
        onComplete: () => {
          republish.flush();
        },
      });

      const onAbort = () => {
        republish.cancel();
        unsub();
      };
      linked.signal.addEventListener("abort", onAbort, { once: true });

      await publish();
      deps.kickoffVaultIndexSync(vault.id, path);
    })().catch((error: unknown) => {
      handlers?.onError?.(
        "tags subscribe",
        asCollectorApiError(error),
      );
      if (!linked.signal.aborted) {
        onUpdate([]);
      }
    });
    return subscriptionFromTeardown(linked.unsubscribe);
  };

  const listFolderTree = async (): Promise<FolderTreeNode[]> => {
    const { vault, path } = await deps.resolveActiveVault();
    deps.kickoffVaultIndexSync(vault.id, path);
    return reconcileFolderTreeFromDisk(deps.getContext(), path, vault.id);
  };

  const listFolderItems = async (folderPath: string): Promise<ItemFile[]> => {
    const { vault, path } = await deps.resolveActiveVault();
    deps.kickoffVaultIndexSync(vault.id, path);
    return listFolderItemsOnVault(
      deps.getContext(),
      path,
      vault.id,
      folderPath,
    );
  };

  const subscribeFolderTree = (
    onUpdate: (tree: FolderTreeNode[]) => void,
    handlers?: ServiceSubscribeHandlers,
    signal?: AbortSignal,
  ): Subscription => {
    const linked = linkAbortSignal(signal);
    void (async () => {
      const { vault, path } = await deps.resolveActiveVault();
      if (linked.signal.aborted) {
        return;
      }

      const ctx = deps.getContext();

      const publish = async () => {
        if (linked.signal.aborted) {
          return;
        }
        try {
          onUpdate(await reconcileFolderTreeFromDisk(ctx, path, vault.id));
        } catch (error: unknown) {
          handlers?.onError?.(
            "folder tree",
            asCollectorApiError(error),
          );
          if (!linked.signal.aborted) {
            onUpdate([]);
          }
        }
      };

      const republish = createThrottledPublisher(() => {
        void publish();
      }, republishMs);

      const unsub = deps.addVaultSyncListener(vault.id, {
        onBatch: () => {
          republish.schedule();
        },
        onComplete: () => {
          republish.flush();
        },
      });

      const onAbort = () => {
        republish.cancel();
        unsub();
      };
      linked.signal.addEventListener("abort", onAbort, { once: true });

      await publish();
      deps.kickoffVaultIndexSync(vault.id, path);
    })().catch((error: unknown) => {
      handlers?.onError?.(
        "folder tree",
        asCollectorApiError(error),
      );
      if (!linked.signal.aborted) {
        onUpdate([]);
      }
    });
    return subscriptionFromTeardown(linked.unsubscribe);
  };

  // Folder / item-path mutators must finish disk + index rewrite before
  // kickoffVaultIndexSync (and layout guard). Kicking sync first races
  // rewriteItemIds → UNIQUE Items.id while the UI still shows busy (#758).
  const createFolder = async (folderPath: string): Promise<string> => {
    const { vault, path } = await deps.resolveActiveVault();
    const created = await createFolderOnVault(
      deps.getContext(),
      path,
      folderPath,
    );
    deps.kickoffVaultIndexSync(vault.id, path);
    deps.onVaultPresentationChanged?.({
      vaultId: vault.id,
      kind: "folderChanged",
      folderPath: created,
    });
    return created;
  };

  const renameFolder = async (
    oldPath: string,
    newPath: string,
  ): Promise<string> => {
    const { vault, path } = await deps.resolveActiveVault();
    const renamed = await renameFolderOnVault(
      deps.getContext(),
      path,
      vault.id,
      oldPath,
      newPath,
    );
    deps.kickoffVaultIndexSync(vault.id, path);
    deps.onVaultPresentationChanged?.({
      vaultId: vault.id,
      kind: "folderChanged",
      folderPath: renamed,
    });
    return renamed;
  };

  const deleteFolder = async (folderPath: string): Promise<void> => {
    const { vault, path } = await deps.resolveActiveVault();
    await deleteFolderOnVault(deps.getContext(), path, vault.id, folderPath);
    deps.kickoffVaultIndexSync(vault.id, path);
    deps.onVaultPresentationChanged?.({
      vaultId: vault.id,
      kind: "folderChanged",
      folderPath,
    });
  };

  const moveItemToFolderPath = async (
    itemId: string,
    folderPath: string,
  ): Promise<ItemFile> => {
    const { vault, path } = await deps.resolveActiveVault();
    const fromFolderPath = folderPathFromItemPath(itemId);
    const moved = await moveItemToFolder(
      deps.getContext(),
      path,
      vault.id,
      itemId,
      folderPath,
    );
    deps.kickoffVaultIndexSync(vault.id, path);
    deps.onVaultPresentationChanged?.({
      vaultId: vault.id,
      kind: "itemMoved",
      itemId: moved.id,
      fromFolderPath,
      toFolderPath: folderPath,
    });
    return moved;
  };

  return {
    subscribeTags,
    listTags,
    subscribeFolderTree,
    listFolderTree,
    listFolderItems,
    createFolder,
    renameFolder,
    deleteFolder,
    moveItemToFolderPath,
  };
}
