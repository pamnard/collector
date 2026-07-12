import { useAppSettings } from "../context/AppSettingsContext";
import type { ViewMode } from "../types/ui";

export function useViewMode() {
  const { settings, setViewMode } = useAppSettings();
  return { viewMode: settings.view_mode as ViewMode, setViewMode };
}
