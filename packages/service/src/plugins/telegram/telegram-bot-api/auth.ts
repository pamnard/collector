/**
 * Bot identity / token validation methods (#675).
 * Aligns with Telegram settings token section.
 */

import type { TelegramBotApiClient } from "./client.js";
import type { TelegramUser } from "./types.js";

export function createAuthMethods(client: TelegramBotApiClient) {
  return {
    getMe(token: string): Promise<TelegramUser> {
      return client.callMethod<TelegramUser>(token, "getMe");
    },
  };
}
