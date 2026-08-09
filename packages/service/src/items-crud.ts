/**
 * Item read/write ops extracted from items-search factory (#384).
 */

import type {
  AdjacentItemsResult,
  CreateItemInput,
  GetItemResult,
  ResolvedTextLink,
  UpdateItemInput,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import {
  createFolder as createFolderOnVault,
  deleteItem as deleteItemOnDisk,
  ensureTagsByName,
  itemMarkdownPath,
  loadTagMaps,
  moveItemToFolder,
  parseAndResolveTextLinks,
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
import type { ItemsSearchServiceDeps } from "./items-search.js";

export type ItemsCrud = {
  getItemById(itemId: string): Promise<GetItemResult>;
  getAdjacentItems(itemId: string): Promise<AdjacentItemsResult>;
  resolveContentTextLinks(
    itemId: string,
    body: string,
  ): Promise<ResolvedTextLink[]>;
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

  const getItemSource = async (itemId: string): Promise<string> => {
    const { path } = await deps.resolveActiveVault();
    const ctx = deps.getContext();
    if (!(await ctx.fs.exists(itemMarkdownPath(path, itemId)))) {
      throw new Error(`Item not found: ${itemId}`);
    }
    return readItemRawMarkdown(ctx.fs, path, itemId);
  };

  const updateItemSource = async (
    itemId: string,
    rawMarkdown: string,
  ): Promise<ItemFile> => {
    const { vault, path } = await deps.resolveActiveVault();
    return writeItemRawMarkdown(
      deps.getContext(),
      path,
      vault.id,
      itemId,
      rawMarkdown,
    );
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

    return upsertItem(ctx, path, vault.id, {
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
        created_at: timestamp,
        updated_at: timestamp,
      },
      content: input.content ?? null,
      sourceRef: input.sourceRef,
    });
  };

  const updateItem = async (
    itemId: string,
    input: UpdateItemInput,
  ): Promise<ItemFile> => {
    const { vault, path } = await deps.resolveActiveVault();
    const { item: existing, content: existingContent } =
      await getItemById(itemId);
    const ctx = deps.getContext();

    let current = existing;
    let currentContent = existingContent;
    if (
      input.folder_path !== undefined &&
      input.folder_path !== existing.folder_path
    ) {
      current = await moveItemToFolder(
        ctx,
        path,
        vault.id,
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
    };
    const body =
      input.content !== undefined ? (input.content ?? "") : (currentContent ?? "");
    const markdown = serializeItemDocument(nextItem, body, maps.byId);
    // Same on-disk write + parse/ensure path as updateItemSource.
    return writeItemRawMarkdown(ctx, path, vault.id, nextItem.id, markdown);
  };

  const deleteItem = async (itemId: string): Promise<void> => {
    const { path } = await deps.resolveActiveVault();
    await deleteItemOnDisk(deps.getContext(), path, itemId);
    deps.onItemDeleted?.(itemId);
  };

  return {
    getItemById,
    getAdjacentItems,
    resolveContentTextLinks,
    getItemSource,
    updateItemSource,
    createItem,
    updateItem,
    deleteItem,
  };
}
