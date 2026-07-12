import { useAppSettings } from "../context/AppSettingsContext";
import { navFilterFromSetting, type NavFilter } from "../types/ui";

export function useNavState() {
  const { settings, setNavFilter, setNavSearch } = useAppSettings();

  return {
    activeFilter: navFilterFromSetting(settings.nav_filter),
    setActiveFilter: (filter: NavFilter) => setNavFilter(filter),
    searchQuery: settings.nav_search,
    setSearchQuery: setNavSearch,
  };
}
