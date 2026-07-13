import type { FolderTreeNode, TagWithCount } from "@collector/core";
import type { ItemFile, VaultMeta } from "@collector/shared";
import type { NavFilter } from "../types/ui";
import { isFolderFilter, isTagFilter } from "../types/ui";
import type { UpdateItemInput } from "../types/item";
import { mockStore } from "./mock-store";

let warmedUp = false;

export async function warmupCollector(): Promise<void> {
  warmedUp = true;
}

function ensureWarmedUp(): void {
  if (!warmedUp) {
    throw new Error("Dev mock collector is not warmed up");
  }
}

function matchesNavFilter(item: ItemFile, filter: NavFilter): boolean {
  if (isTagFilter(filter)) {
    return !item.is_archived && item.tag_ids.includes(filter.tagId);
  }
  if (isFolderFilter(filter)) {
    if (item.is_archived) {
      return false;
    }
    const path = filter.folderPath;
    return item.folder_path === path || item.folder_path.startsWith(`${path}/`);
  }
  if (filter === "all") {
    return !item.is_archived;
  }
  if (filter === "favorite") {
    return item.is_favorite;
  }
  return item.is_archived;
}

function matchesSearch(item: ItemFile, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return (
    item.title.toLowerCase().includes(needle) ||
    item.description.toLowerCase().includes(needle)
  );
}

export async function ensureActiveVault(): Promise<{
  vault: VaultMeta;
  path: string;
}> {
  ensureWarmedUp();
  return { vault: mockStore.getVault(), path: "/dev-mock/vault" };
}

export async function listDashboardItemIds(
  filter: NavFilter,
  query = "",
): Promise<string[]> {
  ensureWarmedUp();
  return mockStore
    .getItems()
    .filter((item) => matchesNavFilter(item, filter))
    .filter((item) => matchesSearch(item, query))
    .map((item) => item.id);
}

export async function streamDashboardItems(
  itemIds: string[],
  offset: number,
  limit: number,
  onItem: (item: ItemFile) => void,
  signal?: AbortSignal,
): Promise<void> {
  ensureWarmedUp();
  if (!itemIds.length || offset >= itemIds.length || limit <= 0) {
    return;
  }

  const batchIds = itemIds.slice(offset, offset + limit);
  const byId = new Map(mockStore.getItems().map((item) => [item.id, item]));
  for (const id of batchIds) {
    if (signal?.aborted) {
      return;
    }
    const item = byId.get(id);
    if (item) {
      onItem(item);
    }
  }
}

export async function loadDashboardItems(
  itemIds: string[],
  offset: number,
  limit: number,
): Promise<ItemFile[]> {
  ensureWarmedUp();
  if (!itemIds.length || offset >= itemIds.length) {
    return [];
  }

  const batchIds = itemIds.slice(offset, offset + limit);
  const byId = new Map(mockStore.getItems().map((item) => [item.id, item]));
  return batchIds
    .map((id) => byId.get(id))
    .filter((item): item is ItemFile => Boolean(item));
}

export async function listTags(): Promise<TagWithCount[]> {
  ensureWarmedUp();
  return mockStore.listTags();
}

export async function listFolderTree(): Promise<FolderTreeNode[]> {
  ensureWarmedUp();
  return mockStore.listFolderTree();
}

export async function resolveItemThumbnailPath(
  item: ItemFile,
): Promise<string | null> {
  ensureWarmedUp();
  if (!item.thumbnail) {
    return null;
  }
  if (
    item.thumbnail.startsWith("https://") ||
    item.thumbnail.startsWith("http://")
  ) {
    return item.thumbnail;
  }
  return null;
}

export async function updateItem(
  itemId: string,
  input: UpdateItemInput,
): Promise<ItemFile> {
  ensureWarmedUp();
  const existing = mockStore.getItemById(itemId);
  if (!existing) {
    throw new Error(`Item not found: ${itemId}`);
  }

  return mockStore.updateItem(itemId, {
    title: input.title ?? existing.title,
    description: input.description ?? existing.description,
    url: input.url !== undefined ? input.url : existing.url,
    content_type: input.content_type ?? existing.content_type,
    is_favorite: input.is_favorite ?? existing.is_favorite,
    is_archived: input.is_archived ?? existing.is_archived,
    tag_ids: input.tag_ids ?? existing.tag_ids,
    folder_path: input.folder_path ?? existing.folder_path,
  });
}
