import type { FolderTreeNode, MediaWithPath, TagWithCount } from "@collector/core";
import {
  buildCanonicalFrontmatter,
  buildBacklinkReverseMap,
  contentTypeFromFrontmatter,
  isItemIdSortKey,
  parseAndResolveTextLinks,
  textLinkResolveContextFromItems,
  parseDocumentMarkdown,
  parseKnownFrontmatter,
  resolveItemThumbnailAbsolutePath,
  serializeDocumentMarkdown,
} from "@collector/core";
import type { ItemFile, VaultMeta } from "@collector/shared";
import type { DashboardItemSort } from "@collector/api";
import type { NavFilter } from "../types/ui";
import { isFolderFilter, isTagFilter } from "../types/ui";
import type { UpdateItemInput } from "../types/item";
import {
  DEV_VAULT_FS_PREFIX,
  DEV_VAULT_ITEM_MEDIA_PATH,
  DEV_VAULT_SNAPSHOT_PATH,
  type DevVaultSnapshot,
} from "./dev-vault-types";
import { mockStore } from "./mock-store";

let warmedUp = false;

/** Vault-relative path (e.g. `Inbox/note.md`) → browser URL under the dev fs mount. */
function devVaultFsUrl(vaultRelativePath: string): string {
  return `${DEV_VAULT_FS_PREFIX}/${vaultRelativePath.replace(/^\/+/, "")}`;
}

async function fetchDevVaultText(url: string): Promise<string | null> {
  const response = await fetch(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Dev vault fetch failed (${response.status}): ${url}`);
  }
  return response.text();
}

export async function warmupCollector(): Promise<void> {
  const response = await fetch(DEV_VAULT_SNAPSHOT_PATH);
  if (response.ok) {
    const snapshot = (await response.json()) as DevVaultSnapshot;
    mockStore.loadVaultSnapshot(snapshot);
  } else {
    mockStore.resetToSynthetic();
  }
  warmedUp = true;
}

function ensureWarmedUp(): void {
  if (!warmedUp) {
    throw new Error("Dev mock collector is not warmed up");
  }
}

function matchesNavFilter(item: ItemFile, filter: NavFilter): boolean {
  if (isTagFilter(filter)) {
    return item.tag_ids.includes(filter.tagId);
  }
  if (isFolderFilter(filter)) {
    const path = filter.folderPath;
    return item.folder_path === path || item.folder_path.startsWith(`${path}/`);
  }
  return true;
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

function compareDashboardItems(
  a: ItemFile,
  b: ItemFile,
  sort?: DashboardItemSort,
): number {
  const key = sort?.key ?? "created_at";
  const dir = sort?.dir ?? "desc";
  if (!isItemIdSortKey(key)) {
    throw new Error(`Unsupported item id sort key: ${key}`);
  }
  let cmp = 0;
  switch (key) {
    case "title":
      cmp = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      break;
    case "content_type":
      cmp = a.content_type.localeCompare(b.content_type);
      break;
    case "updated_at":
      cmp = a.updated_at.localeCompare(b.updated_at);
      break;
    case "created_at":
    default:
      cmp = a.created_at.localeCompare(b.created_at);
      break;
  }
  if (cmp === 0) {
    cmp = a.id.localeCompare(b.id);
  }
  return dir === "asc" ? cmp : -cmp;
}

function listFilteredDashboardIds(
  filter: NavFilter,
  query = "",
  sort?: DashboardItemSort,
): string[] {
  return mockStore
    .getItems()
    .filter((item) => matchesNavFilter(item, filter))
    .filter((item) => matchesSearch(item, query))
    .sort((a, b) => compareDashboardItems(a, b, sort))
    .map((item) => item.id);
}

export async function fetchDashboardIndexPage(
  filter: NavFilter,
  query = "",
  page: { limit: number; offset: number },
  sort?: DashboardItemSort,
): Promise<{
  itemIds: string[];
  stamps: string[];
  totalCount: number;
  offset: number;
}> {
  ensureWarmedUp();
  const allIds = listFilteredDashboardIds(filter, query, sort);
  const itemIds = allIds.slice(page.offset, page.offset + page.limit);
  const stamps = itemIds.map((id) => {
    const item = mockStore.getItemById(id);
    if (!item) {
      throw new Error(`Missing mock item for stamp: ${id}`);
    }
    return String(Date.parse(item.updated_at));
  });
  return {
    itemIds,
    stamps,
    totalCount: allIds.length,
    offset: page.offset,
  };
}

export async function listDashboardItemIds(
  filter: NavFilter,
  query = "",
  sort?: DashboardItemSort,
): Promise<string[]> {
  ensureWarmedUp();
  return listFilteredDashboardIds(filter, query, sort);
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

export async function getItemById(
  itemId: string,
): Promise<{ item: ItemFile; content: string | null }> {
  ensureWarmedUp();
  const item = mockStore.getItemById(itemId);
  if (!item) {
    throw new Error(`Item not found: ${itemId}`);
  }

  if (!mockStore.isDiskVault()) {
    return { item, content: null };
  }

  const raw = await fetchDevVaultText(devVaultFsUrl(itemId));
  const content = raw === null ? null : parseDocumentMarkdown(raw).body;
  return { item, content };
}

export async function resolveContentTextLinks(
  itemId: string,
  body: string,
) {
  ensureWarmedUp();
  const items = mockStore.getItems();
  return parseAndResolveTextLinks(
    body,
    textLinkResolveContextFromItems(itemId, items),
  );
}

export async function listItemBacklinks(itemId: string) {
  ensureWarmedUp();
  const items = mockStore.getItems();
  if (!mockStore.isDiskVault()) {
    return [];
  }
  const sources: Array<{ id: string; title: string; body: string }> = [];
  for (const item of items) {
    const raw = await fetchDevVaultText(devVaultFsUrl(item.id));
    if (raw === null) {
      continue;
    }
    sources.push({
      id: item.id,
      title: item.title,
      body: parseDocumentMarkdown(raw).body,
    });
  }
  const reverse = buildBacklinkReverseMap(items, sources);
  return reverse.get(itemId) ?? [];
}

export async function getAdjacentItems(itemId: string): Promise<{
  prev: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
}> {
  ensureWarmedUp();
  const current = mockStore.getItemById(itemId);
  if (!current) {
    return { prev: null, next: null };
  }

  const siblings = mockStore
    .getItems()
    .filter((item) => item.folder_path === current.folder_path)
    .slice()
    .sort((a, b) => {
      if (a.created_at !== b.created_at) {
        return a.created_at < b.created_at ? -1 : 1;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const index = siblings.findIndex((item) => item.id === current.id);
  if (index < 0) {
    return { prev: null, next: null };
  }

  const prevItem = index > 0 ? siblings[index - 1] : undefined;
  const nextItem =
    index < siblings.length - 1 ? siblings[index + 1] : undefined;

  return {
    prev: prevItem ? { id: prevItem.id, title: prevItem.title } : null,
    next: nextItem ? { id: nextItem.id, title: nextItem.title } : null,
  };
}

export async function getItemSource(itemId: string): Promise<string> {
  ensureWarmedUp();
  const item = mockStore.getItemById(itemId);
  if (!item) {
    throw new Error(`Item not found: ${itemId}`);
  }

  if (mockStore.isDiskVault()) {
    const raw = await fetchDevVaultText(devVaultFsUrl(itemId));
    if (raw === null) {
      throw new Error(`Item not found: ${itemId}`);
    }
    return raw;
  }

  const frontmatter = buildCanonicalFrontmatter({
    title: item.title,
    description: item.description,
    url: item.url,
    content_type: item.content_type,
    source_type: item.source_type,
    source_id: item.source_id,
    tags: [],
    thumbnail: item.thumbnail,
    content_revision: item.content_revision,
    created: item.created_at,
    updated: item.updated_at,
    metadata: item.metadata,
    properties: item.properties,
  });
  return serializeDocumentMarkdown(frontmatter, "");
}

export async function updateItemSource(
  itemId: string,
  rawMarkdown: string,
): Promise<ItemFile> {
  ensureWarmedUp();
  const existing = mockStore.getItemById(itemId);
  if (!existing) {
    throw new Error(`Item not found: ${itemId}`);
  }
  if (mockStore.isDiskVault()) {
    throw new Error(
      "Updating item source is not supported in the web mock vault",
    );
  }

  const parsed = parseDocumentMarkdown(rawMarkdown);
  const known = parseKnownFrontmatter(parsed.frontmatter);
  return mockStore.updateItem(itemId, {
    title: known.title ?? existing.title,
    description: known.description ?? existing.description,
    url: known.url !== undefined ? known.url : existing.url,
    content_type:
      contentTypeFromFrontmatter(known) ?? existing.content_type,
  });
}

export async function listItemMedia(itemId: string): Promise<MediaWithPath[]> {
  ensureWarmedUp();
  if (!mockStore.isDiskVault()) {
    return [];
  }

  const url = `${DEV_VAULT_ITEM_MEDIA_PATH}?itemId=${encodeURIComponent(itemId)}`;
  const response = await fetch(url);
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`Dev vault item media failed (${response.status}): ${url}`);
  }
  return (await response.json()) as MediaWithPath[];
}

export async function resolveItemThumbnailPath(
  item: ItemFile,
): Promise<string | null> {
  ensureWarmedUp();

  if (mockStore.isDiskVault()) {
    const resolved = mockStore.getThumbnailUrl(item.id);
    if (resolved !== undefined) {
      return resolved;
    }
  }

  if (!item.thumbnail) {
    return null;
  }
  if (
    item.thumbnail.startsWith("https://") ||
    item.thumbnail.startsWith("http://") ||
    item.thumbnail.startsWith("/")
  ) {
    return item.thumbnail;
  }
  if (mockStore.isDiskVault()) {
    const relativePath = resolveItemThumbnailAbsolutePath("", item.id, item.thumbnail);
    return relativePath ? devVaultFsUrl(relativePath) : null;
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

  const tag_ids =
    input.tags !== undefined
      ? input.tags.map((name) => mockStore.ensureTagByName(name).id)
      : existing.tag_ids;

  return mockStore.updateItem(itemId, {
    title: input.title ?? existing.title,
    description: input.description ?? existing.description,
    url: input.url !== undefined ? input.url : existing.url,
    content_type: input.content_type ?? existing.content_type,
    tag_ids,
    folder_path: input.folder_path ?? existing.folder_path,
  });
}
