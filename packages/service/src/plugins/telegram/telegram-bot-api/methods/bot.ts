import type { TelegramCallMethod } from "../transport.js";
import type { TelegramUser } from "../types.js";

export function createBotMethods(callMethod: TelegramCallMethod) {
  return {
    getMe(token: string): Promise<TelegramUser> {
      return callMethod<TelegramUser>(token, "getMe");
    },
  };
}
