/**
 * Sidebar search paging (#658).
 *
 * Uses canonical {@link ItemsPort.queryIndex} + {@link ItemsPort.hydrate}
 * so the panel gets a LIMIT window of index card fields (not full markdown).
 */

import { SEARCH_PAGE_SIZE, type ItemsPort } from "@collector/api";
import type { ItemFile } from "@collector/shared";
import { collectHydratedItems } from "./dashboard-display.ts";

/** Page size for sidebar search hydrate + list rows (#658). */
export const SIDEBAR_SEARCH_PAGE_SIZE = SEARCH_PAGE_SIZE;

export function sidebarSearchHasMore(
  loadedCount: number,
  totalCount: number,
): boolean {
  return loadedCount < totalCount;
}

export function nextSidebarSearchPage(
  loadedCount: number,
  pageSize: number = SIDEBAR_SEARCH_PAGE_SIZE,
): { limit: number; offset: number } {
  return { limit: pageSize, offset: loadedCount };
}

/**
 * Max rows the panel may mount after `loadedPages` explicit page fetches
 * (first query counts as page 1; each load-more increments).
 */
export function sidebarSearchMountedRowCap(
  loadedPages: number,
  pageSize: number = SIDEBAR_SEARCH_PAGE_SIZE,
): number {
  if (loadedPages < 1) {
    throw new Error("sidebar search requires at least one loaded page");
  }
  return loadedPages * pageSize;
}

export async function fetchSidebarSearchPage(
  items: Pick<ItemsPort, "queryIndex" | "hydrate">,
  query: string,
  page: { limit: number; offset: number },
  options?: { signal?: AbortSignal },
): Promise<{
  items: ItemFile[];
  totalCount: number;
  offset: number;
  fetchedIdCount: number;
}> {
  const indexPage = await items.queryIndex("all", query, page);
  if (options?.signal?.aborted) {
    return {
      items: [],
      totalCount: indexPage.total,
      offset: indexPage.offset,
      fetchedIdCount: 0,
    };
  }
  if (indexPage.ids.length > page.limit) {
    throw new Error(
      `sidebar search page exceeded limit: ${indexPage.ids.length} > ${page.limit}`,
    );
  }
  const hydrated: ItemFile[] = [];
  await collectHydratedItems(
    items.hydrate(indexPage.ids, { signal: options?.signal }),
    (item) => {
      hydrated.push(item);
    },
  );
  return {
    items: hydrated,
    totalCount: indexPage.total,
    offset: indexPage.offset,
    fetchedIdCount: indexPage.ids.length,
  };
}
