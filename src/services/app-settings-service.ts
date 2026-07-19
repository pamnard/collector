import { appConfigDir, join } from "@tauri-apps/api/path";
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
} from "@collector/shared";
import { mergeAppSettings } from "@collector/core";
import { createAppSettingsService } from "@collector/service";
import { TauriFileSystemAdapter } from "../adapters/tauri-fs";
import { isDevMock } from "../dev/is-dev-mock";

const LEGACY_KEYS = {
  theme: "theme",
  activeVaultId: "active-vault-id",
  viewMode: "dashboard_view_mode",
  navFilter: "nav_active_filter",
  navSearch: "nav_search_query",
  checkUpdatesOnStart: "settings_check_updates_on_start",
} as const;

let configDir = "";
const fs = new TauriFileSystemAdapter();
const DEV_MOCK_SETTINGS_KEY = "collector-dev-mock-settings";

async function ensureConfigDir(): Promise<string> {
  if (!configDir) {
    configDir = await join(await appConfigDir(), "collector");
  }
  return configDir;
}

function readLegacySettings(): Partial<AppSettings> {
  const theme = localStorage.getItem(LEGACY_KEYS.theme);
  const activeVaultId = localStorage.getItem(LEGACY_KEYS.activeVaultId);
  const viewMode = localStorage.getItem(LEGACY_KEYS.viewMode);
  const navFilter = localStorage.getItem(LEGACY_KEYS.navFilter);
  const navSearch = localStorage.getItem(LEGACY_KEYS.navSearch);
  const checkUpdatesOnStart = localStorage.getItem(LEGACY_KEYS.checkUpdatesOnStart);

  return {
    theme: theme === "light" || theme === "dark" ? theme : undefined,
    active_vault_id: activeVaultId ?? null,
    view_mode: viewMode === "grid" || viewMode === "table" ? viewMode : undefined,
    nav_filter:
      navFilter === "all"
        ? navFilter
        : undefined,
    nav_search: navSearch ?? undefined,
    check_updates_on_start:
      checkUpdatesOnStart === null ? undefined : checkUpdatesOnStart === "true",
  };
}

function readDevMockSettings(): AppSettings | null {
  const raw = localStorage.getItem(DEV_MOCK_SETTINGS_KEY);
  if (!raw) {
    return null;
  }
  return mergeAppSettings(DEFAULT_APP_SETTINGS, JSON.parse(raw) as Partial<AppSettings>);
}

function writeDevMockSettings(settings: AppSettings): void {
  localStorage.setItem(DEV_MOCK_SETTINGS_KEY, JSON.stringify(settings));
}

const appSettings = createAppSettingsService({
  fs,
  ensureConfigDir,
  isDevMock,
  readLegacySettings,
  readDevMockSettings,
  writeDevMockSettings,
});

export const ensureAppSettings = appSettings.ensureAppSettings;
export const getAppSettingsSync = appSettings.getAppSettingsSync;
export const updateAppSettings = appSettings.updateAppSettings;
export const subscribeAppSettings = appSettings.subscribeAppSettings;
export const getAppConfigDirectory = appSettings.getAppConfigDirectory;

export { DEFAULT_APP_SETTINGS };
