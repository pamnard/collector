import { appConfigDir, join } from "@tauri-apps/api/path";
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
} from "@collector/shared";
import {
  createDefaultAppSettings,
  mergeAppSettings,
  readAppSettings,
  writeAppSettings,
} from "@collector/core";
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
let cache: AppSettings | null = null;
const fs = new TauriFileSystemAdapter();
const listeners = new Set<(settings: AppSettings) => void>();
const DEV_MOCK_SETTINGS_KEY = "collector-dev-mock-settings";

function notify(settings: AppSettings): void {
  for (const listener of listeners) {
    listener(settings);
  }
}

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
      navFilter === "all" || navFilter === "favorite" || navFilter === "archived"
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

export async function ensureAppSettings(): Promise<AppSettings> {
  if (isDevMock()) {
    if (cache) {
      return cache;
    }

    const stored = readDevMockSettings();
    if (stored) {
      cache = stored;
      return cache;
    }

    cache = mergeAppSettings(createDefaultAppSettings(), readLegacySettings());
    writeDevMockSettings(cache);
    return cache;
  }

  if (cache) {
    return cache;
  }

  const dir = await ensureConfigDir();
  const stored = await readAppSettings(fs, dir);
  if (stored) {
    cache = stored;
    return cache;
  }

  const legacy = readLegacySettings();
  cache = mergeAppSettings(createDefaultAppSettings(), legacy);
  await writeAppSettings(fs, dir, cache);
  return cache;
}

export function getAppSettingsSync(): AppSettings | null {
  return cache;
}

export async function updateAppSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const current = await ensureAppSettings();
  cache = mergeAppSettings(current, patch);

  if (isDevMock()) {
    writeDevMockSettings(cache);
    notify(cache);
    return cache;
  }

  await writeAppSettings(fs, await ensureConfigDir(), cache);
  notify(cache);
  return cache;
}

export function subscribeAppSettings(
  listener: (settings: AppSettings) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function getAppConfigDirectory(): Promise<string> {
  return ensureConfigDir();
}

export { DEFAULT_APP_SETTINGS };
