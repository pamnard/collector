/**
 * Thin compose façade for the SQL vault index (#792).
 * Domain logic lives in `sql-index-ports/`; query/rewrite modules stay the SQL home.
 */
import type { Tag } from "@collector/shared";
import type {
  IndexedItem,
  ItemContentUpsert,
  ItemIdRewriteMapping,
  VaultIndexAdapter,
} from "../adapters/types.js";
import { createCatalogStorePort } from "./sql-index-ports/catalog.js";
import {
  createEdgesStorePort,
  edgesSelectStubs,
} from "./sql-index-ports/edges.js";
import { createItemsPort } from "./sql-index-ports/items.js";
import { createMediaPort } from "./sql-index-ports/media.js";
import { createNavStorePort, navSelectStubs } from "./sql-index-ports/nav.js";
import {
  createSyncStorePort,
  createSyncWritePort,
  syncSelectStubs,
} from "./sql-index-ports/sync.js";
import {
  createTagsPort,
  upsertTagPreferringDiskId,
} from "./sql-index-ports/tags.js";
import type { SqlIndexDb, SqlIndexStoreDb } from "./sql-index-ports/types.js";
import { createVaultPort } from "./sql-index-ports/vault.js";

export type {
  SqlIndexDb,
  SqlSelectRow,
  SqlSelector,
  TagWithCount,
} from "./sql-index-ports/types.js";

export class SqlVaultIndexAdapter implements VaultIndexAdapter {
  // Instance method fields: Store reassigns select/edge ports after super().
  upsertVault;
  deleteVault;
  upsertItemMetadata;
  upsertItemMetadataBatch;
  upsertItemContent;
  upsertItemContentBatch;
  upsertMedia;
  deleteMedia;
  deleteMediaForItem;
  deleteItemsBatch;
  rewriteItemIds;
  upsertTag;
  deleteTag;
  listTagsWithCounts;
  listItemIdsByTag;
  listItemIdsByFolderPrefix;
  getAdjacentItems;
  listItemIdsByNavFilter;
  countItemIdsByNavFilter;
  listFolderItemCounts;
  listVaultItemIds;
  listItemFilesByIds;
  listItemPresentationStampsByIds;
  patchItemSyncMeta;
  patchItemSyncMetaBatch;
  getReconcileFingerprint;
  setReconcileFingerprint;
  listVaultItemSyncMeta;
  listItemSyncMetaByIds;
  searchItemIds;
  countSearchItemIds;
  rebuildVaultTextEdges;
  addUserEdge;
  removeUserEdge;
  listUserEdges;
  listTextBacklinkSources;

  constructor(db: SqlIndexDb) {
    const vault = createVaultPort(db);
    const items = createItemsPort(db);
    const media = createMediaPort(db);
    const tags = createTagsPort(db);
    const sync = createSyncWritePort(db);

    this.upsertVault = vault.upsertVault;
    this.deleteVault = vault.deleteVault;
    this.upsertItemMetadata = items.upsertItemMetadata;
    this.upsertItemMetadataBatch = items.upsertItemMetadataBatch;
    this.upsertItemContent = items.upsertItemContent;
    this.upsertItemContentBatch = items.upsertItemContentBatch;
    this.upsertMedia = media.upsertMedia;
    this.deleteMedia = media.deleteMedia;
    this.deleteMediaForItem = media.deleteMediaForItem;
    this.deleteItemsBatch = items.deleteItemsBatch;
    this.upsertTag = tags.upsertTag;
    this.deleteTag = tags.deleteTag;
    this.patchItemSyncMeta = sync.patchItemSyncMeta;
    this.patchItemSyncMetaBatch = sync.patchItemSyncMetaBatch;
    this.setReconcileFingerprint = sync.setReconcileFingerprint;

    this.rewriteItemIds = edgesSelectStubs.rewriteItemIds;
    this.listTagsWithCounts = navSelectStubs.listTagsWithCounts;
    this.listItemIdsByTag = navSelectStubs.listItemIdsByTag;
    this.listItemIdsByFolderPrefix = navSelectStubs.listItemIdsByFolderPrefix;
    this.getAdjacentItems = navSelectStubs.getAdjacentItems;
    this.listItemIdsByNavFilter = navSelectStubs.listItemIdsByNavFilter;
    this.countItemIdsByNavFilter = navSelectStubs.countItemIdsByNavFilter;
    this.listFolderItemCounts = navSelectStubs.listFolderItemCounts;
    this.listVaultItemIds = navSelectStubs.listVaultItemIds;
    this.listItemFilesByIds = navSelectStubs.listItemFilesByIds;
    this.listItemPresentationStampsByIds =
      navSelectStubs.listItemPresentationStampsByIds;
    this.getReconcileFingerprint = syncSelectStubs.getReconcileFingerprint;
    this.listVaultItemSyncMeta = syncSelectStubs.listVaultItemSyncMeta;
    this.listItemSyncMetaByIds = syncSelectStubs.listItemSyncMetaByIds;
    this.searchItemIds = navSelectStubs.searchItemIds;
    this.countSearchItemIds = navSelectStubs.countSearchItemIds;
    this.rebuildVaultTextEdges = edgesSelectStubs.rebuildVaultTextEdges;
    this.addUserEdge = edgesSelectStubs.addUserEdge;
    this.removeUserEdge = edgesSelectStubs.removeUserEdge;
    this.listUserEdges = edgesSelectStubs.listUserEdges;
    this.listTextBacklinkSources = edgesSelectStubs.listTextBacklinkSources;
  }

  /** Polymorphic: Store overrides `upsertItemContent` for text-edge sync. */
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

  async deleteItem(itemId: string): Promise<void> {
    await this.deleteItemsBatch([itemId]);
  }
}

export class SqlVaultIndexStore extends SqlVaultIndexAdapter {
  readonly listItemIdTitles;
  readonly listItemFtsBodies;
  readonly vaultItemsContentGeneration;
  readonly findItemIdByUrl;

  constructor(selector: SqlIndexStoreDb) {
    super(selector);

    const catalog = createCatalogStorePort(selector);
    const nav = createNavStorePort(selector);
    const syncStore = createSyncStorePort(selector);
    const edges = createEdgesStorePort(selector, catalog);
    const baseUpsertTag = this.upsertTag;
    const baseUpsertItemContent = this.upsertItemContent;
    const baseUpsertItemContentBatch = this.upsertItemContentBatch;

    this.listItemIdTitles = catalog.listItemIdTitles;
    this.listItemFtsBodies = catalog.listItemFtsBodies;
    this.vaultItemsContentGeneration = catalog.vaultItemsContentGeneration;
    this.findItemIdByUrl = nav.findItemIdByUrl;

    this.upsertTag = (tag: Tag, vaultId: string) =>
      upsertTagPreferringDiskId(selector, tag, vaultId, baseUpsertTag);

    this.rewriteItemIds = (mappings: ItemIdRewriteMapping[]) =>
      edges.rewriteItemIds(mappings);

    this.listVaultItemIds = nav.listVaultItemIds;
    this.listItemFilesByIds = nav.listItemFilesByIds;
    this.listItemPresentationStampsByIds = nav.listItemPresentationStampsByIds;
    this.listVaultItemSyncMeta = syncStore.listVaultItemSyncMeta;
    this.listItemSyncMetaByIds = syncStore.listItemSyncMetaByIds;
    this.getReconcileFingerprint = syncStore.getReconcileFingerprint;
    this.searchItemIds = nav.searchItemIds;
    this.countSearchItemIds = nav.countSearchItemIds;
    this.listTagsWithCounts = nav.listTagsWithCounts;
    this.listItemIdsByTag = nav.listItemIdsByTag;
    this.listItemIdsByFolderPrefix = nav.listItemIdsByFolderPrefix;
    this.getAdjacentItems = nav.getAdjacentItems;
    this.listItemIdsByNavFilter = nav.listItemIdsByNavFilter;
    this.countItemIdsByNavFilter = nav.countItemIdsByNavFilter;
    this.listFolderItemCounts = nav.listFolderItemCounts;

    this.upsertItemContent = async (input: ItemContentUpsert) => {
      await baseUpsertItemContent(input);
      await edges.syncTextEdgesForContent(input);
    };
    this.upsertItemContentBatch = async (inputs: ItemContentUpsert[]) => {
      await baseUpsertItemContentBatch(inputs);
      // Full sync finishes with rebuildVaultTextEdges; avoid duplicate per-item work.
    };

    this.rebuildVaultTextEdges = edges.rebuildVaultTextEdges;
    this.addUserEdge = edges.addUserEdge;
    this.removeUserEdge = edges.removeUserEdge;
    this.listUserEdges = edges.listUserEdges;
    this.listTextBacklinkSources = edges.listTextBacklinkSources;
  }
}
