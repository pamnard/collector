import type { Theme } from "../../hooks/useTheme";
import type { SidebarMode } from "../../types/sidebar-mode";
import type { NavFilter } from "../../types/ui";

export type AppShellSidebarContentProps = {
  mode: SidebarMode;
  onModeChange: (mode: SidebarMode) => void;
  activeFilter: NavFilter;
  onFilterSelect: (filter: NavFilter) => void;
  vaultRevision: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchIndexBuilding: boolean;
  theme: Theme;
  onToggleTheme: () => void;
};

export function buildAppShellSidebarContentProps(
  input: AppShellSidebarContentProps,
): AppShellSidebarContentProps {
  return {
    mode: input.mode,
    onModeChange: input.onModeChange,
    activeFilter: input.activeFilter,
    onFilterSelect: input.onFilterSelect,
    vaultRevision: input.vaultRevision,
    searchQuery: input.searchQuery,
    onSearchChange: input.onSearchChange,
    searchIndexBuilding: input.searchIndexBuilding,
    theme: input.theme,
    onToggleTheme: input.onToggleTheme,
  };
}
