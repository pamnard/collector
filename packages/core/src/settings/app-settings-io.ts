import {
  APP_SETTINGS_FILE,
  DEFAULT_APP_SETTINGS,
  appSettingsSchema,
  type AppSettings,
} from "@collector/shared";
import type { FileSystemAdapter } from "../adapters/types.js";

export function appSettingsPath(configDir: string): string {
  return configDir.endsWith("/")
    ? `${configDir}${APP_SETTINGS_FILE}`
    : `${configDir}/${APP_SETTINGS_FILE}`;
}

export async function readAppSettings(
  fs: FileSystemAdapter,
  configDir: string,
): Promise<AppSettings | null> {
  const path = appSettingsPath(configDir);
  if (!(await fs.exists(path))) {
    return null;
  }

  const raw = await fs.readText(path);
  return appSettingsSchema.parse(JSON.parse(raw));
}

export async function writeAppSettings(
  fs: FileSystemAdapter,
  configDir: string,
  settings: AppSettings,
): Promise<void> {
  const parsed = appSettingsSchema.parse(settings);
  await fs.mkdir(configDir);
  await fs.writeText(
    appSettingsPath(configDir),
    JSON.stringify(parsed, null, 2),
  );
}

export function mergeAppSettings(
  current: AppSettings,
  patch: Partial<AppSettings>,
): AppSettings {
  return appSettingsSchema.parse({ ...current, ...patch });
}

export function createDefaultAppSettings(): AppSettings {
  return { ...DEFAULT_APP_SETTINGS };
}
