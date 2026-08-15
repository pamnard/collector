import { DOMAIN_WIRE_METHODS } from "../domain-methods.js";
import { asObject, requireString } from "../handlers/params.js";
import type { DomainDispatchGroup } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

export const TELEGRAM_DISPATCH = {
  [M.getTelegramSyncSettings]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.telegramSync.getTelegramSyncSettings();
    },
  },
  [M.updateTelegramSyncSettings]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.updateTelegramSyncSettings);
      await runtime.ensureInitialized();
      return runtime.telegramSync.updateTelegramSyncSettings({
        ...(typeof p.enabled === "boolean" ? { enabled: p.enabled } : {}),
        ...(typeof p.folder_path === "string"
          ? { folder_path: p.folder_path }
          : {}),
        ...(p.bot_username === null || typeof p.bot_username === "string"
          ? { bot_username: p.bot_username as string | null }
          : {}),
        ...(p.last_sync_at === null || typeof p.last_sync_at === "string"
          ? { last_sync_at: p.last_sync_at as string | null }
          : {}),
        ...(typeof p.sync_interval_ms === "number"
          ? { sync_interval_ms: p.sync_interval_ms }
          : {}),
      });
    },
  },
  [M.validateTelegramBotToken]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.validateTelegramBotToken);
      const token = requireString(
        p.token,
        "token",
        M.validateTelegramBotToken,
      );
      await runtime.ensureInitialized();
      return runtime.telegramSync.validateTelegramBotToken({ token });
    },
  },
} satisfies DomainDispatchGroup;
