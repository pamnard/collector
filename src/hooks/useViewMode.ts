import { useState } from "react";
import type { ViewMode } from "../types/ui";

const STORAGE_KEY = "dashboard_view_mode";

function readStoredViewMode(): ViewMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "grid" || stored === "table") {
    return stored;
  }
  return "grid";
}

export function useViewMode() {
  const [viewMode, setViewModeState] = useState<ViewMode>(() =>
    readStoredViewMode(),
  );

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    localStorage.setItem(STORAGE_KEY, mode);
  };

  return { viewMode, setViewMode };
}
