import type {
  DashboardItemSort,
  DashboardSnapshotPort,
  NavFilter,
} from "@collector/api";
import type { DashboardSnapshot } from "@collector/shared";
import { dashboardSnapshotMatchesQuery } from "@collector/shared";
import { navFilterToSetting } from "./nav-filter.js";

export function createMemoryDashboardSnapshotPort(): DashboardSnapshotPort {
  let snapshotCache: DashboardSnapshot | null = null;
  let snapshotCacheLoaded = false;

  return {
    ensureDashboardSnapshot: async (): Promise<DashboardSnapshot | null> => {
      snapshotCacheLoaded = true;
      return snapshotCache;
    },
    peekMatchingDashboardSnapshot(input: {
      vaultId: string;
      filter: NavFilter;
      search: string;
      sort?: DashboardItemSort;
    }): DashboardSnapshot | null {
      if (!snapshotCacheLoaded || !snapshotCache) {
        return null;
      }
      if (
        !dashboardSnapshotMatchesQuery(snapshotCache, {
          vaultId: input.vaultId,
          navFilter: navFilterToSetting(input.filter),
          search: input.search,
          sortKey: input.sort?.key,
          sortDir: input.sort?.dir,
        })
      ) {
        return null;
      }
      return snapshotCache;
    },
    persistDashboardSnapshot: async (
      next: DashboardSnapshot,
    ): Promise<void> => {
      snapshotCache = next;
      snapshotCacheLoaded = true;
    },
    clearDashboardSnapshot: async (): Promise<void> => {
      snapshotCache = null;
      snapshotCacheLoaded = true;
    },
    buildDashboardSnapshot(input: {
      vaultId: string;
      filter: NavFilter;
      search: string;
      sort?: DashboardItemSort;
      itemIds: string[];
      items: DashboardSnapshot["items"];
      totalCount: number;
      streamEndOffset: number;
    }): DashboardSnapshot {
      return {
        schema_version: 1,
        vault_id: input.vaultId,
        nav_filter: navFilterToSetting(input.filter),
        search: input.search,
        sort_key: input.sort?.key ?? "created_at",
        sort_dir: input.sort?.dir ?? "desc",
        item_ids: input.itemIds,
        items: input.items,
        total_count: input.totalCount,
        stream_end_offset: input.streamEndOffset,
        saved_at: new Date().toISOString(),
      };
    },
  };
}
