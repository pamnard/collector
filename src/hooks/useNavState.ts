import { useAppSettings } from "../context/AppSettingsContext";
import type { NavFilter } from "../types/ui";

export function useNavState() {
  const { settings, setNavFilter, setNavSearch } = useAppSettings();

  return {
    activeFilter: settings.nav_filter as NavFilter,
    setActiveFilter: setNavFilter,
    searchQuery: settings.nav_search,
    setSearchQuery: setNavSearch,
  };
}
