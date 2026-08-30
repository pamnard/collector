export interface SyncNowResult {
  importedCount: number;
  itemIds: string[];
  /** Non-fatal skip reasons from the plugin pull (e.g. oversized file). */
  warnings?: string[];
}

/**
 * Sync plugin host run entrypoint (#29).
 * Not a settings surface — plugin settings live on each plugin (e.g. #415).
 */
export interface SyncPluginsPort {
  syncNow(pluginId: string): Promise<SyncNowResult>;
}
