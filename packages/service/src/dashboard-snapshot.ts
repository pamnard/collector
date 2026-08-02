/**
 * Dashboard snapshot I/O + peek/build (#150).
 * Host injects config-dir / FS / dev-mock / query-cache seed (Tauri stays outside).
 */

import type { NavFilter } from "@collector/api";
import {
  DASHBOARD_SNAPSHOT_VERSION,
  dashboardSnapshotMatchesQuery,
  dashboardSnapshotSchema,
  type DashboardSnapshot,
} from "@collector/shared";
import {
  clearDashboardSnapshot as clearDashboardSnapshotFile,
  navFilterToSetting,
  readDashboardSnapshot,
  writeDashboardSnapshot,
  type FileSystemAdapter,
} from "@collector/core";

export interface DashboardSnapshotServiceDeps {
  fs: FileSystemAdapter;
  ensureConfigDir: () => Promise<string>;
  isDevMock: () => boolean;
  readDevMockSnapshot: () => DashboardSnapshot | null;
  writeDevMockSnapshot: (snapshot: DashboardSnapshot | null) => void;
  onSnapshotLoaded?: (snapshot: DashboardSnapshot) => void;
}

export interface DashboardSnapshotService {
  ensureDashboardSnapshot(): Promise<DashboardSnapshot | null>;
  peekMatchingDashboardSnapshot(input: {
    vaultId: string;
    filter: NavFilter;
    search: string;
    sort?: { key: string; dir: "asc" | "desc" };
  }): DashboardSnapshot | null;
  persistDashboardSnapshot(snapshot: DashboardSnapshot): Promise<void>;
  clearDashboardSnapshot(): Promise<void>;
  buildDashboardSnapshot(input: {
    vaultId: string;
    filter: NavFilter;
    search: string;
    sort?: { key: string; dir: "asc" | "desc" };
    itemIds: string[];
    items: DashboardSnapshot["items"];
    totalCount: number;
    streamEndOffset: number;
    coverPaths?: DashboardSnapshot["cover_paths"];
  }): DashboardSnapshot;
}

export function createDashboardSnapshotService(
  deps: DashboardSnapshotServiceDeps,
): DashboardSnapshotService {
  let cache: DashboardSnapshot | null = null;
  let cacheLoaded = false;

  const seedFromSnapshot = (snapshot: DashboardSnapshot): void => {
    deps.onSnapshotLoaded?.(snapshot);
  };

  return {
    async ensureDashboardSnapshot() {
      if (cacheLoaded) {
        return cache;
      }

      if (deps.isDevMock()) {
        cache = deps.readDevMockSnapshot();
        cacheLoaded = true;
        if (cache) {
          seedFromSnapshot(cache);
        }
        return cache;
      }

      cache = await readDashboardSnapshot(
        deps.fs,
        await deps.ensureConfigDir(),
      );
      cacheLoaded = true;
      if (cache) {
        seedFromSnapshot(cache);
      }
      return cache;
    },

    peekMatchingDashboardSnapshot(input) {
      if (!cacheLoaded || !cache) {
        return null;
      }

      if (
        !dashboardSnapshotMatchesQuery(cache, {
          vaultId: input.vaultId,
          navFilter: navFilterToSetting(input.filter),
          search: input.search,
          sortKey: input.sort?.key,
          sortDir: input.sort?.dir,
        })
      ) {
        return null;
      }

      return cache;
    },

    async persistDashboardSnapshot(snapshot) {
      cache = snapshot;
      cacheLoaded = true;

      if (deps.isDevMock()) {
        deps.writeDevMockSnapshot(snapshot);
        return;
      }

      await writeDashboardSnapshot(
        deps.fs,
        await deps.ensureConfigDir(),
        snapshot,
      );
    },

    async clearDashboardSnapshot() {
      cache = null;
      cacheLoaded = true;

      if (deps.isDevMock()) {
        deps.writeDevMockSnapshot(null);
        return;
      }

      await clearDashboardSnapshotFile(deps.fs, await deps.ensureConfigDir());
    },

    buildDashboardSnapshot(input) {
      return dashboardSnapshotSchema.parse({
        schema_version: DASHBOARD_SNAPSHOT_VERSION,
        vault_id: input.vaultId,
        nav_filter: navFilterToSetting(input.filter),
        search: input.search,
        sort_key: input.sort?.key ?? "created_at",
        sort_dir: input.sort?.dir ?? "desc",
        item_ids: input.itemIds,
        items: input.items,
        total_count: input.totalCount,
        stream_end_offset: input.streamEndOffset,
        cover_paths: input.coverPaths ?? {},
        saved_at: new Date().toISOString(),
      });
    },
  };
}
