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
import { DEFAULT_APP_SETTINGS } from "@collector/shared";
import {
  getCollectorService,
  getUiSession,
} from "../services/collector-client";
import { StartupErrorScreen } from "../components/startup/StartupErrorScreen";
import { StartupLoadingScreen } from "../components/startup/StartupLoadingScreen";
import type { NavFilter, ViewMode } from "../types/ui";
import { navFilterToSetting } from "../types/ui";
import type { Theme } from "../hooks/useTheme";

type StartupState =
  | { status: "loading" }
  | { status: "ready"; settings: AppSettings }
  | { status: "error"; message: string };

interface AppSettingsContextValue {
  ready: boolean;
  settings: AppSettings;
  setTheme: (theme: Theme) => Promise<void>;
  setViewMode: (mode: ViewMode) => Promise<void>;
  setTableColumnVisibility: (
    table_column_visibility: Record<string, boolean>,
  ) => Promise<void>;
  setNavFilter: (filter: NavFilter) => Promise<void>;
  setNavSearch: (query: string) => Promise<void>;
  setCheckUpdatesOnStart: (enabled: boolean) => Promise<void>;
  setActiveVaultId: (vaultId: string | null) => Promise<void>;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [startupState, setStartupState] = useState<StartupState>({
    status: "loading",
  });
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    const service = getCollectorService();

    Promise.all([
      service.settings.ensureAppSettings(),
      service.boot.openCollectorDatabase(),
      getUiSession().snapshot.ensureDashboardSnapshot(),
    ])
      .then(([loaded]) => {
        if (cancelled) {
          return;
        }
        setSettings(loaded);
        setStartupState({ status: "ready", settings: loaded });

        void service.boot.ensureCollectorDatabaseHealthy().catch((err) => {
          console.error("[collector] index health check failed:", err);
          if (!cancelled) {
            setStartupState({
              status: "error",
              message: err instanceof Error ? err.message : String(err),
            });
          }
        });
      })
      .catch((err) => {
        console.error("[collector] startup failed:", err);
        if (!cancelled) {
          setStartupState({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });

    const sub = service.settings.subscribeAppSettings((next) => {
      if (!cancelled) {
        setSettings(next);
      }
    });
    return () => sub.unsubscribe();
  }, []);

  const patch = useCallback(async (partial: Partial<AppSettings>) => {
    const next = await getCollectorService().settings.updateAppSettings(partial);
    setSettings(next);
  }, []);

  const value = useMemo<AppSettingsContextValue>(
    () => ({
      ready: true,
      settings,
      setTheme: (theme) => patch({ theme }),
      setViewMode: (view_mode) => patch({ view_mode }),
      setTableColumnVisibility: (table_column_visibility) =>
        patch({ table_column_visibility }),
      setNavFilter: (filter) => patch({ nav_filter: navFilterToSetting(filter) }),
      setNavSearch: (nav_search) => patch({ nav_search }),
      setCheckUpdatesOnStart: (check_updates_on_start) =>
        patch({ check_updates_on_start }),
      setActiveVaultId: (active_vault_id) => patch({ active_vault_id }),
    }),
    [patch, settings],
  );

  if (startupState.status === "loading") {
    return <StartupLoadingScreen />;
  }

  if (startupState.status === "error") {
    return <StartupErrorScreen message={startupState.message} />;
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
