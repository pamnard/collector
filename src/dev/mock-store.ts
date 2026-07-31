import type { FolderTreeNode, TagWithCount } from "@collector/core";
import type { ItemFile, VaultMeta } from "@collector/shared";
import { INBOX_FOLDER_NAME, isInboxFolderName } from "@collector/shared";
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
let thumbnailUrls: Record<string, string | null> = {};
let diskVault = false;

function folderItemCount(folderPath: string): number {
  return items.filter(
    (item) =>
      item.folder_path === folderPath ||
      item.folder_path.startsWith(`${folderPath}/`),
  ).length;
}

function withInboxFolder(tree: FolderTreeNode[]): FolderTreeNode[] {
  const withoutInbox = tree.filter((node) => !isInboxFolderName(node.name));
  const existing = tree.find((node) => isInboxFolderName(node.name));
  const inbox =
    existing ??
    ({
      name: INBOX_FOLDER_NAME,
      path: INBOX_FOLDER_NAME,
      item_count: folderItemCount(INBOX_FOLDER_NAME),
      children: [],
    } satisfies FolderTreeNode);
  return [inbox, ...withoutInbox];
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

  return withInboxFolder([
    projects,
    {
      name: "reading",
      path: "reading",
      item_count: folderItemCount("reading"),
      children: [],
    },
  ]);
}

function resetSynthetic(): void {
  items = createMockItems();
  vault = createMockVault();
  tags = null;
  folderTree = null;
  thumbnailUrls = {};
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
    thumbnailUrls = snapshot.thumbnailUrls ?? {};
    diskVault = true;
  },

  resetToSynthetic(): void {
    resetSynthetic();
  },

  getThumbnailUrl(itemId: string): string | null | undefined {
    if (!diskVault) {
      return undefined;
    }
    return thumbnailUrls[itemId] ?? null;
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

  ensureTagByName(name: string): TagWithCount {
    const normalized = name.trim();
    const current = this.listTags();
    const existing = current.find(
      (tag) => tag.name.toLowerCase() === normalized.toLowerCase(),
    );
    if (existing) {
      return existing;
    }
    const created: TagWithCount = {
      id: crypto.randomUUID(),
      name: normalized,
      color: null,
      created_at: new Date().toISOString(),
      item_count: 0,
    };
    tags = [...current, created].sort((a, b) => a.name.localeCompare(b.name));
    return created;
  },

  listFolderTree(): FolderTreeNode[] {
    if (folderTree) {
      return withInboxFolder(folderTree);
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
        | "tag_ids"
        | "folder_path"
      >
    >,
  ): ItemFile {
    const index = items.findIndex((item) => item.id === itemId);
    if (index < 0) {
      throw new Error(`Item not found: ${itemId}`);
    }

    const existing = items[index]!;
    const nextFolder =
      patch.folder_path !== undefined ? patch.folder_path : existing.folder_path;
    let nextId = existing.id;
    if (
      patch.folder_path !== undefined &&
      patch.folder_path !== existing.folder_path &&
      existing.id.toLowerCase().endsWith(".md")
    ) {
      const slash = existing.id.lastIndexOf("/");
      const name = slash === -1 ? existing.id : existing.id.slice(slash + 1);
      nextId = nextFolder ? `${nextFolder}/${name}` : name;
      if (items.some((item, i) => i !== index && item.id === nextId)) {
        throw new Error(`Item already exists at destination: ${nextId}`);
      }
    }

    const updated: ItemFile = {
      ...existing,
      ...patch,
      id: nextId,
      folder_path: nextFolder,
      updated_at: new Date().toISOString(),
    };
    items = [...items.slice(0, index), updated, ...items.slice(index + 1)];
    return updated;
  },

  addItem(item: ItemFile): ItemFile {
    if (items.some((existing) => existing.id === item.id)) {
      throw new Error(`Item already exists: ${item.id}`);
    }
    items = [item, ...items];
    folderTree = null;
    tags = null;
    return item;
  },
};
