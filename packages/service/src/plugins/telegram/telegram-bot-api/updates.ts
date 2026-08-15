/**
 * Updates / webhook / polling methods (#675).
 * Aligns with Telegram settings sync controls (polling path).
 */

import type { TelegramBotApiClient } from "./client.js";
import type { TelegramUpdate, TelegramWebhookInfo } from "./types.js";

export function createUpdatesMethods(client: TelegramBotApiClient) {
  return {
    getWebhookInfo(token: string): Promise<TelegramWebhookInfo> {
      return client.callMethod<TelegramWebhookInfo>(token, "getWebhookInfo");
    },

    deleteWebhook(
      token: string,
      input?: { drop_pending_updates?: boolean },
    ): Promise<true> {
      return client.callMethod<true>(token, "deleteWebhook", {
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
      const info = await client.callMethod<TelegramWebhookInfo>(
        token,
        "getWebhookInfo",
      );
      if (!info.url?.trim()) {
        return false;
      }
      await client.callMethod<true>(token, "deleteWebhook", {});
      return true;
    },

    getUpdates(
      token: string,
      input: { offset?: number; limit?: number; timeout?: number },
    ): Promise<TelegramUpdate[]> {
      return client.callMethod<TelegramUpdate[]>(token, "getUpdates", {
        offset: input.offset,
        limit: input.limit ?? 100,
        // Short long-poll; hard AbortSignal still caps total wait.
        timeout: input.timeout ?? 0,
      });
    },
  };
}
