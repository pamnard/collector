import { useCallback, useRef } from "react";
import type {
  DashboardItemSort,
  ItemThumbnailPixelSize,
  VaultPresentationChangedPayload,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import { useAppSettings } from "../../context/AppSettingsContext";
import { dashboardLiveActionForEvent } from "../../lib/vault-presentation-affects";
import { itemIdToPruneFromPresentationEvent } from "../../lib/presentation-prune-item-id";
import type { NavFilter } from "../../types/ui";
import { useVaultIndexSyncStatus } from "../useVaultIndexSyncStatus";
import { useDashboardCoverFlight } from "./useDashboardCoverFlight";
import { useDashboardListState } from "./useDashboardListState";
import type { StartCoverPathFlight } from "./dashboard-list-state-types";
import { useDashboardQueryLifecycle } from "./useDashboardQueryLifecycle";

export { DASHBOARD_PREFETCH_SIZE } from "../../services/collector-client";

export const DEFAULT_DASHBOARD_SORT: DashboardItemSort = {
  key: "created_at",
  dir: "desc",
};

export interface UseDashboardItemsResult {
  items: ItemFile[];
  /** Resolved cover paths (null = no file cover). Decode is per-card. */
  thumbnailPaths: Map<string, string | null>;
  /** Freshness stamps for cover paths (`thumbnail:updated_at`). */
  thumbnailStamps: Map<string, string>;
  /** Cover pixel sizes from host (cover.size.json / sharp backfill; null = no cover). */
  thumbnailSizes: Map<string, ItemThumbnailPixelSize | null>;
  totalCount: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
  /** Drop a deleted id from committed/working lists and query cache immediately. */
  pruneItem: (itemId: string) => void;
  /** Re-resolve one item cover after itemCoverChanged (#856 / #871). */
  refreshCoverForItem: (itemId: string) => void;
  /** Scoped live updates from vaultPresentationChanged (#756). */
  applyPresentationEvents: (
    events: VaultPresentationChangedPayload[],
  ) => void;
}

export function useDashboardItems(
  filter: NavFilter,
  searchQuery: string,
  vaultRevision: number,
  sort: DashboardItemSort = DEFAULT_DASHBOARD_SORT,
): UseDashboardItemsResult {
  const { settings } = useAppSettings();
  const vaultId = settings.active_vault_id ?? null;
  const indexSync = useVaultIndexSyncStatus();

  const startCoverPathFlightRef = useRef<StartCoverPathFlight>(async () => {});

  const list = useDashboardListState({
    filter,
    searchQuery,
    sort,
    vaultId,
    startCoverPathFlightRef,
  });

  const isIndexingEmptyGrid =
    (indexSync.status === "running" || indexSync.status === "rebuilding") &&
    list.committedTotalCount === 0 &&
    list.committedItems.length === 0;

  const showSkeleton =
    (list.isLoading && list.committedItems.length === 0) ||
    isIndexingEmptyGrid;

  const covers = useDashboardCoverFlight({
    showSkeleton,
    list,
    startCoverPathFlightRef,
  });

  const query = useDashboardQueryLifecycle({
    filter,
    searchQuery,
    sort,
    vaultId,
    vaultRevision,
    list,
    abortCoverFlight: covers.abortCoverFlight,
    indexSync,
  });

  const applyPresentationEvents = useCallback(
    (events: VaultPresentationChangedPayload[]) => {
      let softRefresh = false;
      for (const event of events) {
        const action = dashboardLiveActionForEvent(
          list.filterRef.current,
          event,
        );
        if (action === "ignore") {
          continue;
        }
        if (action === "prune") {
          const pruneId = itemIdToPruneFromPresentationEvent(event);
          if (pruneId) {
            list.pruneItem(pruneId);
          }
          continue;
        }
        if (action === "coverPatch") {
          if (event.itemId) {
            covers.refreshCoverForItem(event.itemId);
          }
          continue;
        }
        if (action === "softRefresh") {
          softRefresh = true;
        }
      }
      if (softRefresh) {
        // Same soft path as index-sync republish: no cache clear, no cold load.
        query.syncRepublishRef.current?.flush();
      }
    },
    [
      covers.refreshCoverForItem,
      list.filterRef,
      list.pruneItem,
      query.syncRepublishRef,
    ],
  );

  return {
    items: list.committedItems,
    thumbnailPaths: list.committedThumbnailPaths,
    thumbnailStamps: list.committedThumbnailStamps,
    thumbnailSizes: list.committedThumbnailSizes,
    totalCount: list.committedTotalCount,
    isLoading: showSkeleton,
    isLoadingMore: list.isLoadingMore,
    hasMore: list.committedHasMore,
    error: list.error,
    loadMore: query.loadMore,
    pruneItem: list.pruneItem,
    refreshCoverForItem: covers.refreshCoverForItem,
    applyPresentationEvents,
  };
}
