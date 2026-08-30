import type { ItemFile } from "@collector/shared";
import type { FolderTreeNode } from "../domain.js";
import type { DashboardItemSort } from "./items.js";
import type { ServiceSubscribeHandlers, Subscription } from "./shared.js";

/** Folders port (#361). */
export interface FoldersPort {
  subscribeFolderTree(
    onUpdate: (tree: FolderTreeNode[]) => void,
    handlers?: ServiceSubscribeHandlers,
    signal?: AbortSignal,
  ): Subscription;
  listFolderTree(): Promise<FolderTreeNode[]>;
  /**
   * Items whose `folder_path` equals `folderPath` exactly.
   * Does not include child folders. Empty folder → `[]`. Missing folder → error.
   * Index card fields only (same hydrate surface as search), not full markdown.
   * Optional `sort` uses the shared item-id allowlist:
   * `title`, `created_at`, `updated_at`, `content_type`, `word_count`,
   * `character_count` with `asc`/`desc`. Omit → default `created_at` desc.
   */
  listFolderItems(
    folderPath: string,
    sort?: DashboardItemSort,
  ): Promise<ItemFile[]>;
  createFolder(folderPath: string): Promise<string>;
  renameFolder(oldPath: string, newPath: string): Promise<string>;
  deleteFolder(folderPath: string): Promise<void>;
  moveItemToFolderPath(itemId: string, folderPath: string): Promise<ItemFile>;
}
