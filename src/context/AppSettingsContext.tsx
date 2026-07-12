import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AppSettings } from "@collector/shared";
import {
  DEFAULT_APP_SETTINGS,
  ensureAppSettings,
  subscribeAppSettings,
  updateAppSettings,
} from "../services/app-settings-service";
import type { NavFilter, ViewMode } from "../types/ui";
import { navFilterToSetting } from "../types/ui";
import type { Theme } from "../hooks/useTheme";

interface AppSettingsContextValue {
  ready: boolean;
  settings: AppSettings;
  setTheme: (theme: Theme) => Promise<void>;
  setViewMode: (mode: ViewMode) => Promise<void>;
  setNavFilter: (filter: NavFilter) => Promise<void>;
  setNavSearch: (query: string) => Promise<void>;
  setCheckUpdatesOnStart: (enabled: boolean) => Promise<void>;
  setActiveVaultId: (vaultId: string | null) => Promise<void>;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    ensureAppSettings()
      .then((loaded) => {
        if (!cancelled) {
          setSettings(loaded);
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReady(true);
        }
      });

    return subscribeAppSettings((next) => {
      if (!cancelled) {
        setSettings(next);
      }
    });
  }, []);

  const patch = useCallback(async (partial: Partial<AppSettings>) => {
    const next = await updateAppSettings(partial);
    setSettings(next);
  }, []);

  const value = useMemo<AppSettingsContextValue>(
    () => ({
      ready,
      settings,
      setTheme: (theme) => patch({ theme }),
      setViewMode: (view_mode) => patch({ view_mode }),
      setNavFilter: (filter) => patch({ nav_filter: navFilterToSetting(filter) }),
      setNavSearch: (nav_search) => patch({ nav_search }),
      setCheckUpdatesOnStart: (check_updates_on_start) =>
        patch({ check_updates_on_start }),
      setActiveVaultId: (active_vault_id) => patch({ active_vault_id }),
    }),
    [patch, ready, settings],
  );

  if (!ready) {
    return null;
  }

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings(): AppSettingsContextValue {
  const context = useContext(AppSettingsContext);
  if (!context) {
    throw new Error("useAppSettings must be used within AppSettingsProvider");
  }
  return context;
}
