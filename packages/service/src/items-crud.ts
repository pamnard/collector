/**
 * Item read/write ops extracted from items-search factory (#384).
 */

import type {
  AdjacentItemsResult,
  BacklinkSource,
  CreateItemInput,
  GetItemResult,
  OutboundTextLink,
  ResolvedTextLink,
  UpdateItemInput,
  UserEdgeNeighbor,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import { folderPathFromItemPath } from "@collector/shared";
import {
  collectOutboundLinks,
  createFolder as createFolderOnVault,
  deleteItem as deleteItemOnDisk,
  ensureTagsByName,
  itemMarkdownPath,
  loadTagMaps,
  mightNeedRemoteDisplayAssetLocalization,
  moveItemToFolder,
  parseAndResolveTextLinks,
  parseDocumentMarkdown,
  readItemContent,
  readItemFile,
  readItemRawMarkdown,
  resolveOrCreateInboxFolder,
  resolveTagFromMaps,
  serializeItemDocument,
  textLinkResolveContextFromItems,
  upsertItem,
  writeItemCanonicalSourceMarkdown,
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
  listItemOutboundLinks(itemId: string): Promise<OutboundTextLink[]>;
  addUserEdge(itemId: string, otherItemId: string): Promise<void>;
  removeUserEdge(itemId: string, otherItemId: string): Promise<void>;
  listUserEdges(itemId: string): Promise<UserEdgeNeighbor[]>;
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

  const listItemOutboundLinks = async (
    itemId: string,
  ): Promise<OutboundTextLink[]> => {
    const { path, vault } = await deps.resolveActiveVault();
    const ctx = deps.getContext();
    if (!(await ctx.fs.exists(itemMarkdownPath(path, itemId)))) {
      throw new Error(`Item not found: ${itemId}`);
    }
    const content = await readItemContent(ctx.fs, path, itemId);
    if (content === null) {
      throw new Error(`Item not found: ${itemId}`);
    }
    const catalog = await deps.getIndex().listItemIdTitles(vault.id);
    return collectOutboundLinks(itemId, content, catalog);
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

  /** Normalize on persist (sync); localize runs in itemDerivedRefresh job (#768). */
  const enqueueExtractAutoForItem = async (
    vaultId: string,
    vaultPath: string,
    item: ItemFile,
  ): Promise<void> => {
    await deps.enqueueItemExtractAuto({
      vaultId,
      vaultPath,
      itemId: item.id,
      contentRevision: item.content_revision,
    });
  };

  const applyNormalizedSource = async (
    itemId: string,
    rawMarkdown: string,
    itemUrl?: string | null,
  ): Promise<{ item: ItemFile; wrote: boolean }> => {
    const { vault, path } = await deps.resolveActiveVault();
    const ctx = deps.getContext();
    const { text: normalized } = deps.normalizeMarkdown(rawMarkdown);
    const { item, wrote } = await writeItemCanonicalSourceMarkdown(
      ctx,
      path,
      vault.id,
      itemId,
      normalized,
    );
    if (wrote) {
      await enqueueExtractAutoForItem(vault.id, path, item);
    }

    if (
      !wrote &&
      mightNeedRemoteDisplayAssetLocalization(normalized, itemUrl)
    ) {
      const docPath = itemMarkdownPath(path, itemId);
      const fileStat = await ctx.fs.stat(docPath);
      if (fileStat.mtimeMs === null) {
        throw new Error(
          `applyNormalizedSource: missing file mtime for ${itemId}`,
        );
      }
      await deps.enqueueItemDerivedRefresh({
        vaultId: vault.id,
        vaultPath: path,
        itemId,
        contentRevision: item.content_revision,
        fileMtimeMs: fileStat.mtimeMs,
        itemUrl,
      });
    }

    return { item, wrote };
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

  const persistMetadataOnlySource = async (
    itemId: string,
    markdown: string,
    move?: { fromFolderPath: string; toFolderPath: string },
  ): Promise<ItemFile> => {
    const { vault, path } = await deps.resolveActiveVault();
    const ctx = deps.getContext();
    const item = await writeItemRawMarkdown(
      ctx,
      path,
      vault.id,
      itemId,
      markdown,
    );
    // writeItemRawMarkdown → refreshItemIndexAfterWrite already enqueues derived
    // work (index + item.url for localize) when jobs are wired (#776).
    notifyItemUpserted(vault.id, item, move);
    return item;
  };

  const persistNormalizedSource = async (
    itemId: string,
    rawMarkdown: string,
    itemUrl?: string | null,
    move?: { fromFolderPath: string; toFolderPath: string },
  ): Promise<ItemFile> => {
    const { vault } = await deps.resolveActiveVault();
    const { item, wrote } = await applyNormalizedSource(
      itemId,
      rawMarkdown,
      itemUrl,
    );
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
      deferIndexRefresh: true,
    });
    // Localize is async via itemDerivedRefresh (#768). Create succeeds even when
    // localize will fail later; failures surface via job permanent-failure / AlertStack.
    const raw = await readItemRawMarkdown(ctx.fs, path, created.id);
    const { item, wrote } = await applyNormalizedSource(
      created.id,
      raw,
      created.url,
    );
    // upsert already persisted body; when normalize was a no-op, still enqueue once.
    if (!wrote) {
      await enqueueExtractAutoForItem(vault.id, path, item);
    }
    deps.onVaultPresentationChanged?.({
      vaultId: vault.id,
      kind: "itemCreated",
      itemId: item.id,
      folderPath: item.folder_path,
    });
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

    let preferredTagNames: string[] | undefined;
    if (input.tags !== undefined) {
      preferredTagNames = input.tags.map((tagName) => tagName.trim());
    } else if (current.tag_ids.length > 0) {
      const currentRawMarkdown = await readItemRawMarkdown(ctx.fs, path, current.id);
      const parsedCurrentSource = parseDocumentMarkdown(currentRawMarkdown);
      if (
        Array.isArray(parsedCurrentSource.frontmatter.tags) &&
        parsedCurrentSource.frontmatter.tags.every(
          (tagName): tagName is string => typeof tagName === "string",
        )
      ) {
        preferredTagNames = parsedCurrentSource.frontmatter.tags;
      }
    }

    let maps = await loadTagMaps(ctx.fs, path);
    let tagIds = current.tag_ids;
    if (input.tags !== undefined) {
      maps = await ensureTagsByName(ctx.fs, path, input.tags, maps);
      const seen = new Set<string>();
      tagIds = [];
      for (const rawName of input.tags) {
        const tag = resolveTagFromMaps(maps.byName, rawName);
        if (!tag) {
          throw new Error(`Tag not resolved after ensure: ${rawName}`);
        }
        if (seen.has(tag.id)) {
          continue;
        }
        seen.add(tag.id);
        tagIds.push(tag.id);
      }
    }

    const nextItem: ItemFile = {
      ...current,
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      url: input.url !== undefined ? input.url : current.url,
      content_type: input.content_type ?? current.content_type,
      tag_ids: tagIds,
      metadata:
        input.metadata !== undefined ? input.metadata : current.metadata,
      properties: input.properties !== undefined ? input.properties : current.properties,
      updated_at: new Date().toISOString(),
    };
    const bodyUnchanged =
      input.content === undefined ||
      input.content === (currentContent ?? "");
    if (bodyUnchanged) {
      const markdown = serializeItemDocument(
        nextItem,
        currentContent ?? "",
        maps.byId,
        { preferredTagNames },
      );
      return persistMetadataOnlySource(nextItem.id, markdown, move);
    }

    const body =
      input.content !== undefined ? (input.content ?? "") : (currentContent ?? "");
    const markdown = serializeItemDocument(nextItem, body, maps.byId, {
      preferredTagNames,
    });
    // Same normalize + localize + write path as updateItemSource (every note persist).
    return persistNormalizedSource(nextItem.id, markdown, nextItem.url, move);
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

  const addUserEdge = async (
    itemId: string,
    otherItemId: string,
  ): Promise<void> => {
    const { vault } = await deps.resolveActiveVault();
    await deps.getIndex().addUserEdge(vault.id, itemId, otherItemId);
  };

  const removeUserEdge = async (
    itemId: string,
    otherItemId: string,
  ): Promise<void> => {
    const { vault } = await deps.resolveActiveVault();
    await deps.getIndex().removeUserEdge(vault.id, itemId, otherItemId);
  };

  const listUserEdges = async (
    itemId: string,
  ): Promise<UserEdgeNeighbor[]> => {
    const { vault } = await deps.resolveActiveVault();
    return deps.getIndex().listUserEdges(vault.id, itemId);
  };

  return {
    getItemById,
    getAdjacentItems,
    resolveContentTextLinks,
    listItemBacklinks,
    listItemOutboundLinks,
    addUserEdge,
    removeUserEdge,
    listUserEdges,
    getItemSource,
    updateItemSource: async (itemId, rawMarkdown) => {
      const { item } = await getItemById(itemId);
      return persistNormalizedSource(itemId, rawMarkdown, item.url);
    },
    createItem,
    updateItem,
    deleteItem,
  };
}
