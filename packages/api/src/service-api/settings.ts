import type { AppSettings } from "@collector/shared";
import type { Subscription } from "./shared.js";

/** App settings persistence port (#361). */
export interface SettingsPort {
  ensureAppSettings(): Promise<AppSettings>;
  /**
   * @deprecated In-process sync read — use {@link UiSession.settingsSync} (#363).
   * External clients: async {@link SettingsPort.ensureAppSettings} + subscribe.
   */
  getAppSettingsSync(): AppSettings | null;
  updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  subscribeAppSettings(onUpdate: (settings: AppSettings) => void): Subscription;
  getAppConfigDirectory(): Promise<string>;
}
