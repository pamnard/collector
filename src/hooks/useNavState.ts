import { useState } from "react";
import type { NavFilter } from "../types/ui";

const FILTER_KEY = "nav_active_filter";
const SEARCH_KEY = "nav_search_query";

function readStoredFilter(): NavFilter {
  const stored = localStorage.getItem(FILTER_KEY);
  if (stored === "all" || stored === "favorite" || stored === "archived") {
    return stored;
  }
  return "all";
}

function readStoredSearch(): string {
  return localStorage.getItem(SEARCH_KEY) ?? "";
}

export function useNavState() {
  const [activeFilter, setActiveFilterState] = useState<NavFilter>(() =>
    readStoredFilter(),
  );
  const [searchQuery, setSearchQueryState] = useState(() => readStoredSearch());

  const setActiveFilter = (filter: NavFilter) => {
    setActiveFilterState(filter);
    localStorage.setItem(FILTER_KEY, filter);
  };

  const setSearchQuery = (query: string) => {
    setSearchQueryState(query);
    if (query) {
      localStorage.setItem(SEARCH_KEY, query);
    } else {
      localStorage.removeItem(SEARCH_KEY);
    }
  };

  return { activeFilter, setActiveFilter, searchQuery, setSearchQuery };
}
