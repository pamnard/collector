import { useCallback } from "react";
import type { NavigateFunction } from "react-router-dom";
import { dashboardPerfBeginRun } from "../../lib/dashboard-perf";
import type { SidebarMode } from "../../types/sidebar-mode";
import {
  isFolderFilter,
  type NavFilter,
  type ViewMode,
} from "../../types/ui";

export type UseAppLayoutNavInput = {
  navigate: NavigateFunction;
  viewMode: ViewMode;
  activeFilter: NavFilter;
  setActiveFilter: (filter: NavFilter) => void | Promise<void>;
  setViewMode: (mode: ViewMode) => void | Promise<void>;
  setSidebarMode: (mode: SidebarMode) => void;
};

export type UseAppLayoutNavResult = {
  handleFilterSelect: (filter: NavFilter) => void;
  handleViewModeChange: (mode: ViewMode) => void;
  handleFolderSelectFromHeader: (folderPath: string) => void;
};

export function useAppLayoutNav({
  navigate,
  viewMode,
  activeFilter,
  setActiveFilter,
  setViewMode,
  setSidebarMode,
}: UseAppLayoutNavInput): UseAppLayoutNavResult {
  const handleFilterSelect = useCallback(
    (filter: NavFilter) => {
      if (isFolderFilter(filter)) {
        dashboardPerfBeginRun("folder", {
          viewMode,
          folderPath: filter.folderPath,
        });
      }
      void setActiveFilter(filter);
    },
    [setActiveFilter, viewMode],
  );

  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      dashboardPerfBeginRun("viewMode", {
        viewMode: mode,
        folderPath: isFolderFilter(activeFilter)
          ? activeFilter.folderPath
          : undefined,
      });
      void setViewMode(mode);
    },
    [activeFilter, setViewMode],
  );

  const handleFolderSelectFromHeader = useCallback(
    (folderPath: string) => {
      void setActiveFilter({ type: "folder", folderPath });
      setSidebarMode("collections");
      navigate("/");
    },
    [navigate, setActiveFilter, setSidebarMode],
  );

  return {
    handleFilterSelect,
    handleViewModeChange,
    handleFolderSelectFromHeader,
  };
}
