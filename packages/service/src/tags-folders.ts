/**
 * In-process tags + folders (+ move item) ops (#148).
 * Host injects vault/index accessors; no Tauri / IPC here.
 */

import type { FolderTreeNode, TagWithCount } from "@collector/api";
import type { ServiceSubscribeHandlers } from "@collector/api";
import type { ItemFile, Tag, VaultMeta } from "@collector/shared";
import {
  createFolder as createFolderOnVault,
  createTag as createTagOnVault,
  deleteFolder as deleteFolderOnVault,
  deleteTag as deleteTagOnVault,
  listFolderTreeFromIndex,
  listTagsWithCounts,
  moveItemToFolder,
  renameFolder as renameFolderOnVault,
  updateTag as updateTagOnVault,
  type IndexSyncProgress,
  type VaultContext,
} from "@collector/core";

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

export interface TagsFoldersService {
  subscribeTags(
    onUpdate: (tags: TagWithCount[]) => void,
    handlers?: ServiceSubscribeHandlers,
    signal?: AbortSignal,
  ): void;
  listTags(): Promise<TagWithCount[]>;
  createTag(input: { name: string; color?: string | null }): Promise<Tag>;
  updateTagRecord(
    tagId: string,
    input: { name?: string; color?: string | null },
  ): Promise<Tag>;
  deleteTag(tagId: string): Promise<void>;
  subscribeFolderTree(
    onUpdate: (tree: FolderTreeNode[]) => void,
    handlers?: ServiceSubscribeHandlers,
    signal?: AbortSignal,
  ): void;
  listFolderTree(): Promise<FolderTreeNode[]>;
  loadFolderTree(): Promise<FolderTreeNode[]>;
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
  ): void => {
    void (async () => {
      const { vault, path } = await deps.resolveActiveVault();
      if (signal?.aborted) {
        return;
      }

      const publish = async () => {
        try {
          const tags = await listTagsWithCounts(deps.getContext(), vault.id);
          if (!signal?.aborted) {
            onUpdate(tags);
          }
        } catch (error) {
          handlers?.onError?.("tags publish", error);
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
      signal?.addEventListener("abort", onAbort, { once: true });

      await publish();
      deps.kickoffVaultIndexSync(vault.id, path);
    })().catch((error: unknown) => {
      handlers?.onError?.("tags subscribe", error);
      if (!signal?.aborted) {
        onUpdate([]);
      }
    });
  };

  const createTag = async (input: {
    name: string;
    color?: string | null;
  }): Promise<Tag> => {
    const { vault, path } = await deps.resolveActiveVault();
    deps.kickoffVaultIndexSync(vault.id, path);
    return createTagOnVault(deps.getContext(), path, vault.id, input);
  };

  const updateTagRecord = async (
    tagId: string,
    input: { name?: string; color?: string | null },
  ): Promise<Tag> => {
    const { vault, path } = await deps.resolveActiveVault();
    deps.kickoffVaultIndexSync(vault.id, path);
    return updateTagOnVault(deps.getContext(), path, vault.id, tagId, input);
  };

  const deleteTag = async (tagId: string): Promise<void> => {
    const { vault, path } = await deps.resolveActiveVault();
    deps.kickoffVaultIndexSync(vault.id, path);
    await deleteTagOnVault(deps.getContext(), path, vault.id, tagId);
  };

  const listFolderTree = async (): Promise<FolderTreeNode[]> => {
    const { vault, path } = await deps.resolveActiveVault();
    deps.kickoffVaultIndexSync(vault.id, path);
    return listFolderTreeFromIndex(deps.getContext(), path, vault.id);
  };

  const loadFolderTree = async (): Promise<FolderTreeNode[]> => listFolderTree();

  const subscribeFolderTree = (
    onUpdate: (tree: FolderTreeNode[]) => void,
    handlers?: ServiceSubscribeHandlers,
    signal?: AbortSignal,
  ): void => {
    void (async () => {
      const { vault, path } = await deps.resolveActiveVault();
      if (signal?.aborted) {
        return;
      }

      const ctx = deps.getContext();

      const publish = async () => {
        if (signal?.aborted) {
          return;
        }
        try {
          onUpdate(await listFolderTreeFromIndex(ctx, path, vault.id));
        } catch (error: unknown) {
          handlers?.onError?.("folder tree index", error);
          if (!signal?.aborted) {
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
      signal?.addEventListener("abort", onAbort, { once: true });

      await publish();
      deps.kickoffVaultIndexSync(vault.id, path);
    })().catch((error: unknown) => {
      handlers?.onError?.("folder tree", error);
      if (!signal?.aborted) {
        onUpdate([]);
      }
    });
  };

  const createFolder = async (folderPath: string): Promise<string> => {
    const { vault, path } = await deps.resolveActiveVault();
    deps.kickoffVaultIndexSync(vault.id, path);
    return createFolderOnVault(deps.getContext(), path, folderPath);
  };

  const renameFolder = async (
    oldPath: string,
    newPath: string,
  ): Promise<string> => {
    const { vault, path } = await deps.resolveActiveVault();
    deps.kickoffVaultIndexSync(vault.id, path);
    return renameFolderOnVault(
      deps.getContext(),
      path,
      vault.id,
      oldPath,
      newPath,
    );
  };

  const deleteFolder = async (folderPath: string): Promise<void> => {
    const { vault, path } = await deps.resolveActiveVault();
    deps.kickoffVaultIndexSync(vault.id, path);
    await deleteFolderOnVault(deps.getContext(), path, vault.id, folderPath);
  };

  const moveItemToFolderPath = async (
    itemId: string,
    folderPath: string,
  ): Promise<ItemFile> => {
    const { vault, path } = await deps.resolveActiveVault();
    deps.kickoffVaultIndexSync(vault.id, path);
    return moveItemToFolder(
      deps.getContext(),
      path,
      vault.id,
      itemId,
      folderPath,
    );
  };

  return {
    subscribeTags,
    listTags,
    createTag,
    updateTagRecord,
    deleteTag,
    subscribeFolderTree,
    listFolderTree,
    loadFolderTree,
    createFolder,
    renameFolder,
    deleteFolder,
    moveItemToFolderPath,
  };
}
