/**
 * Browser/local dashboard snapshot port for UiSession (#332 / #363).
 * Used by IPC and DevMock adapters — not host IPC.
 */

import type {
  DashboardSnapshotPort,
  NavFilter as ApiNavFilter,
} from "@collector/api";
import type { NavFilter as UiNavFilter } from "../types/ui";
import {
  buildDashboardSnapshot as buildDashboardSnapshotLocal,
  clearDashboardSnapshot,
  ensureDashboardSnapshot,
  peekMatchingDashboardSnapshot as peekMatchingDashboardSnapshotLocal,
  persistDashboardSnapshot,
} from "./dashboard-snapshot-service";

function asUiNavFilter(filter: ApiNavFilter): UiNavFilter {
  return filter as UiNavFilter;
}

export function createUiDashboardSnapshotPort(): DashboardSnapshotPort {
  return {
    ensureDashboardSnapshot,
    peekMatchingDashboardSnapshot: (input) =>
      peekMatchingDashboardSnapshotLocal(
        input.vaultId,
        asUiNavFilter(input.filter),
        input.search,
        input.sort,
      ),
    persistDashboardSnapshot,
    clearDashboardSnapshot,
    buildDashboardSnapshot: (input) =>
      buildDashboardSnapshotLocal({
        ...input,
        filter: asUiNavFilter(input.filter),
      }),
  };
}
