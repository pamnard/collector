import type { TelegramBotApiClient } from "./client.js";

export function createTelegramMessagesApi(client: TelegramBotApiClient) {
  return {
    deleteMessage(
      token: string,
      chatId: number,
      messageId: number,
    ): Promise<true> {
      return client.callMethod<true>(token, "deleteMessage", {
        chat_id: chatId,
        message_id: messageId,
      });
    },
  };
}
