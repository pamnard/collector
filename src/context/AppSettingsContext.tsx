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
import { appDataDir, join } from "@tauri-apps/api/path";
import { getCollectorClient, setCollectorClient } from "../services/collector-client";
import {
  bootstrapServiceMode,
  createTauriIpcAdapter,
  isServiceModeEnabled,
} from "../services/tauri-ipc-adapter";
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
    const unsubRef: { current: (() => void) | null } = { current: null };

    void (async () => {
      try {
        if (await isServiceModeEnabled()) {
          const dataDir = await join(await appDataDir(), "collector");
          await bootstrapServiceMode(dataDir);
          setCollectorClient(createTauriIpcAdapter());
        }
        const client = getCollectorClient();
        const [loaded] = await Promise.all([
          client.ensureAppSettings(),
          client.openCollectorDatabase(),
          client.ensureDashboardSnapshot(),
        ]);
        if (cancelled) {
          return;
        }
        setSettings(loaded);
        setStartupState({ status: "ready", settings: loaded });

        void client.ensureCollectorDatabaseHealthy().catch((err) => {
          console.error("[collector] index health check failed:", err);
          if (!cancelled) {
            setStartupState({
              status: "error",
              message: err instanceof Error ? err.message : String(err),
            });
          }
        });

        unsubRef.current = client.subscribeAppSettings((next) => {
          if (!cancelled) {
            setSettings(next);
          }
        });
      } catch (err) {
        console.error("[collector] startup failed:", err);
        if (!cancelled) {
          setStartupState({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubRef.current?.();
    };
  }, []);

  const patch = useCallback(async (partial: Partial<AppSettings>) => {
    const next = await getCollectorClient().updateAppSettings(partial);
    setSettings(next);
  }, []);

  const value = useMemo<AppSettingsContextValue>(
    () => ({
      ready: true,
      settings,
      setTheme: (theme) => patch({ theme }),
      setViewMode: (view_mode) => patch({ view_mode }),
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
