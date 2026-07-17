import type { FolderTreeNode, TagWithCount } from "@collector/core";
import type { ItemFile, VaultMeta } from "@collector/shared";

export const DEV_VAULT_SNAPSHOT_PATH = "/__dev/vault/snapshot";
export const DEV_VAULT_FS_PREFIX = "/__dev/vault/fs";

export interface DevVaultSnapshot {
  vault: VaultMeta;
  items: ItemFile[];
  tags: TagWithCount[];
  folderTree: FolderTreeNode[];
  /** Browser URLs under /__dev/vault/fs — mirrors Tauri resolve_item_thumbnail_paths. */
  thumbnailUrls: Record<string, string | null>;
}
