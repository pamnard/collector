import type {
  ItemFile,
  MediaFileMeta,
  Tag,
  VaultMeta,
} from "@collector/shared";
import type { SqlExecutor } from "@collector/db";
import type {
  IndexedItem,
  IndexedItemMetadata,
  ItemContentUpsert,
  AdjacentItemAnchor,
  AdjacentItemsResult,
  ItemIdListOptions,
  ItemIdPageOptions,
  ItemIdRewriteMapping,
  ItemSyncMetaPatch,
  ReconcileFingerprint,
  VaultIndexAdapter,
} from "../adapters/types.js";
import type { NavSearchFilter } from "../search/nav-filter.js";
import { INDEX_SYNC_WRITE_BATCH } from "../util/concurrency.js";
import { serializeReconcileFingerprint } from "../vault/reconcile-fingerprint.js";
import {
  replaceItemCollections,
  replaceItemTags,
  serializeMetadata,
  serializeProperties,
  sqlCollectionStubPlaceholders,
  sqlInPlaceholders,
  SQL_INSERT_CHUNK,
  sqlRowPlaceholders,
} from "./sql-index-helpers.js";
import * as indexQueries from "./sql-index-queries.js";
import { rewriteItemIds as rewriteItemIdsImpl } from "./sql-index-rewrite.js";

type TagWithCount = Tag & { item_count: number };

export class SqlVaultIndexAdapter implements VaultIndexAdapter {
  constructor(private readonly db: SqlExecutor) {}

  async upsertVault(meta: VaultMeta, vaultPath: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO vaults (
        id, path, name, description, is_default, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        path = excluded.path,
        name = excluded.name,
        description = excluded.description,
        is_default = excluded.is_default,
        updated_at = excluded.updated_at`,
      [
        meta.id,
        vaultPath,
        meta.name,
        meta.description,
        meta.is_default ? 1 : 0,
        meta.created_at,
        meta.updated_at,
      ],
    );
  }

  async deleteVault(vaultId: string): Promise<void> {
    await this.db.execute("DELETE FROM vaults WHERE id = ?", [vaultId]);
  }

  async upsertItem(record: IndexedItem, vaultId: string): Promise<void> {
    await this.upsertItemMetadata(
      { item: record.item, fileMtimeMs: record.fileMtimeMs },
      vaultId,
    );
    await this.upsertItemContent({
      itemId: record.item.id,
      title: record.item.title,
      description: record.item.description,
      content: record.content,
      hasContentFile: record.hasContentFile,
      sourceRef: record.sourceRef,
    });
  }

  async upsertItemMetadata(
    record: IndexedItemMetadata,
    vaultId: string,
  ): Promise<void> {
    const { item } = record;

    // No multi-IPC BEGIN/COMMIT: sqlx pool uses a new connection per execute (#49/#77).
    await this.db.execute(
      `INSERT INTO items (
        id, vault_id, title, description, url, content_type, source_type, source_id,
        metadata_json, properties_json, thumbnail_path, has_content_file,
        folder_path, created_at, updated_at, file_mtime_ms, content_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        vault_id = excluded.vault_id,
        title = excluded.title,
        description = excluded.description,
        url = excluded.url,
        content_type = excluded.content_type,
        source_type = excluded.source_type,
        source_id = excluded.source_id,
        metadata_json = excluded.metadata_json,
        properties_json = excluded.properties_json,
        thumbnail_path = excluded.thumbnail_path,
        folder_path = excluded.folder_path,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        file_mtime_ms = excluded.file_mtime_ms,
        content_revision = excluded.content_revision`,
      [
        item.id,
        vaultId,
        item.title,
        item.description,
        item.url ?? null,
        item.content_type,
        item.source_type,
        item.source_id ?? null,
        serializeMetadata(item.metadata),
        serializeProperties(item.properties),
        item.thumbnail ?? null,
        0,
        item.folder_path ?? "",
        item.created_at,
        item.updated_at,
        record.fileMtimeMs ?? null,
        item.content_revision,
      ],
    );

    await replaceItemTags(this.db, item.id, item.tag_ids);
    await replaceItemCollections(
      this.db,
      item.id,
      vaultId,
      item.collection_ids,
      item.created_at,
      item.updated_at,
    );

    // FTS document is written only by upsertItemContent after the content read.
  }

  async upsertItemMetadataBatch(
    records: IndexedItemMetadata[],
    vaultId: string,
  ): Promise<void> {
    for (
      let offset = 0;
      offset < records.length;
      offset += INDEX_SYNC_WRITE_BATCH
    ) {
      const chunk = records.slice(offset, offset + INDEX_SYNC_WRITE_BATCH);
      const itemBinds: unknown[] = [];
      const itemIds: string[] = [];
      const tagLinks: Array<{ itemId: string; tagId: string }> = [];
      const collectionLinks: Array<{
        itemId: string;
        collectionId: string;
        createdAt: string;
        updatedAt: string;
      }> = [];

      for (const record of chunk) {
        const { item } = record;
        itemIds.push(item.id);
        itemBinds.push(
          item.id,
          vaultId,
          item.title,
          item.description,
          item.url ?? null,
          item.content_type,
          item.source_type,
          item.source_id ?? null,
          serializeMetadata(item.metadata),
          serializeProperties(item.properties),
          item.thumbnail ?? null,
          0,
          item.folder_path ?? "",
          item.created_at,
          item.updated_at,
          record.fileMtimeMs ?? null,
          item.content_revision,
        );
        for (const tagId of item.tag_ids) {
          tagLinks.push({ itemId: item.id, tagId });
        }
        for (const collectionId of item.collection_ids) {
          collectionLinks.push({
            itemId: item.id,
            collectionId,
            createdAt: item.created_at,
            updatedAt: item.updated_at,
          });
        }
      }

      await this.db.execute(
        `INSERT INTO items (
          id, vault_id, title, description, url, content_type, source_type, source_id,
          metadata_json, properties_json, thumbnail_path, has_content_file,
          folder_path, created_at, updated_at, file_mtime_ms, content_revision
        ) VALUES ${sqlRowPlaceholders(chunk.length, 17)}
        ON CONFLICT(id) DO UPDATE SET
          vault_id = excluded.vault_id,
          title = excluded.title,
          description = excluded.description,
          url = excluded.url,
          content_type = excluded.content_type,
          source_type = excluded.source_type,
          source_id = excluded.source_id,
          metadata_json = excluded.metadata_json,
          properties_json = excluded.properties_json,
          thumbnail_path = excluded.thumbnail_path,
          folder_path = excluded.folder_path,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          file_mtime_ms = excluded.file_mtime_ms,
          content_revision = excluded.content_revision`,
        itemBinds,
      );

      await this.db.execute(
        `DELETE FROM item_tags WHERE item_id IN (${sqlInPlaceholders(itemIds.length)})`,
        itemIds,
      );
      for (let linkOffset = 0; linkOffset < tagLinks.length; linkOffset += SQL_INSERT_CHUNK) {
        const links = tagLinks.slice(linkOffset, linkOffset + SQL_INSERT_CHUNK);
        await this.db.execute(
          `INSERT INTO item_tags (item_id, tag_id) VALUES ${sqlRowPlaceholders(links.length, 2)}`,
          links.flatMap((link) => [link.itemId, link.tagId]),
        );
      }

      await this.db.execute(
        `DELETE FROM item_collections WHERE item_id IN (${sqlInPlaceholders(itemIds.length)})`,
        itemIds,
      );
      for (
        let linkOffset = 0;
        linkOffset < collectionLinks.length;
        linkOffset += SQL_INSERT_CHUNK
      ) {
        const links = collectionLinks.slice(
          linkOffset,
          linkOffset + SQL_INSERT_CHUNK,
        );
        await this.db.execute(
          `INSERT INTO collections (
            id, vault_id, parent_id, name, description, created_at, updated_at
          ) VALUES ${sqlCollectionStubPlaceholders(links.length)}
          ON CONFLICT(id) DO NOTHING`,
          links.flatMap((link) => [
            link.collectionId,
            vaultId,
            link.collectionId,
            link.createdAt,
            link.updatedAt,
          ]),
        );
        await this.db.execute(
          `INSERT INTO item_collections (item_id, collection_id)
           VALUES ${sqlRowPlaceholders(links.length, 2)}`,
          links.flatMap((link) => [link.itemId, link.collectionId]),
        );
      }
    }
  }

  async upsertItemContent(input: ItemContentUpsert): Promise<void> {
    const { itemId, title, description, content, hasContentFile, sourceRef } =
      input;

    await this.db.execute(
      "UPDATE items SET has_content_file = ? WHERE id = ?",
      [hasContentFile ? 1 : 0, itemId],
    );

    await this.db.execute("DELETE FROM items_fts WHERE item_id = ?", [itemId]);
    await this.db.execute(
      "INSERT INTO items_fts (item_id, title, description, content) VALUES (?, ?, ?, ?)",
      [itemId, title, description, content ?? ""],
    );

    if (sourceRef) {
      await this.db.execute("DELETE FROM source_refs WHERE item_id = ?", [
        itemId,
      ]);
      await this.db.execute(
        "DELETE FROM source_refs WHERE plugin_id = ? AND external_id = ?",
        [sourceRef.plugin_id, sourceRef.external_id],
      );
      await this.db.execute(
        `INSERT INTO source_refs (
          id, item_id, plugin_id, external_id, synced_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          itemId,
          sourceRef.plugin_id,
          sourceRef.external_id,
          sourceRef.synced_at ?? null,
          serializeMetadata(sourceRef.metadata ?? {}),
        ],
      );
    }
  }

  async upsertItemContentBatch(inputs: ItemContentUpsert[]): Promise<void> {
    for (
      let offset = 0;
      offset < inputs.length;
      offset += INDEX_SYNC_WRITE_BATCH
    ) {
      const chunk = inputs.slice(offset, offset + INDEX_SYNC_WRITE_BATCH);
      const itemIds = chunk.map((input) => input.itemId);
      const hasContentBinds: unknown[] = [];
      for (const input of chunk) {
        hasContentBinds.push(input.itemId, input.hasContentFile ? 1 : 0);
      }
      await this.db.execute(
        `UPDATE items
         SET has_content_file = CASE id ${chunk.map(() => "WHEN ? THEN ?").join(" ")} END
         WHERE id IN (${sqlInPlaceholders(itemIds.length)})`,
        [...hasContentBinds, ...itemIds],
      );

      await this.db.execute(
        `DELETE FROM items_fts WHERE item_id IN (${sqlInPlaceholders(itemIds.length)})`,
        itemIds,
      );
      await this.db.execute(
        `INSERT INTO items_fts (item_id, title, description, content)
         VALUES ${sqlRowPlaceholders(chunk.length, 4)}`,
        chunk.flatMap((input) => [
          input.itemId,
          input.title,
          input.description,
          input.content ?? "",
        ]),
      );

      const inputsWithSourceRefs = chunk.filter(
        (input): input is ItemContentUpsert & { sourceRef: NonNullable<ItemContentUpsert["sourceRef"]> } =>
          input.sourceRef !== null,
      );
      if (inputsWithSourceRefs.length === 0) {
        continue;
      }

      await this.db.execute(
        `DELETE FROM source_refs WHERE item_id IN (${sqlInPlaceholders(inputsWithSourceRefs.length)})`,
        inputsWithSourceRefs.map((input) => input.itemId),
      );
      await this.db.execute(
        `DELETE FROM source_refs
         WHERE (plugin_id, external_id) IN (${sqlRowPlaceholders(inputsWithSourceRefs.length, 2)})`,
        inputsWithSourceRefs.flatMap((input) => [
          input.sourceRef.plugin_id,
          input.sourceRef.external_id,
        ]),
      );

      const latestByExternalRef = new Map<string, (typeof inputsWithSourceRefs)[number]>();
      for (const input of inputsWithSourceRefs) {
        latestByExternalRef.set(
          `${input.sourceRef.plugin_id}\u0000${input.sourceRef.external_id}`,
          input,
        );
      }
      const sourceRefInputs = [...latestByExternalRef.values()];
      await this.db.execute(
        `INSERT INTO source_refs (
          id, item_id, plugin_id, external_id, synced_at, metadata_json
        ) VALUES ${sqlRowPlaceholders(sourceRefInputs.length, 6)}`,
        sourceRefInputs.flatMap((input) => [
          crypto.randomUUID(),
          input.itemId,
          input.sourceRef.plugin_id,
          input.sourceRef.external_id,
          input.sourceRef.synced_at ?? null,
          serializeMetadata(input.sourceRef.metadata ?? {}),
        ]),
      );
    }
  }

  async upsertMedia(media: MediaFileMeta): Promise<void> {
    await this.db.execute(
      `INSERT INTO media (id, item_id, filename, media_type, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         item_id = excluded.item_id,
         filename = excluded.filename,
         media_type = excluded.media_type,
         created_at = excluded.created_at`,
      [media.id, media.item_id, media.filename, media.media_type, media.created_at],
    );
  }

  async deleteMedia(mediaId: string): Promise<void> {
    await this.db.execute("DELETE FROM media WHERE id = ?", [mediaId]);
  }

  async deleteMediaForItem(itemId: string): Promise<void> {
    await this.db.execute("DELETE FROM media WHERE item_id = ?", [itemId]);
  }

  async deleteItem(itemId: string): Promise<void> {
    await this.db.execute("DELETE FROM media WHERE item_id = ?", [itemId]);
    await this.db.execute("DELETE FROM source_refs WHERE item_id = ?", [itemId]);
    await this.db.execute("DELETE FROM items_fts WHERE item_id = ?", [itemId]);
    await this.db.execute("DELETE FROM item_embeddings WHERE item_id = ?", [
      itemId,
    ]);
    await this.db.execute("DELETE FROM items WHERE id = ?", [itemId]);
  }

  async rewriteItemIds(_mappings: ItemIdRewriteMapping[]): Promise<void> {
    throw new Error(
      "rewriteItemIds requires select(); use SqlVaultIndexStore instead",
    );
  }

  async upsertTag(tag: Tag, vaultId: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO tags (id, vault_id, name, color, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         color = excluded.color`,
      [tag.id, vaultId, tag.name, tag.color ?? null, tag.created_at],
    );
  }

  async deleteTag(tagId: string): Promise<void> {
    await this.db.execute("DELETE FROM item_tags WHERE tag_id = ?", [tagId]);
    await this.db.execute("DELETE FROM tags WHERE id = ?", [tagId]);
  }

  async listTagsWithCounts(_vaultId: string): Promise<TagWithCount[]> {
    throw new Error(
      "listTagsWithCounts requires select(); use SqlVaultIndexStore instead",
    );
  }

  async listItemIdsByTag(
    _vaultId: string,
    _tagId: string,
    _options?: ItemIdListOptions,
  ): Promise<string[]> {
    throw new Error(
      "listItemIdsByTag requires select(); use SqlVaultIndexStore instead",
    );
  }

  async listItemIdsByFolderPrefix(
    _vaultId: string,
    _folderPath: string,
    _options?: ItemIdListOptions,
  ): Promise<string[]> {
    throw new Error(
      "listItemIdsByFolderPrefix requires select(); use SqlVaultIndexStore instead",
    );
  }

  async getAdjacentItems(
    _vaultId: string,
    _anchor: AdjacentItemAnchor,
  ): Promise<AdjacentItemsResult> {
    throw new Error(
      "getAdjacentItems requires select(); use SqlVaultIndexStore instead",
    );
  }

  async listItemIdsByNavFilter(
    _vaultId: string,
    _filter: NavSearchFilter,
    _options?: ItemIdPageOptions,
  ): Promise<string[]> {
    throw new Error(
      "listItemIdsByNavFilter requires select(); use SqlVaultIndexStore instead",
    );
  }

  async countItemIdsByNavFilter(
    _vaultId: string,
    _filter: NavSearchFilter,
  ): Promise<number> {
    throw new Error(
      "countItemIdsByNavFilter requires select(); use SqlVaultIndexStore instead",
    );
  }

  async listFolderItemCounts(_vaultId: string): Promise<
    Array<{ folder_path: string; item_count: number }>
  > {
    throw new Error(
      "listFolderItemCounts requires select(); use SqlVaultIndexStore instead",
    );
  }

  async listVaultItemIds(_vaultId: string): Promise<string[]> {
    throw new Error(
      "listVaultItemIds requires select(); use SqlVaultIndexStore instead",
    );
  }

  async listItemFilesByIds(
    _vaultId: string,
    _itemIds: string[],
  ): Promise<ItemFile[]> {
    throw new Error(
      "listItemFilesByIds requires select(); use SqlVaultIndexStore instead",
    );
  }

  async patchItemSyncMeta(
    itemId: string,
    meta: {
      fileMtimeMs: number;
      updatedAt: string;
      contentRevision: number;
      createdAt: string;
    },
  ): Promise<void> {
    await this.db.execute(
      `UPDATE items
       SET file_mtime_ms = ?, updated_at = ?, content_revision = ?, created_at = ?
       WHERE id = ?`,
      [
        meta.fileMtimeMs,
        meta.updatedAt,
        meta.contentRevision,
        meta.createdAt,
        itemId,
      ],
    );
  }

  async patchItemSyncMetaBatch(
    patches: Array<{ itemId: string } & ItemSyncMetaPatch>,
  ): Promise<void> {
    for (
      let offset = 0;
      offset < patches.length;
      offset += INDEX_SYNC_WRITE_BATCH
    ) {
      const chunk = patches.slice(offset, offset + INDEX_SYNC_WRITE_BATCH);
      const itemIds = chunk.map((patch) => patch.itemId);
      const caseBinds = (value: (patch: (typeof chunk)[number]) => unknown) =>
        chunk.flatMap((patch) => [patch.itemId, value(patch)]);
      await this.db.execute(
        `UPDATE items
         SET file_mtime_ms = CASE id ${chunk.map(() => "WHEN ? THEN ?").join(" ")} END,
             updated_at = CASE id ${chunk.map(() => "WHEN ? THEN ?").join(" ")} END,
             content_revision = CASE id ${chunk.map(() => "WHEN ? THEN ?").join(" ")} END,
             created_at = CASE id ${chunk.map(() => "WHEN ? THEN ?").join(" ")} END
         WHERE id IN (${sqlInPlaceholders(itemIds.length)})`,
        [
          ...caseBinds((patch) => patch.fileMtimeMs),
          ...caseBinds((patch) => patch.updatedAt),
          ...caseBinds((patch) => patch.contentRevision),
          ...caseBinds((patch) => patch.createdAt),
          ...itemIds,
        ],
      );
    }
  }

  async getReconcileFingerprint(
    _vaultId: string,
  ): Promise<ReconcileFingerprint | null> {
    throw new Error(
      "getReconcileFingerprint requires select(); use SqlVaultIndexStore instead",
    );
  }

  async setReconcileFingerprint(
    vaultId: string,
    fingerprint: ReconcileFingerprint,
  ): Promise<void> {
    await this.db.execute(
      `UPDATE vaults SET reconcile_fingerprint_json = ? WHERE id = ?`,
      [serializeReconcileFingerprint(fingerprint), vaultId],
    );
  }

  async listVaultItemSyncMeta(_vaultId: string): Promise<
    Array<{
      id: string;
      file_mtime_ms: number | null;
      updated_at: string;
      content_revision: number;
      created_at: string;
    }>
  > {
    throw new Error(
      "listVaultItemSyncMeta requires select(); use SqlVaultIndexStore instead",
    );
  }

  async listItemSyncMetaByIds(
    _vaultId: string,
    _itemIds: string[],
  ): Promise<
    Array<{
      id: string;
      file_mtime_ms: number | null;
      updated_at: string;
      content_revision: number;
      created_at: string;
    }>
  > {
    throw new Error(
      "listItemSyncMetaByIds requires select(); use SqlVaultIndexStore instead",
    );
  }

  async searchItemIds(
    _vaultId: string,
    _ftsQuery: string,
    _filter: NavSearchFilter,
    _options?: ItemIdPageOptions,
  ): Promise<string[]> {
    throw new Error(
      "searchItemIds requires select(); use SqlVaultIndexStore instead",
    );
  }

  async countSearchItemIds(
    _vaultId: string,
    _ftsQuery: string,
    _filter: NavSearchFilter,
  ): Promise<number> {
    throw new Error(
      "countSearchItemIds requires select(); use SqlVaultIndexStore instead",
    );
  }
}

export interface SqlSelectRow {
  id: string;
}

export interface SqlSelector {
  select<T>(query: string, bindValues?: unknown[]): Promise<T[]>;
}

export class SqlVaultIndexStore extends SqlVaultIndexAdapter {
  constructor(private readonly selector: SqlSelector & SqlExecutor) {
    super(selector);
  }

  async listItemIdTitles(
    vaultId: string,
  ): Promise<Array<{ id: string; title: string }>> {
    return this.selector.select<{ id: string; title: string }>(
      `SELECT id, title FROM items WHERE vault_id = ?`,
      [vaultId],
    );
  }

  override async upsertTag(tag: Tag, vaultId: string): Promise<void> {
    // Disk may recreate a tag id for an existing name; prefer the disk id and
    // drop the stale index row so UNIQUE(vault_id, name) does not fail.
    const stale = await this.selector.select<{ id: string }>(
      `SELECT id FROM tags WHERE vault_id = ? AND name = ? AND id != ?`,
      [vaultId, tag.name, tag.id],
    );
    for (const row of stale) {
      await this.selector.execute(
        `INSERT OR IGNORE INTO item_tags (item_id, tag_id)
         SELECT item_id, ? FROM item_tags WHERE tag_id = ?`,
        [tag.id, row.id],
      );
      await this.selector.execute(`DELETE FROM item_tags WHERE tag_id = ?`, [
        row.id,
      ]);
      await this.selector.execute(`DELETE FROM tags WHERE id = ?`, [row.id]);
    }

    await super.upsertTag(tag, vaultId);
  }

  override async rewriteItemIds(
    mappings: ItemIdRewriteMapping[],
  ): Promise<void> {
    return rewriteItemIdsImpl(this.selector, mappings);
  }

  override async listVaultItemIds(vaultId: string): Promise<string[]> {
    return indexQueries.listVaultItemIds(this.selector, vaultId);
  }

  override async listItemFilesByIds(
    vaultId: string,
    itemIds: string[],
  ): Promise<ItemFile[]> {
    return indexQueries.listItemFilesByIds(this.selector, vaultId, itemIds);
  }

  override async listVaultItemSyncMeta(vaultId: string): Promise<
    Array<{
      id: string;
      file_mtime_ms: number | null;
      updated_at: string;
      content_revision: number;
      created_at: string;
    }>
  > {
    return indexQueries.listVaultItemSyncMeta(this.selector, vaultId);
  }

  override async listItemSyncMetaByIds(
    vaultId: string,
    itemIds: string[],
  ): Promise<
    Array<{
      id: string;
      file_mtime_ms: number | null;
      updated_at: string;
      content_revision: number;
      created_at: string;
    }>
  > {
    return indexQueries.listItemSyncMetaByIds(
      this.selector,
      vaultId,
      itemIds,
    );
  }

  override async getReconcileFingerprint(
    vaultId: string,
  ): Promise<ReconcileFingerprint | null> {
    return indexQueries.getReconcileFingerprint(this.selector, vaultId);
  }

  override async searchItemIds(
    vaultId: string,
    ftsQuery: string,
    filter: NavSearchFilter,
    options?: ItemIdPageOptions,
  ): Promise<string[]> {
    return indexQueries.searchItemIds(
      this.selector,
      vaultId,
      ftsQuery,
      filter,
      options,
    );
  }

  override async countSearchItemIds(
    vaultId: string,
    ftsQuery: string,
    filter: NavSearchFilter,
  ): Promise<number> {
    return indexQueries.countSearchItemIds(
      this.selector,
      vaultId,
      ftsQuery,
      filter,
    );
  }

  override async listTagsWithCounts(vaultId: string): Promise<TagWithCount[]> {
    return indexQueries.listTagsWithCounts(this.selector, vaultId);
  }

  override async listItemIdsByTag(
    vaultId: string,
    tagId: string,
    options?: ItemIdListOptions,
  ): Promise<string[]> {
    return indexQueries.listItemIdsByTag(
      this.selector,
      vaultId,
      tagId,
      options,
    );
  }

  override async listItemIdsByFolderPrefix(
    vaultId: string,
    folderPath: string,
    options?: ItemIdListOptions,
  ): Promise<string[]> {
    return indexQueries.listItemIdsByFolderPrefix(
      this.selector,
      vaultId,
      folderPath,
      options,
    );
  }

  override async getAdjacentItems(
    vaultId: string,
    anchor: AdjacentItemAnchor,
  ): Promise<AdjacentItemsResult> {
    return indexQueries.getAdjacentItems(this.selector, vaultId, anchor);
  }

  override async listItemIdsByNavFilter(
    vaultId: string,
    filter: NavSearchFilter,
    options?: ItemIdPageOptions,
  ): Promise<string[]> {
    return indexQueries.listItemIdsByNavFilter(
      this.selector,
      vaultId,
      filter,
      options,
    );
  }

  override async countItemIdsByNavFilter(
    vaultId: string,
    filter: NavSearchFilter,
  ): Promise<number> {
    return indexQueries.countItemIdsByNavFilter(
      this.selector,
      vaultId,
      filter,
    );
  }

  override async listFolderItemCounts(
    vaultId: string,
  ): Promise<Array<{ folder_path: string; item_count: number }>> {
    return indexQueries.listFolderItemCounts(this.selector, vaultId);
  }
}
