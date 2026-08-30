/** Matches `collector-service` `DASHBOARD_PREFETCH_SIZE`. */
export const DASHBOARD_PREFETCH_SIZE = 60;

/**
 * Client hydrate → `loadDashboardItems` chunk size (#666).
 * Aligned with core `SQL_IN_LIST_CHUNK` (200–500 band under SQLite bind limits).
 */
export const DASHBOARD_HYDRATE_CHUNK_SIZE = 400;

/**
 * Bound parallel per-item thumbnail wire RPCs for progressive resolve (#823).
 * Matches core disk-read concurrency spirit (#544).
 */
export const THUMBNAIL_RESOLVE_WIRE_CONCURRENCY = 4;

/**
 * Fail-fast ceiling for hydrate id lists (#666). Never silently truncate.
 * Aligned with core `SQL_IN_LIST_MAX`.
 */
export const DASHBOARD_HYDRATE_MAX_IDS = 100_000;

/**
 * Default LIMIT for {@link ItemsPort.searchItems} when callers omit `page` (#658).
 * Same size as dashboard prefetch so CLI/MCP/sidebar share one bound.
 */
export const SEARCH_PAGE_SIZE = DASHBOARD_PREFETCH_SIZE;

/**
 * Hard ceiling for {@link ItemsPort.searchItems} `page.limit` (#658).
 * Aligned with hydrate chunk size so one page cannot reopen unbounded IN-list hydrate.
 */
export const SEARCH_PAGE_MAX_LIMIT = DASHBOARD_HYDRATE_CHUNK_SIZE;
