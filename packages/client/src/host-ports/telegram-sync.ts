import type {
  TelegramBotIdentity,
  TelegramSyncPort,
  TelegramSyncSettings,
  TelegramSyncSettingsPatch,
} from "@collector/api";
import type { HostSessionCtx } from "../host-session-ctx.js";

export function createHostTelegramSyncPort(
  ctx: HostSessionCtx,
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
