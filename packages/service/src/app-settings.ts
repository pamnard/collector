/**
 * App settings I/O + subscribe cache (#150).
 * Host injects config-dir / FS / legacy+dev-mock adapters (Tauri/localStorage stay outside).
 */

import type { AppSettings } from "@collector/shared";
import {
  createDefaultAppSettings,
  mergeAppSettings,
  readAppSettings,
  writeAppSettings,
  type FileSystemAdapter,
} from "@collector/core";

export interface AppSettingsServiceDeps {
  fs: FileSystemAdapter;
  ensureConfigDir: () => Promise<string>;
  isDevMock: () => boolean;
  readLegacySettings: () => Partial<AppSettings>;
  readDevMockSettings: () => AppSettings | null;
  writeDevMockSettings: (settings: AppSettings) => void;
}

export interface AppSettingsService {
  ensureAppSettings(): Promise<AppSettings>;
  getAppSettingsSync(): AppSettings | null;
  updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  subscribeAppSettings(onUpdate: (settings: AppSettings) => void): () => void;
  getAppConfigDirectory(): Promise<string>;
}

export function createAppSettingsService(
  deps: AppSettingsServiceDeps,
): AppSettingsService {
  let cache: AppSettings | null = null;
  const listeners = new Set<(settings: AppSettings) => void>();

  const notify = (settings: AppSettings): void => {
    for (const listener of listeners) {
      listener(settings);
    }
  };

  const ensureAppSettings = async (): Promise<AppSettings> => {
    if (deps.isDevMock()) {
      if (cache) {
        return cache;
      }

      const stored = deps.readDevMockSettings();
      if (stored) {
        cache = stored;
        return cache;
      }

      cache = mergeAppSettings(
        createDefaultAppSettings(),
        deps.readLegacySettings(),
      );
      deps.writeDevMockSettings(cache);
      return cache;
    }

    if (cache) {
      return cache;
    }

    const dir = await deps.ensureConfigDir();
    const stored = await readAppSettings(deps.fs, dir);
    if (stored) {
      cache = stored;
      return cache;
    }

    const legacy = deps.readLegacySettings();
    cache = mergeAppSettings(createDefaultAppSettings(), legacy);
    await writeAppSettings(deps.fs, dir, cache);
    return cache;
  };

  return {
    ensureAppSettings,
    getAppSettingsSync() {
      return cache;
    },
    async updateAppSettings(patch) {
      const current = await ensureAppSettings();
      cache = mergeAppSettings(current, patch);

      // Notify React immediately (match mock path) so nav_filter / dashboard
      // do not wait on settings.json disk I/O (#176).
      notify(cache);

      if (deps.isDevMock()) {
        deps.writeDevMockSettings(cache);
        return cache;
      }

      await writeAppSettings(deps.fs, await deps.ensureConfigDir(), cache);
      return cache;
    },
    subscribeAppSettings(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getAppConfigDirectory() {
      return deps.ensureConfigDir();
    },
  };
}
