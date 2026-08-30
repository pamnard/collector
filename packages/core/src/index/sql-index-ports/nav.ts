import type { ItemFile } from "@collector/shared";
import type {
  AdjacentItemAnchor,
  AdjacentItemsResult,
  ItemIdListOptions,
  ItemIdPageOptions,
} from "../../adapters/types.js";
import type { NavSearchFilter } from "../../search/nav-filter.js";
import * as indexQueries from "../sql-index-queries.js";
import { requireSqlSelect } from "./require-select.js";
import type { SqlIndexStoreDb, TagWithCount } from "./types.js";

export const navSelectStubs = {
  listTagsWithCounts(_vaultId: string): Promise<TagWithCount[]> {
    return requireSqlSelect("listTagsWithCounts");
  },
  listReferencedTagIds(_vaultId: string): Promise<string[]> {
    return requireSqlSelect("listReferencedTagIds");
  },
  listOrphanTagIds(_vaultId: string): Promise<string[]> {
    return requireSqlSelect("listOrphanTagIds");
  },
  listItemIdsByTag(
    _vaultId: string,
    _tagId: string,
    _options?: ItemIdListOptions,
  ): Promise<string[]> {
    return requireSqlSelect("listItemIdsByTag");
  },
  listItemIdsByFolderPrefix(
    _vaultId: string,
    _folderPath: string,
    _options?: ItemIdListOptions,
  ): Promise<string[]> {
    return requireSqlSelect("listItemIdsByFolderPrefix");
  },
  getAdjacentItems(
    _vaultId: string,
    _anchor: AdjacentItemAnchor,
  ): Promise<AdjacentItemsResult> {
    return requireSqlSelect("getAdjacentItems");
  },
  listItemIdsByNavFilter(
    _vaultId: string,
    _filter: NavSearchFilter,
    _options?: ItemIdPageOptions,
  ): Promise<string[]> {
    return requireSqlSelect("listItemIdsByNavFilter");
  },
  countItemIdsByNavFilter(
    _vaultId: string,
    _filter: NavSearchFilter,
  ): Promise<number> {
    return requireSqlSelect("countItemIdsByNavFilter");
  },
  listFolderItemCounts(_vaultId: string): Promise<
    Array<{ folder_path: string; item_count: number }>
  > {
    return requireSqlSelect("listFolderItemCounts");
  },
  listVaultItemIds(_vaultId: string): Promise<string[]> {
    return requireSqlSelect("listVaultItemIds");
  },
  listItemFilesByIds(
    _vaultId: string,
    _itemIds: string[],
  ): Promise<ItemFile[]> {
    return requireSqlSelect("listItemFilesByIds");
  },
  listItemPresentationStampsByIds(
    _vaultId: string,
    _itemIds: string[],
  ): Promise<string[]> {
    return requireSqlSelect("listItemPresentationStampsByIds");
  },
  searchItemIds(
    _vaultId: string,
    _ftsQuery: string,
    _filter: NavSearchFilter,
    _options?: ItemIdPageOptions,
  ): Promise<string[]> {
    return requireSqlSelect("searchItemIds");
  },
  countSearchItemIds(
    _vaultId: string,
    _ftsQuery: string,
    _filter: NavSearchFilter,
  ): Promise<number> {
    return requireSqlSelect("countSearchItemIds");
  },
};

export function createNavStorePort(selector: SqlIndexStoreDb) {
  return {
    listVaultItemIds(vaultId: string) {
      return indexQueries.listVaultItemIds(selector, vaultId);
    },
    findItemIdByUrl(vaultId: string, url: string) {
      return indexQueries.findItemIdByUrl(selector, vaultId, url);
    },
    listItemFilesByIds(vaultId: string, itemIds: string[]) {
      return indexQueries.listItemFilesByIds(selector, vaultId, itemIds);
    },
    listItemPresentationStampsByIds(vaultId: string, itemIds: string[]) {
      return indexQueries.listItemPresentationStampsByIds(
        selector,
        vaultId,
        itemIds,
      );
    },
    searchItemIds(
      vaultId: string,
      ftsQuery: string,
      filter: NavSearchFilter,
      options?: ItemIdPageOptions,
    ) {
      return indexQueries.searchItemIds(
        selector,
        vaultId,
        ftsQuery,
        filter,
        options,
      );
    },
    countSearchItemIds(
      vaultId: string,
      ftsQuery: string,
      filter: NavSearchFilter,
    ) {
      return indexQueries.countSearchItemIds(
        selector,
        vaultId,
        ftsQuery,
        filter,
      );
    },
    listTagsWithCounts(vaultId: string) {
      return indexQueries.listTagsWithCounts(selector, vaultId);
    },
    listReferencedTagIds(vaultId: string) {
      return indexQueries.listReferencedTagIds(selector, vaultId);
    },
    listOrphanTagIds(vaultId: string) {
      return indexQueries.listOrphanTagIds(selector, vaultId);
    },
    listItemIdsByTag(
      vaultId: string,
      tagId: string,
      options?: ItemIdListOptions,
    ) {
      return indexQueries.listItemIdsByTag(
        selector,
        vaultId,
        tagId,
        options,
      );
    },
    listItemIdsByFolderPrefix(
      vaultId: string,
      folderPath: string,
      options?: ItemIdListOptions,
    ) {
      return indexQueries.listItemIdsByFolderPrefix(
        selector,
        vaultId,
        folderPath,
        options,
      );
    },
    getAdjacentItems(vaultId: string, anchor: AdjacentItemAnchor) {
      return indexQueries.getAdjacentItems(selector, vaultId, anchor);
    },
    listItemIdsByNavFilter(
      vaultId: string,
      filter: NavSearchFilter,
      options?: ItemIdPageOptions,
    ) {
      return indexQueries.listItemIdsByNavFilter(
        selector,
        vaultId,
        filter,
        options,
      );
    },
    countItemIdsByNavFilter(vaultId: string, filter: NavSearchFilter) {
      return indexQueries.countItemIdsByNavFilter(selector, vaultId, filter);
    },
    listFolderItemCounts(vaultId: string) {
      return indexQueries.listFolderItemCounts(selector, vaultId);
    },
  };
}

export type NavStorePort = ReturnType<typeof createNavStorePort>;
