import type {
  TelegramBotIdentity,
  TelegramSyncPort,
  TelegramSyncSettings,
  TelegramSyncSettingsPatch,
} from "@collector/api";
import type { IpcSessionCtx } from "../ipc-session-ctx.js";

export function createIpcTelegramSyncPort(
  ctx: IpcSessionCtx,
): TelegramSyncPort {
  const { transport } = ctx;
  return {
    getTelegramSyncSettings: async () =>
      transport.request(
        "getTelegramSyncSettings",
      ) as Promise<TelegramSyncSettings>,
    updateTelegramSyncSettings: async (patch: TelegramSyncSettingsPatch) =>
      transport.request(
        "updateTelegramSyncSettings",
        patch,
      ) as Promise<TelegramSyncSettings>,
    validateTelegramBotToken: async (input: { token: string }) =>
      transport.request(
        "validateTelegramBotToken",
        input,
      ) as Promise<TelegramBotIdentity>,
  };
}
