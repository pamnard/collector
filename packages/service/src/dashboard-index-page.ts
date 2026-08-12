/**
 * Dashboard index page query + sort allowlist (#384).
 */

import type {
  DashboardIndexPage,
  DashboardItemSort,
  NavFilter,
} from "@collector/api";
import { isItemIdSortDir, isItemIdSortKey } from "@collector/core";
import type { ItemsIndexPort } from "./items-search.js"; // type-only: avoid cycle with factory

export function assertDashboardItemSort(
  sort: DashboardItemSort | undefined,
): DashboardItemSort | undefined {
  if (sort === undefined) {
    return undefined;
  }
  if (!isItemIdSortKey(sort.key)) {
    throw new Error(`Unsupported item id sort key: ${sort.key}`);
  }
  if (!isItemIdSortDir(sort.dir)) {
    throw new Error(`Unsupported item id sort dir: ${String(sort.dir)}`);
  }
  return sort;
}

async function withPresentationStamps(
  index: ItemsIndexPort,
  vaultId: string,
  itemIds: string[],
  totalCount: number,
  offset: number,
): Promise<DashboardIndexPage> {
  const stamps = await index.listItemPresentationStampsByIds(vaultId, itemIds);
  return { itemIds, stamps, totalCount, offset };
}

export async function queryDashboardIndexPage(
  index: ItemsIndexPort,
  buildSearchFtsQuery: (userQuery: string, vaultId: string) => string | null,
  vaultId: string,
  filter: NavFilter,
  query: string,
  page: { limit: number; offset: number },
  sort?: DashboardItemSort,
): Promise<DashboardIndexPage> {
  const trimmedSearch = query.trim();
  const listPage = sort ? { ...page, sort } : page;

  if (!trimmedSearch) {
    const [itemIds, totalCount] = await Promise.all([
      index.listItemIdsByNavFilter(vaultId, filter, listPage),
      index.countItemIdsByNavFilter(vaultId, filter),
    ]);
    return withPresentationStamps(
      index,
      vaultId,
      itemIds,
      totalCount,
      page.offset,
    );
  }

  const ftsQuery = buildSearchFtsQuery(trimmedSearch, vaultId);
  if (!ftsQuery) {
    const [itemIds, totalCount] = await Promise.all([
      index.listItemIdsByNavFilter(vaultId, filter, listPage),
      index.countItemIdsByNavFilter(vaultId, filter),
    ]);
    return withPresentationStamps(
      index,
      vaultId,
      itemIds,
      totalCount,
      page.offset,
    );
  }

  // FTS keeps ORDER BY rank; user column sort applies only to nav list path.
  const [itemIds, totalCount] = await Promise.all([
    index.searchItemIds(vaultId, ftsQuery, filter, page),
    index.countSearchItemIds(vaultId, ftsQuery, filter),
  ]);
  return withPresentationStamps(
    index,
    vaultId,
    itemIds,
    totalCount,
    page.offset,
  );
}
