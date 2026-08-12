/**
 * Dashboard snapshot port over host RPC (#552).
 * ensure/persist/clear → host; peek/build stay local (client cache / pure).
 */

import type {
  DashboardItemSort,
  DashboardSnapshotPort,
  NavFilter,
} from "@collector/api";
import type { DashboardSnapshot } from "@collector/shared";
import {
  DASHBOARD_SNAPSHOT_VERSION,
  dashboardSnapshotMatchesQuery,
} from "@collector/shared";
import type { HostWireClient } from "@collector/service/wire";
import { navFilterToSetting } from "../nav-filter.js";

export type HostDashboardSnapshotPortOptions = {
  onSnapshotLoaded?: (snapshot: DashboardSnapshot) => void;
};

export function createHostDashboardSnapshotPort(
  transport: HostWireClient,
  options: HostDashboardSnapshotPortOptions = {},
): DashboardSnapshotPort {
  let snapshotCache: DashboardSnapshot | null = null;
  let snapshotCacheLoaded = false;

  const remember = (snapshot: DashboardSnapshot | null): void => {
    snapshotCache = snapshot;
    snapshotCacheLoaded = true;
    if (snapshot) {
      options.onSnapshotLoaded?.(snapshot);
    }
  };

  return {
    ensureDashboardSnapshot: async (): Promise<DashboardSnapshot | null> => {
      if (snapshotCacheLoaded) {
        return snapshotCache;
      }
      const snapshot = (await transport.request(
        "ensureDashboardSnapshot",
      )) as DashboardSnapshot | null;
      remember(snapshot);
      return snapshot;
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
      await transport.request("persistDashboardSnapshot", { snapshot: next });
      remember(next);
    },
    clearDashboardSnapshot: async (): Promise<void> => {
      await transport.request("clearDashboardSnapshot");
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
      coverPaths?: DashboardSnapshot["cover_paths"];
      bodyStamps?: Record<string, string>;
    }): DashboardSnapshot {
      return {
        schema_version: DASHBOARD_SNAPSHOT_VERSION,
        vault_id: input.vaultId,
        nav_filter: navFilterToSetting(input.filter),
        search: input.search,
        sort_key: input.sort?.key ?? "created_at",
        sort_dir: input.sort?.dir ?? "desc",
        item_ids: input.itemIds,
        items: input.items,
        body_stamps: input.bodyStamps ?? {},
        total_count: input.totalCount,
        stream_end_offset: input.streamEndOffset,
        cover_paths: input.coverPaths ?? {},
        saved_at: new Date().toISOString(),
      };
    },
  };
}
