import type { TelegramCallMethod } from "../transport.js";

export function createMessageMethods(callMethod: TelegramCallMethod) {
  return {
    deleteMessage(
      token: string,
      chatId: number,
      messageId: number,
    ): Promise<true> {
      return callMethod<true>(token, "deleteMessage", {
        chat_id: chatId,
        message_id: messageId,
      });
    },
  };
}
