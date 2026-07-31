import { useEffect, useRef, useState } from "react";
import type { DashboardItemSort } from "@collector/api";
import { DEFAULT_DASHBOARD_SORT } from "./useDashboardItems";

export type UseDashboardShellSortResult = {
  dashboardSort: DashboardItemSort;
  setDashboardSort: (sort: DashboardItemSort) => void;
};

export function useDashboardShellSort(
  activeVaultId: string | null,
): UseDashboardShellSortResult {
  const [dashboardSort, setDashboardSort] = useState<DashboardItemSort>(
    DEFAULT_DASHBOARD_SORT,
  );
  const prevVaultIdRef = useRef(activeVaultId);

  useEffect(() => {
    if (prevVaultIdRef.current === activeVaultId) {
      return;
    }
    prevVaultIdRef.current = activeVaultId;
    setDashboardSort(DEFAULT_DASHBOARD_SORT);
  }, [activeVaultId]);

  return { dashboardSort, setDashboardSort };
}
