import type { TelegramBotApiClient } from "./client.js";
import type { TelegramUser } from "./types.js";

/** Bot identity — aligns with Telegram Token settings. */
export function createTelegramIdentityApi(client: TelegramBotApiClient) {
  return {
    getMe(token: string): Promise<TelegramUser> {
      return client.callMethod<TelegramUser>(token, "getMe");
    },
  };
}
