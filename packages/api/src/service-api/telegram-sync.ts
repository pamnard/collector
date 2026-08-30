/** Non-secret Telegram Path C settings (#415). Token stays in CredentialsPort. */
export interface TelegramSyncSettings {
  enabled: boolean;
  folder_path: string;
  bot_username: string | null;
  last_sync_at: string | null;
  /** Non-fatal skips from last pull (oversized files, empty after skip). */
  last_pull_warnings?: string[];
  /** Periodic sync interval; default 300_000 (5 minutes). */
  sync_interval_ms: number;
}

export type TelegramSyncSettingsPatch = Partial<{
  enabled: boolean;
  folder_path: string;
  bot_username: string | null;
  last_sync_at: string | null;
  sync_interval_ms: number;
}>;

export interface TelegramBotIdentity {
  id: number;
  username: string | null;
  first_name: string;
}

/**
 * Telegram plugin settings + token validation (#415).
 * Secrets via CredentialsPort only.
 */
export interface TelegramSyncPort {
  getTelegramSyncSettings(): Promise<TelegramSyncSettings>;
  updateTelegramSyncSettings(
    patch: TelegramSyncSettingsPatch,
  ): Promise<TelegramSyncSettings>;
  validateTelegramBotToken(input: {
    token: string;
  }): Promise<TelegramBotIdentity>;
}
