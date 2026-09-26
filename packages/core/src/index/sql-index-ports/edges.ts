import type { ItemContentUpsert, ItemIdRewriteMapping } from "../../adapters/types.js";
import {
  addUserEdge as addUserEdgeImpl,
  listTextBacklinkSources as listTextBacklinkSourcesImpl,
  listWantedLinkTargetSources as listWantedLinkTargetSourcesImpl,
  listUserEdges as listUserEdgesImpl,
  queryWantedLinkTargets as queryWantedLinkTargetsImpl,
  rebuildVaultTextEdges as rebuildVaultTextEdgesImpl,
  removeUserEdge as removeUserEdgeImpl,
  replaceTextEdgesForItem as replaceTextEdgesForItemImpl,
} from "../../edges/sql-item-edges.js";
import type {
  WantedLinkResolveStatus,
  WantedLinkSourcesResult,
  WantedLinkTargetSort,
  WantedLinkTargetsResult,
} from "../../edges/types.js";
import { invalidateAllVaultIdTitleCatalogs } from "../../links/vault-id-title-catalog.js";
import { rewriteItemIds as rewriteItemIdsImpl } from "../sql-index-rewrite.js";
import { requireSqlSelect } from "./require-select.js";
import type { SqlIndexStoreDb } from "./types.js";

export const edgesSelectStubs = {
  rewriteItemIds(_mappings: ItemIdRewriteMapping[]): Promise<void> {
    return requireSqlSelect("rewriteItemIds");
  },
  rebuildVaultTextEdges(_vaultId: string): Promise<void> {
    return requireSqlSelect("rebuildVaultTextEdges");
  },
  addUserEdge(
    _vaultId: string,
    _itemA: string,
    _itemB: string,
  ): Promise<void> {
    return requireSqlSelect("addUserEdge");
  },
  removeUserEdge(
    _vaultId: string,
    _itemA: string,
    _itemB: string,
  ): Promise<void> {
    return requireSqlSelect("removeUserEdge");
  },
  listUserEdges(
    _vaultId: string,
    _itemId: string,
  ): Promise<Array<{ id: string; title: string }>> {
    return requireSqlSelect("listUserEdges");
  },
  listTextBacklinkSources(
    _targetItemId: string,
  ): Promise<Array<{ id: string; title: string }>> {
    return requireSqlSelect("listTextBacklinkSources");
  },
  queryWantedLinkTargets(
    _vaultId: string,
    _page: { limit: number; offset: number },
    _sort?: WantedLinkTargetSort,
  ): Promise<WantedLinkTargetsResult> {
    return requireSqlSelect("queryWantedLinkTargets");
  },
  listWantedLinkTargetSources(
    _vaultId: string,
    _target: { rawTarget: string; resolveStatus: WantedLinkResolveStatus },
    _page?: { limit: number; offset: number },
  ): Promise<WantedLinkSourcesResult> {
    return requireSqlSelect("listWantedLinkTargetSources");
  },
};

export function createEdgesStorePort(
  selector: SqlIndexStoreDb,
  catalog: {
    listItemIdTitles: (
      vaultId: string,
    ) => Promise<Array<{ id: string; title: string }>>;
    listItemFtsBodies: (
      vaultId: string,
    ) => Promise<Array<{ id: string; title: string; content: string }>>;
  },
) {
  return {
    async rewriteItemIds(mappings: ItemIdRewriteMapping[]): Promise<void> {
      await rewriteItemIdsImpl(selector, mappings);
      // Id rewrites change catalog keys; clear all vaults for this session.
      invalidateAllVaultIdTitleCatalogs(selector);
    },

    async syncTextEdgesForContent(input: ItemContentUpsert): Promise<void> {
      const rows = await selector.select<{ vault_id: string }>(
        "SELECT vault_id FROM items WHERE id = ?",
        [input.itemId],
      );
      const vaultId = rows[0]?.vault_id;
      if (vaultId === undefined) {
        throw new Error(
          `syncTextEdgesForContent: item not in index: ${input.itemId}`,
        );
      }
      if (!input.hasContentFile) {
        await selector.execute(
          "DELETE FROM item_edges WHERE from_id = ? AND source = 'text'",
          [input.itemId],
        );
        return;
      }
      const titles = await catalog.listItemIdTitles(vaultId);
      await replaceTextEdgesForItemImpl(
        selector,
        vaultId,
        input.itemId,
        input.content ?? "",
        titles,
      );
    },

    async rebuildVaultTextEdges(vaultId: string): Promise<void> {
      await rebuildVaultTextEdgesImpl(
        selector,
        vaultId,
        () => catalog.listItemIdTitles(vaultId),
        () => catalog.listItemFtsBodies(vaultId),
      );
    },

    addUserEdge(vaultId: string, itemA: string, itemB: string) {
      return addUserEdgeImpl(selector, vaultId, itemA, itemB);
    },

    removeUserEdge(vaultId: string, itemA: string, itemB: string) {
      return removeUserEdgeImpl(selector, vaultId, itemA, itemB);
    },

    listUserEdges(vaultId: string, itemId: string) {
      return listUserEdgesImpl(selector, vaultId, itemId);
    },

    listTextBacklinkSources(targetItemId: string) {
      return listTextBacklinkSourcesImpl(selector, targetItemId);
    },

    queryWantedLinkTargets(
      vaultId: string,
      page: { limit: number; offset: number },
      sort?: WantedLinkTargetSort,
    ) {
      return queryWantedLinkTargetsImpl(selector, vaultId, page, sort);
    },

    listWantedLinkTargetSources(
      vaultId: string,
      target: { rawTarget: string; resolveStatus: WantedLinkResolveStatus },
      page?: { limit: number; offset: number },
    ) {
      return listWantedLinkTargetSourcesImpl(selector, vaultId, target, page);
    },
  };
}

export type EdgesStorePort = ReturnType<typeof createEdgesStorePort>;
