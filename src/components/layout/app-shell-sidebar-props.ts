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
