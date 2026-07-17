import type { FolderTreeNode, TagWithCount } from "@collector/core";
import type { ItemFile, VaultMeta } from "@collector/shared";
import {
  createMockItems,
  createMockTags,
  createMockVault,
} from "./mock-data";
import type { DevVaultSnapshot } from "./dev-vault-types";

let items: ItemFile[] = createMockItems();
let vault: VaultMeta = createMockVault();
let tags: TagWithCount[] | null = null;
let folderTree: FolderTreeNode[] | null = null;
let diskVault = false;

function folderItemCount(folderPath: string): number {
  return items.filter(
    (item) =>
      !item.is_archived &&
      (item.folder_path === folderPath ||
        item.folder_path.startsWith(`${folderPath}/`)),
  ).length;
}

function buildSyntheticFolderTree(): FolderTreeNode[] {
  const projects: FolderTreeNode = {
    name: "projects",
    path: "projects",
    item_count: folderItemCount("projects"),
    children: [
      {
        name: "collector",
        path: "projects/collector",
        item_count: folderItemCount("projects/collector"),
        children: [],
      },
      {
        name: "research",
        path: "projects/research",
        item_count: folderItemCount("projects/research"),
        children: [],
      },
    ],
  };

  return [
    projects,
    {
      name: "reading",
      path: "reading",
      item_count: folderItemCount("reading"),
      children: [],
    },
    {
      name: "inbox",
      path: "inbox",
      item_count: folderItemCount("inbox"),
      children: [],
    },
  ];
}

function resetSynthetic(): void {
  items = createMockItems();
  vault = createMockVault();
  tags = null;
  folderTree = null;
  diskVault = false;
}

export const mockStore = {
  isDiskVault(): boolean {
    return diskVault;
  },

  loadVaultSnapshot(snapshot: DevVaultSnapshot): void {
    vault = snapshot.vault;
    items = snapshot.items;
    tags = snapshot.tags;
    folderTree = snapshot.folderTree;
    diskVault = true;
  },

  resetToSynthetic(): void {
    resetSynthetic();
  },

  getVault(): VaultMeta {
    return vault;
  },

  getItems(): ItemFile[] {
    return items;
  },

  getItemById(itemId: string): ItemFile | undefined {
    return items.find((item) => item.id === itemId);
  },

  listTags(): TagWithCount[] {
    if (tags) {
      return tags;
    }
    return createMockTags(items);
  },

  listFolderTree(): FolderTreeNode[] {
    if (folderTree) {
      return folderTree;
    }
    return buildSyntheticFolderTree();
  },

  updateItem(
    itemId: string,
    patch: Partial<
      Pick<
        ItemFile,
        | "title"
        | "description"
        | "url"
        | "content_type"
        | "is_favorite"
        | "is_archived"
        | "tag_ids"
        | "folder_path"
      >
    >,
  ): ItemFile {
    const index = items.findIndex((item) => item.id === itemId);
    if (index < 0) {
      throw new Error(`Item not found: ${itemId}`);
    }

    const updated: ItemFile = {
      ...items[index],
      ...patch,
      updated_at: new Date().toISOString(),
    };
    items = [...items.slice(0, index), updated, ...items.slice(index + 1)];
    return updated;
  },
};
