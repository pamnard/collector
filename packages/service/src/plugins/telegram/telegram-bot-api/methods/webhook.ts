import type { TelegramCallMethod } from "../transport.js";
import type { TelegramWebhookInfo } from "../types.js";

export function createWebhookMethods(callMethod: TelegramCallMethod) {
  return {
    getWebhookInfo(token: string): Promise<TelegramWebhookInfo> {
      return callMethod<TelegramWebhookInfo>(token, "getWebhookInfo");
    },

    deleteWebhook(
      token: string,
      input?: { drop_pending_updates?: boolean },
    ): Promise<true> {
      return callMethod<true>(token, "deleteWebhook", {
        ...(input?.drop_pending_updates !== undefined
          ? { drop_pending_updates: input.drop_pending_updates }
          : {}),
      });
    },

    /**
     * If a webhook URL is set, clear it so getUpdates can poll.
     * No-op when url is empty.
     */
    async ensurePollingClearsWebhook(token: string): Promise<boolean> {
      const info = await callMethod<TelegramWebhookInfo>(
        token,
        "getWebhookInfo",
      );
      if (!info.url?.trim()) {
        return false;
      }
      await callMethod<true>(token, "deleteWebhook", {});
      return true;
    },
  };
}
