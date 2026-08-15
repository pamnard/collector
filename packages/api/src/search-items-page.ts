/**
 * Shared {@link ItemsPort.searchItems} page validation (#658).
 * Fail-fast: no silent clamp, no invented defaults for invalid input.
 */

import { SEARCH_PAGE_MAX_LIMIT } from "./service-api.js";

export type SearchItemsPage = { limit: number; offset: number };

/**
 * Rejects NaN/Infinity/non-integers, non-positive limits, negative offsets,
 * and limits above {@link SEARCH_PAGE_MAX_LIMIT}.
 */
export function assertSearchItemsPage(page: SearchItemsPage): void {
  if (
    typeof page.limit !== "number" ||
    !Number.isFinite(page.limit) ||
    !Number.isInteger(page.limit) ||
    page.limit <= 0
  ) {
    throw new Error(
      "searchItems page.limit must be a positive finite integer",
    );
  }
  if (page.limit > SEARCH_PAGE_MAX_LIMIT) {
    throw new Error(
      `searchItems page.limit exceeds max ${SEARCH_PAGE_MAX_LIMIT}`,
    );
  }
  if (
    typeof page.offset !== "number" ||
    !Number.isFinite(page.offset) ||
    !Number.isInteger(page.offset) ||
    page.offset < 0
  ) {
    throw new Error(
      "searchItems page.offset must be a non-negative finite integer",
    );
  }
}
