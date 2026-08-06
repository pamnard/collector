import { useEffect } from "react";
import { useAppSettings } from "../context/AppSettingsContext";
import { RELEASES_LATEST_URL } from "../services/updater-service";

export function useCheckUpdatesOnStart() {
  const { settings, setCheckUpdatesOnStart } = useAppSettings();
  return { enabled: settings.check_updates_on_start, setEnabled: setCheckUpdatesOnStart };
}

/**
 * Startup reminder for manual Releases updates (#555).
 * No in-app check — opens messaging via onUpdateFound with a static hint.
 */
export function useStartupUpdateCheck(
  enabled: boolean,
  onUpdateFound: (version: string) => void,
) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    onUpdateFound(`см. ${RELEASES_LATEST_URL}`);
  }, [enabled, onUpdateFound]);
}
