import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "settings_check_updates_on_start";

function readStoredPreference(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function useCheckUpdatesOnStart() {
  const [enabled, setEnabledState] = useState(readStoredPreference);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
  }, []);

  return { enabled, setEnabled };
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
