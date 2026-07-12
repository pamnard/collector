import { useEffect } from "react";
import { useAppSettings } from "../context/AppSettingsContext";

export function useCheckUpdatesOnStart() {
  const { settings, setCheckUpdatesOnStart } = useAppSettings();
  return { enabled: settings.check_updates_on_start, setEnabled: setCheckUpdatesOnStart };
}

export function useStartupUpdateCheck(
  enabled: boolean,
  onUpdateFound: (version: string) => void,
) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    import("../services/updater-service")
      .then(async ({ fetchAvailableUpdate, isUpdaterAvailable }) => {
        if (cancelled || !isUpdaterAvailable()) {
          return;
        }

        const update = await fetchAvailableUpdate();
        if (!cancelled && update) {
          onUpdateFound(update.version);
        }
      })
      .catch(() => {
        // Silent on startup: network or missing release should not block the app.
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, onUpdateFound]);
}
