/**
 * Item read/write ops extracted from items-search factory (#384).
 */

import type {
  AdjacentItemsResult,
  BacklinkSource,
  CreateItemInput,
  GetItemResult,
  ResolvedTextLink,
  UpdateItemInput,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import { folderPathFromItemPath } from "@collector/shared";
import {
  createFolder as createFolderOnVault,
  deleteItem as deleteItemOnDisk,
  ensureTagsByName,
  itemMarkdownPath,
  loadTagMaps,
  moveItemToFolder,
  parseAndResolveTextLinks,
  parseDocumentMarkdown,
  readItemContent,
  readItemFile,
  readItemRawMarkdown,
  resolveOrCreateInboxFolder,
  serializeItemDocument,
  textLinkResolveContextFromItems,
  upsertItem,
  writeItemRawMarkdown,
  type AdjacentItemAnchor,
} from "@collector/core";
import { getBacklinksForTarget } from "./backlinks-reverse-cache.js";
import type { ItemsSearchServiceDeps } from "./items-search.js";
import type { VaultPresentationChangedPayload } from "./vault-presentation-changed.js";

export type ItemsCrud = {
  getItemById(itemId: string): Promise<GetItemResult>;
  getAdjacentItems(itemId: string): Promise<AdjacentItemsResult>;
  resolveContentTextLinks(
    itemId: string,
    body: string,
  ): Promise<ResolvedTextLink[]>;
  listItemBacklinks(itemId: string): Promise<BacklinkSource[]>;
  getItemSource(itemId: string): Promise<string>;
  updateItemSource(itemId: string, rawMarkdown: string): Promise<ItemFile>;
  createItem(input: CreateItemInput): Promise<ItemFile>;
  updateItem(itemId: string, input: UpdateItemInput): Promise<ItemFile>;
  deleteItem(itemId: string): Promise<void>;
};

export function createItemsCrud(
  deps: ItemsSearchServiceDeps,
  newItemId: () => string,
): ItemsCrud {
  const getItemById = async (itemId: string): Promise<GetItemResult> => {
    const { path, vault } = await deps.resolveActiveVault();
    const ctx = deps.getContext();

    if (!(await ctx.fs.exists(itemMarkdownPath(path, itemId)))) {
      throw new Error(`Item not found: ${itemId}`);
    }

    const item = await readItemFile(ctx.fs, path, itemId, vault.id);
    const content = await readItemContent(ctx.fs, path, itemId);
    return { item, content };
  };

  const getAdjacentItems = async (
    itemId: string,
  ): Promise<AdjacentItemsResult> => {
    const { vault, path } = await deps.resolveActiveVault();
    const index = deps.getIndex();
    const indexed = await index.listItemFilesByIds(vault.id, [itemId]);
    let anchor: AdjacentItemAnchor | null = null;
    const fromIndex = indexed[0];
    if (fromIndex) {
      anchor = {
        id: fromIndex.id,
        folder_path: fromIndex.folder_path,
        created_at: fromIndex.created_at,
      };
    } else {
      const ctx = deps.getContext();
      if (await ctx.fs.exists(itemMarkdownPath(path, itemId))) {
        const item = await readItemFile(ctx.fs, path, itemId, vault.id);
        anchor = {
          id: item.id,
          folder_path: item.folder_path,
          created_at: item.created_at,
        };
      }
    }
    if (!anchor) {
      return { prev: null, next: null };
    }
    return index.getAdjacentItems(vault.id, anchor);
  };

  const resolveContentTextLinks = async (
    itemId: string,
    body: string,
  ): Promise<ResolvedTextLink[]> => {
    const { vault } = await deps.resolveActiveVault();
    const items = await deps.getIndex().listItemIdTitles(vault.id);
    return parseAndResolveTextLinks(
      body,
      textLinkResolveContextFromItems(itemId, items),
    );
  };

  const listItemBacklinks = async (
    itemId: string,
  ): Promise<BacklinkSource[]> => {
    const { vault } = await deps.resolveActiveVault();
    const index = deps.getIndex();
    const generation = await index.vaultItemsContentGeneration(vault.id);
    return getBacklinksForTarget({
      vaultId: vault.id,
      targetItemId: itemId,
      generation,
      loadCatalog: () => index.listItemIdTitles(vault.id),
      loadBodies: () => index.listItemFtsBodies(vault.id),
      bodyFromContent: (content) => parseDocumentMarkdown(content).body,
    });
  };

  const getItemSource = async (itemId: string): Promise<string> => {
    const { path } = await deps.resolveActiveVault();
    const ctx = deps.getContext();
    if (!(await ctx.fs.exists(itemMarkdownPath(path, itemId)))) {
      throw new Error(`Item not found: ${itemId}`);
    }
    return readItemRawMarkdown(ctx.fs, path, itemId);
  };

  /** Normalize and write only when text changes. Caller owns presentation notify. */
  const applyNormalizedSource = async (
    itemId: string,
    rawMarkdown: string,
  ): Promise<{ item: ItemFile; wrote: boolean }> => {
    const { vault, path } = await deps.resolveActiveVault();
    const ctx = deps.getContext();
    const { text } = deps.normalizeMarkdown(rawMarkdown);
    const existing = await readItemRawMarkdown(ctx.fs, path, itemId);
    if (text === existing) {
      return {
        item: await readItemFile(ctx.fs, path, itemId, vault.id),
        wrote: false,
      };
    }
    const item = await writeItemRawMarkdown(
      ctx,
      path,
      vault.id,
      itemId,
      text,
    );
    return { item, wrote: true };
  };

  const notifyItemUpserted = (
    vaultId: string,
    item: ItemFile,
    move?: { fromFolderPath: string; toFolderPath: string },
  ): void => {
    const payload: VaultPresentationChangedPayload = {
      vaultId,
      kind: "itemUpserted",
      itemId: item.id,
      folderPath: item.folder_path,
      ...(move
        ? {
            fromFolderPath: move.fromFolderPath,
            toFolderPath: move.toFolderPath,
          }
        : {}),
    };
    deps.onVaultPresentationChanged?.(payload);
  };

  const persistNormalizedSource = async (
    itemId: string,
    rawMarkdown: string,
    move?: { fromFolderPath: string; toFolderPath: string },
  ): Promise<ItemFile> => {
    const { vault } = await deps.resolveActiveVault();
    const { item, wrote } = await applyNormalizedSource(itemId, rawMarkdown);
    // Move always changes presentation even when body bytes are unchanged.
    if (wrote || move) {
      notifyItemUpserted(vault.id, item, move);
    }
    return item;
  };

  const createItem = async (input: CreateItemInput): Promise<ItemFile> => {
    const { vault, path } = await deps.resolveActiveVault();
    const ctx = deps.getContext();
    const timestamp = new Date().toISOString();
    let folderPath = input.folder_path?.trim() ?? "";
    if (!folderPath) {
      folderPath = await resolveOrCreateInboxFolder(ctx, path);
    } else {
      await createFolderOnVault(ctx, path, folderPath);
    }
    const fileName = `${newItemId()}.md`;
    const id = `${folderPath}/${fileName}`;

    const created = await upsertItem(ctx, path, vault.id, {
      item: {
        id,
        vault_id: vault.id,
        title: input.title,
        description: input.description ?? "",
        url: input.url ?? null,
        content_type: input.content_type,
        source_type: input.source_type ?? "manual",
        metadata: {},
        properties: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: folderPath,
        content_revision: 1,
        word_count: 0,
        character_count: 0,
        created_at: timestamp,
        updated_at: timestamp,
      },
      content: input.content ?? null,
      sourceRef: input.sourceRef,
    });
    // Same serialize→normalize→write path as update: upsert wrote the document;
    // applyNormalizedSource autofixes before leaving dirty body on disk.
    const raw = await readItemRawMarkdown(ctx.fs, path, created.id);
    const { item } = await applyNormalizedSource(created.id, raw);
    // Create always changes vault presentation (new item), even when normalize is a no-op.
    notifyItemUpserted(vault.id, item);
    return item;
  };

  const updateItem = async (
    itemId: string,
    input: UpdateItemInput,
  ): Promise<ItemFile> => {
    const { path } = await deps.resolveActiveVault();
    const { item: existing, content: existingContent } =
      await getItemById(itemId);
    const ctx = deps.getContext();

    let current = existing;
    let currentContent = existingContent;
    let move:
      | { fromFolderPath: string; toFolderPath: string }
      | undefined;
    if (
      input.folder_path !== undefined &&
      input.folder_path !== existing.folder_path
    ) {
      move = {
        fromFolderPath: existing.folder_path,
        toFolderPath: input.folder_path,
      };
      current = await moveItemToFolder(
        ctx,
        path,
        existing.vault_id,
        existing.id,
        input.folder_path,
      );
      currentContent = await readItemContent(ctx.fs, path, current.id);
    }

    let maps = await loadTagMaps(ctx.fs, path);
    let tagIds = current.tag_ids;
    if (input.tags !== undefined) {
      maps = await ensureTagsByName(ctx.fs, path, input.tags, maps);
      tagIds = input.tags.map((rawName) => {
        const name = rawName.trim();
        const tag = maps.byName.get(name.toLowerCase());
        if (!tag) {
          throw new Error(`Tag not resolved after ensure: ${name}`);
        }
        return tag.id;
      });
    }

    const nextItem: ItemFile = {
      ...current,
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      url: input.url !== undefined ? input.url : current.url,
      content_type: input.content_type ?? current.content_type,
      tag_ids: tagIds,
      properties: input.properties !== undefined ? input.properties : current.properties,
      updated_at: new Date().toISOString(),
    };
    const body =
      input.content !== undefined ? (input.content ?? "") : (currentContent ?? "");
    const markdown = serializeItemDocument(nextItem, body, maps.byId);
    // Same normalize + write path as updateItemSource (every note persist).
    return persistNormalizedSource(nextItem.id, markdown, move);
  };

  const deleteItem = async (itemId: string): Promise<void> => {
    const { vault, path } = await deps.resolveActiveVault();
    const folderPath = folderPathFromItemPath(itemId);
    await deleteItemOnDisk(deps.getContext(), path, itemId);
    deps.onItemDeleted?.(itemId);
    deps.onVaultPresentationChanged?.({
      vaultId: vault.id,
      kind: "itemDeleted",
      itemId,
      folderPath,
    });
  };

  return {
    getItemById,
    getAdjacentItems,
    resolveContentTextLinks,
    listItemBacklinks,
    getItemSource,
    updateItemSource: (itemId, rawMarkdown) =>
      persistNormalizedSource(itemId, rawMarkdown),
    createItem,
    updateItem,
    deleteItem,
  };
}
