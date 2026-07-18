import type {
  ContentType,
  ItemFile,
  MediaFileMeta,
  SourceType,
  Tag,
  VaultMeta,
} from "@collector/shared";
import type { SqlExecutor } from "@collector/db";
import type {
  IndexedItem,
  IndexedItemMetadata,
  ItemContentUpsert,
  ItemIdListOptions,
  ItemIdPageOptions,
  ItemIdRewriteMapping,
  ItemSyncMetaPatch,
  ReconcileFingerprint,
  VaultIndexAdapter,
} from "../adapters/types.js";
import type { NavSearchFilter } from "../search/nav-filter.js";
import { isFolderFilter, isTagFilter } from "../search/nav-filter.js";
import {
  INDEX_SYNC_WRITE_BATCH,
  INDEX_SYNC_YIELD_MS,
  yieldToEventLoop,
} from "../util/concurrency.js";
import {
  parseStoredReconcileFingerprint,
  serializeReconcileFingerprint,
} from "../vault/reconcile-fingerprint.js";

type TagWithCount = Tag & { item_count: number };

interface ItemRow {
  id: string;
  vault_id: string;
  title: string;
  description: string;
  url: string | null;
  content_type: string;
  source_type: string;
  source_id: string | null;
  metadata_json: string;
  thumbnail_path: string | null;
  folder_path: string;
  content_revision: number;
  created_at: string;
  updated_at: string;
}

interface ItemRewriteRow {
  id: string;
  vault_id: string;
  title: string;
  description: string;
  url: string | null;
  content_type: string;
  source_type: string;
  source_id: string | null;
  metadata_json: string;
  thumbnail_path: string | null;
  has_content_file: number;
  sort_order: number;
  folder_path: string;
  created_at: string;
  updated_at: string;
  file_mtime_ms: number | null;
  content_revision: number;
}

function serializeMetadata(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata);
}

function parseMetadata(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid item metadata_json: expected object, got ${typeof parsed}`);
  }
  return parsed as Record<string, unknown>;
}

function itemRowToFile(
  row: ItemRow,
  tagIds: string[],
  collectionIds: string[],
): ItemFile {
  return {
    id: row.id,
    vault_id: row.vault_id,
    title: row.title,
    description: row.description,
    url: row.url ?? undefined,
    content_type: row.content_type as ContentType,
    source_type: row.source_type as SourceType,
    source_id: row.source_id ?? undefined,
    metadata: parseMetadata(row.metadata_json),
    thumbnail: row.thumbnail_path ?? undefined,
    tag_ids: tagIds,
    collection_ids: collectionIds,
    folder_path: row.folder_path ?? "",
    content_revision: row.content_revision,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function sqlInPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/** SQLite bind limit is 999; keep multi-row inserts well under that. */
const SQL_INSERT_CHUNK = 100;

function sqlRowPlaceholders(rowCount: number, columnsPerRow: number): string {
  const oneRow = `(${sqlInPlaceholders(columnsPerRow)})`;
  return Array.from({ length: rowCount }, () => oneRow).join(", ");
}

function sqlCollectionStubPlaceholders(rowCount: number): string {
  const oneRow = "(?, ?, NULL, ?, '', ?, ?)";
  return Array.from({ length: rowCount }, () => oneRow).join(", ");
}

async function replaceItemTags(
  db: SqlExecutor,
  itemId: string,
  tagIds: string[],
): Promise<void> {
  await db.execute("DELETE FROM item_tags WHERE item_id = ?", [itemId]);
  if (tagIds.length === 0) {
    return;
  }
  for (let offset = 0; offset < tagIds.length; offset += SQL_INSERT_CHUNK) {
    const chunk = tagIds.slice(offset, offset + SQL_INSERT_CHUNK);
    const binds: unknown[] = [];
    for (const tagId of chunk) {
      binds.push(itemId, tagId);
    }
    await db.execute(
      `INSERT INTO item_tags (item_id, tag_id) VALUES ${sqlRowPlaceholders(chunk.length, 2)}`,
      binds,
    );
  }
}

async function replaceItemCollections(
  db: SqlExecutor,
  itemId: string,
  vaultId: string,
  collectionIds: string[],
  createdAt: string,
  updatedAt: string,
): Promise<void> {
  await db.execute("DELETE FROM item_collections WHERE item_id = ?", [itemId]);
  if (collectionIds.length === 0) {
    return;
  }
  for (let offset = 0; offset < collectionIds.length; offset += SQL_INSERT_CHUNK) {
    const chunk = collectionIds.slice(offset, offset + SQL_INSERT_CHUNK);
    const stubBinds: unknown[] = [];
    for (const collectionId of chunk) {
      stubBinds.push(
        collectionId,
        vaultId,
        collectionId,
        createdAt,
        updatedAt,
      );
    }
    // Stub parents so FK on item_collections succeeds without collections sync.
    await db.execute(
      `INSERT INTO collections (
        id, vault_id, parent_id, name, description, created_at, updated_at
      ) VALUES ${sqlCollectionStubPlaceholders(chunk.length)}
      ON CONFLICT(id) DO NOTHING`,
      stubBinds,
    );
    const linkBinds: unknown[] = [];
    for (const collectionId of chunk) {
      linkBinds.push(itemId, collectionId);
    }
    await db.execute(
      `INSERT INTO item_collections (item_id, collection_id) VALUES ${sqlRowPlaceholders(chunk.length, 2)}`,
      linkBinds,
    );
  }
}

function sqlPageClause(options?: ItemIdPageOptions): {
  sql: string;
  binds: number[];
} {
  if (options?.limit === undefined) {
    return { sql: "", binds: [] };
  }
  const binds = [options.limit];
  let sql = "LIMIT ?";
  if (options.offset !== undefined) {
    sql += " OFFSET ?";
    binds.push(options.offset);
  }
  return { sql, binds };
}

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
        metadata_json, thumbnail_path, has_content_file,
        folder_path, created_at, updated_at, file_mtime_ms, content_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        vault_id = excluded.vault_id,
        title = excluded.title,
        description = excluded.description,
        url = excluded.url,
        content_type = excluded.content_type,
        source_type = excluded.source_type,
        source_id = excluded.source_id,
        metadata_json = excluded.metadata_json,
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

    // FTS body is written only by upsertItemContent after the content read.
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
          metadata_json, thumbnail_path, has_content_file,
          folder_path, created_at, updated_at, file_mtime_ms, content_revision
        ) VALUES ${sqlRowPlaceholders(chunk.length, 16)}
        ON CONFLICT(id) DO UPDATE SET
          vault_id = excluded.vault_id,
          title = excluded.title,
          description = excluded.description,
          url = excluded.url,
          content_type = excluded.content_type,
          source_type = excluded.source_type,
          source_id = excluded.source_id,
          metadata_json = excluded.metadata_json,
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
    const { itemId, title, description, content, sourceRef } = input;

    await this.db.execute(
      "UPDATE items SET has_content_file = ? WHERE id = ?",
      [content ? 1 : 0, itemId],
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
        hasContentBinds.push(input.itemId, input.content ? 1 : 0);
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

  override async rewriteItemIds(
    mappings: ItemIdRewriteMapping[],
  ): Promise<void> {
    if (mappings.length === 0) {
      return;
    }

    for (let offset = 0; offset < mappings.length; offset += INDEX_SYNC_WRITE_BATCH) {
      const chunk = mappings.slice(offset, offset + INDEX_SYNC_WRITE_BATCH);
      for (const mapping of chunk) {
        await this.rewriteOneItemId(mapping);
      }
      if (offset + chunk.length < mappings.length) {
        await yieldToEventLoop(INDEX_SYNC_YIELD_MS);
      }
    }
  }

  private async rewriteOneItemId(mapping: ItemIdRewriteMapping): Promise<void> {
    const { oldId, newId, folderPath } = mapping;
    if (oldId === newId) {
      return;
    }

    const rows = await this.selector.select<ItemRewriteRow>(
      `SELECT
         id, vault_id, title, description, url, content_type, source_type,
         source_id, metadata_json, thumbnail_path, has_content_file, sort_order,
         folder_path, created_at, updated_at, file_mtime_ms, content_revision
       FROM items
       WHERE id = ?`,
      [oldId],
    );
    if (rows.length === 0) {
      throw new Error(`rewriteItemIds: item not found: ${oldId}`);
    }
    const row = rows[0]!;

    // No multi-IPC BEGIN/COMMIT: sqlx pool uses a new connection per execute (#49/#77).
    // Insert new PK → rebind children → delete old row.
    await this.selector.execute(
      `INSERT INTO items (
        id, vault_id, title, description, url, content_type, source_type, source_id,
        metadata_json, thumbnail_path, has_content_file, sort_order,
        folder_path, created_at, updated_at, file_mtime_ms, content_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId,
        row.vault_id,
        row.title,
        row.description,
        row.url,
        row.content_type,
        row.source_type,
        row.source_id,
        row.metadata_json,
        row.thumbnail_path,
        row.has_content_file,
        row.sort_order,
        folderPath,
        row.created_at,
        row.updated_at,
        row.file_mtime_ms,
        row.content_revision,
      ],
    );

    const tagRows = await this.selector.select<{ tag_id: string }>(
      "SELECT tag_id FROM item_tags WHERE item_id = ?",
      [oldId],
    );
    if (tagRows.length > 0) {
      await this.selector.execute("DELETE FROM item_tags WHERE item_id = ?", [
        oldId,
      ]);
      for (let offset = 0; offset < tagRows.length; offset += SQL_INSERT_CHUNK) {
        const chunk = tagRows.slice(offset, offset + SQL_INSERT_CHUNK);
        const binds: unknown[] = [];
        for (const tagRow of chunk) {
          binds.push(newId, tagRow.tag_id);
        }
        await this.selector.execute(
          `INSERT INTO item_tags (item_id, tag_id) VALUES ${sqlRowPlaceholders(chunk.length, 2)}`,
          binds,
        );
      }
    }

    const collectionRows = await this.selector.select<{
      collection_id: string;
    }>("SELECT collection_id FROM item_collections WHERE item_id = ?", [
      oldId,
    ]);
    if (collectionRows.length > 0) {
      await this.selector.execute(
        "DELETE FROM item_collections WHERE item_id = ?",
        [oldId],
      );
      for (
        let offset = 0;
        offset < collectionRows.length;
        offset += SQL_INSERT_CHUNK
      ) {
        const chunk = collectionRows.slice(offset, offset + SQL_INSERT_CHUNK);
        const binds: unknown[] = [];
        for (const collectionRow of chunk) {
          binds.push(newId, collectionRow.collection_id);
        }
        await this.selector.execute(
          `INSERT INTO item_collections (item_id, collection_id) VALUES ${sqlRowPlaceholders(chunk.length, 2)}`,
          binds,
        );
      }
    }

    const mediaRows = await this.selector.select<{
      id: string;
      filename: string;
      media_type: string;
      created_at: string;
    }>(
      "SELECT id, filename, media_type, created_at FROM media WHERE item_id = ?",
      [oldId],
    );
    if (mediaRows.length > 0) {
      await this.selector.execute("DELETE FROM media WHERE item_id = ?", [
        oldId,
      ]);
      for (const media of mediaRows) {
        await this.selector.execute(
          `INSERT INTO media (id, item_id, filename, media_type, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [
            media.id,
            newId,
            media.filename,
            media.media_type,
            media.created_at,
          ],
        );
      }
    }

    const sourceRows = await this.selector.select<{
      id: string;
      plugin_id: string;
      external_id: string;
      synced_at: string | null;
      metadata_json: string;
    }>(
      `SELECT id, plugin_id, external_id, synced_at, metadata_json
       FROM source_refs WHERE item_id = ?`,
      [oldId],
    );
    if (sourceRows.length > 0) {
      await this.selector.execute("DELETE FROM source_refs WHERE item_id = ?", [
        oldId,
      ]);
      for (const source of sourceRows) {
        await this.selector.execute(
          `INSERT INTO source_refs (
            id, item_id, plugin_id, external_id, synced_at, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            source.id,
            newId,
            source.plugin_id,
            source.external_id,
            source.synced_at,
            source.metadata_json,
          ],
        );
      }
    }

    const ftsRows = await this.selector.select<{
      title: string;
      description: string;
      content: string;
    }>(
      "SELECT title, description, content FROM items_fts WHERE item_id = ?",
      [oldId],
    );
    await this.selector.execute("DELETE FROM items_fts WHERE item_id = ?", [
      oldId,
    ]);
    if (ftsRows.length > 0) {
      const fts = ftsRows[0]!;
      await this.selector.execute(
        "INSERT INTO items_fts (item_id, title, description, content) VALUES (?, ?, ?, ?)",
        [newId, fts.title, fts.description, fts.content],
      );
    }

    await this.selector.execute("DELETE FROM items WHERE id = ?", [oldId]);
  }

  override async listVaultItemIds(vaultId: string): Promise<string[]> {
    const rows = await this.selector.select<SqlSelectRow>(
      "SELECT id FROM items WHERE vault_id = ?",
      [vaultId],
    );
    return rows.map((row) => row.id);
  }

  override async listItemFilesByIds(
    vaultId: string,
    itemIds: string[],
  ): Promise<ItemFile[]> {
    if (itemIds.length === 0) {
      return [];
    }

    const placeholders = sqlInPlaceholders(itemIds.length);
    const rows = await this.selector.select<ItemRow>(
      `SELECT
         id, vault_id, title, description, url, content_type, source_type,
         source_id, metadata_json, thumbnail_path,
         folder_path, content_revision, created_at, updated_at
       FROM items
       WHERE vault_id = ? AND id IN (${placeholders})`,
      [vaultId, ...itemIds],
    );

    const byId = new Map(rows.map((row) => [row.id, row]));
    const foundIds = itemIds.filter((id) => byId.has(id));
    if (foundIds.length === 0) {
      return [];
    }

    const foundPlaceholders = sqlInPlaceholders(foundIds.length);
    const tagRows = await this.selector.select<{
      item_id: string;
      tag_id: string;
    }>(
      `SELECT item_id, tag_id FROM item_tags WHERE item_id IN (${foundPlaceholders})`,
      foundIds,
    );
    const collectionRows = await this.selector.select<{
      item_id: string;
      collection_id: string;
    }>(
      `SELECT item_id, collection_id
       FROM item_collections
       WHERE item_id IN (${foundPlaceholders})`,
      foundIds,
    );

    const tagsByItem = new Map<string, string[]>();
    for (const row of tagRows) {
      const list = tagsByItem.get(row.item_id) ?? [];
      list.push(row.tag_id);
      tagsByItem.set(row.item_id, list);
    }

    const collectionsByItem = new Map<string, string[]>();
    for (const row of collectionRows) {
      const list = collectionsByItem.get(row.item_id) ?? [];
      list.push(row.collection_id);
      collectionsByItem.set(row.item_id, list);
    }

    const result: ItemFile[] = [];
    for (const id of itemIds) {
      const row = byId.get(id);
      if (!row) {
        continue;
      }
      try {
        result.push(
          itemRowToFile(
            row,
            tagsByItem.get(id) ?? [],
            collectionsByItem.get(id) ?? [],
          ),
        );
      } catch {
        // Corrupt metadata_json (or other row shape): skip this id for this
        // response; row stays in DB until filesystem sync re-upserts it.
      }
    }
    return result;
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
    const rows = await this.selector.select<{
      id: string;
      file_mtime_ms: number | null;
      updated_at: string;
      content_revision: number;
      created_at: string;
    }>(
      `SELECT id, file_mtime_ms, updated_at, content_revision, created_at
       FROM items WHERE vault_id = ?`,
      [vaultId],
    );
    return rows;
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
    if (itemIds.length === 0) {
      return [];
    }
    const placeholders = sqlInPlaceholders(itemIds.length);
    return this.selector.select(
      `SELECT id, file_mtime_ms, updated_at, content_revision, created_at
       FROM items WHERE vault_id = ? AND id IN (${placeholders})`,
      [vaultId, ...itemIds],
    );
  }

  override async getReconcileFingerprint(
    vaultId: string,
  ): Promise<ReconcileFingerprint | null> {
    const rows = await this.selector.select<{
      reconcile_fingerprint_json: string | null;
    }>(
      `SELECT reconcile_fingerprint_json FROM vaults WHERE id = ?`,
      [vaultId],
    );
    if (rows.length === 0) {
      return null;
    }
    return parseStoredReconcileFingerprint(rows[0]!.reconcile_fingerprint_json);
  }

  override async searchItemIds(
    vaultId: string,
    ftsQuery: string,
    filter: NavSearchFilter,
    options?: ItemIdPageOptions,
  ): Promise<string[]> {
    const { extraJoin, extraBinds, folderClause } = this.ftsFilterParts(filter);
    const page = sqlPageClause(options);

    const rows = await this.selector.select<SqlSelectRow>(
      `SELECT i.id
       FROM items_fts
       INNER JOIN items i ON i.id = items_fts.item_id
       ${extraJoin}
       WHERE items_fts MATCH ?
         AND i.vault_id = ?
         ${folderClause}
       ORDER BY rank
       ${page.sql}`,
      [...extraBinds, ftsQuery, vaultId, ...page.binds],
    );
    return rows.map((row) => row.id);
  }

  override async countSearchItemIds(
    vaultId: string,
    ftsQuery: string,
    filter: NavSearchFilter,
  ): Promise<number> {
    const { extraJoin, extraBinds, folderClause } = this.ftsFilterParts(filter);

    const rows = await this.selector.select<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM items_fts
       INNER JOIN items i ON i.id = items_fts.item_id
       ${extraJoin}
       WHERE items_fts MATCH ?
         AND i.vault_id = ?
         ${folderClause}`,
      [...extraBinds, ftsQuery, vaultId],
    );
    return rows[0]?.count ?? 0;
  }

  private ftsFilterParts(filter: NavSearchFilter): {
    extraJoin: string;
    extraBinds: unknown[];
    folderClause: string;
  } {
    let extraJoin = "";
    const extraBinds: unknown[] = [];

    if (isTagFilter(filter)) {
      extraJoin =
        "INNER JOIN item_tags it ON it.item_id = i.id AND it.tag_id = ?";
      extraBinds.push(filter.tagId);
    }

    let folderClause = "";
    if (isFolderFilter(filter)) {
      folderClause = "AND (i.folder_path = ? OR i.folder_path LIKE ?)";
      extraBinds.push(filter.folderPath, `${filter.folderPath}/%`);
    }

    return { extraJoin, extraBinds, folderClause };
  }

  override async listTagsWithCounts(vaultId: string): Promise<TagWithCount[]> {
    const rows = await this.selector.select<{
      id: string;
      name: string;
      color: string | null;
      created_at: string;
      item_count: number;
    }>(
      `SELECT t.id, t.name, t.color, t.created_at, COUNT(it.item_id) AS item_count
       FROM tags t
       LEFT JOIN item_tags it ON it.tag_id = t.id
       LEFT JOIN items i ON i.id = it.item_id AND i.vault_id = ?
       WHERE t.vault_id = ?
       GROUP BY t.id
       ORDER BY t.name COLLATE NOCASE`,
      [vaultId, vaultId],
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      created_at: row.created_at,
      item_count: row.item_count,
    }));
  }

  override async listItemIdsByTag(
    vaultId: string,
    tagId: string,
    options?: ItemIdListOptions,
  ): Promise<string[]> {
    const page = sqlPageClause(options);
    const rows = await this.selector.select<SqlSelectRow>(
      `SELECT i.id
       FROM items i
       INNER JOIN item_tags it ON it.item_id = i.id
       WHERE i.vault_id = ?
         AND it.tag_id = ?
       ORDER BY i.created_at DESC
       ${page.sql}`,
      [vaultId, tagId, ...page.binds],
    );
    return rows.map((row) => row.id);
  }

  override async listItemIdsByFolderPrefix(
    vaultId: string,
    folderPath: string,
    options?: ItemIdListOptions,
  ): Promise<string[]> {
    const page = sqlPageClause(options);
    const rows = await this.selector.select<SqlSelectRow>(
      `SELECT i.id
       FROM items i
       WHERE i.vault_id = ?
         AND (i.folder_path = ? OR i.folder_path LIKE ?)
       ORDER BY i.created_at DESC
       ${page.sql}`,
      [vaultId, folderPath, `${folderPath}/%`, ...page.binds],
    );
    return rows.map((row) => row.id);
  }

  override async listItemIdsByNavFilter(
    vaultId: string,
    filter: NavSearchFilter,
    options?: ItemIdPageOptions,
  ): Promise<string[]> {
    if (isTagFilter(filter)) {
      return this.listItemIdsByTag(vaultId, filter.tagId, options);
    }
    if (isFolderFilter(filter)) {
      return this.listItemIdsByFolderPrefix(vaultId, filter.folderPath, options);
    }

    const page = sqlPageClause(options);
    const rows = await this.selector.select<SqlSelectRow>(
      `SELECT i.id
       FROM items i
       WHERE i.vault_id = ?
       ORDER BY i.created_at DESC
       ${page.sql}`,
      [vaultId, ...page.binds],
    );
    return rows.map((row) => row.id);
  }

  override async countItemIdsByNavFilter(
    vaultId: string,
    filter: NavSearchFilter,
  ): Promise<number> {
    if (isTagFilter(filter)) {
      const rows = await this.selector.select<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM items i
         INNER JOIN item_tags it ON it.item_id = i.id
         WHERE i.vault_id = ?
           AND it.tag_id = ?`,
        [vaultId, filter.tagId],
      );
      return rows[0]?.count ?? 0;
    }
    if (isFolderFilter(filter)) {
      const rows = await this.selector.select<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM items i
         WHERE i.vault_id = ?
           AND (i.folder_path = ? OR i.folder_path LIKE ?)`,
        [vaultId, filter.folderPath, `${filter.folderPath}/%`],
      );
      return rows[0]?.count ?? 0;
    }

    const rows = await this.selector.select<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM items i
       WHERE i.vault_id = ?`,
      [vaultId],
    );
    return rows[0]?.count ?? 0;
  }

  override async listFolderItemCounts(
    vaultId: string,
  ): Promise<Array<{ folder_path: string; item_count: number }>> {
    const rows = await this.selector.select<{
      folder_path: string;
      item_count: number;
    }>(
      `SELECT folder_path, COUNT(*) AS item_count
       FROM items
       WHERE vault_id = ?
       GROUP BY folder_path`,
      [vaultId],
    );
    return rows;
  }
}
