import type { DashboardSnapshot } from "@collector/shared";
import type { NavFilter } from "../domain.js";
import type { DashboardItemSort } from "./items.js";

/**
 * Dashboard snapshot cache — primary home is {@link UiSession.snapshot} (#363).
 * Not a {@link CollectorService} key.
 */
export interface DashboardSnapshotPort {
  ensureDashboardSnapshot(): Promise<DashboardSnapshot | null>;
  peekMatchingDashboardSnapshot(input: {
    vaultId: string;
    filter: NavFilter;
    search: string;
    sort?: DashboardItemSort;
  }): DashboardSnapshot | null;
  persistDashboardSnapshot(snapshot: DashboardSnapshot): Promise<void>;
  clearDashboardSnapshot(): Promise<void>;
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
  }): DashboardSnapshot;
}
