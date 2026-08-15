import type { TelegramCallMethod } from "../transport.js";
import type { TelegramUpdate } from "../types.js";

export function createUpdateMethods(callMethod: TelegramCallMethod) {
  return {
    getUpdates(
      token: string,
      input: { offset?: number; limit?: number; timeout?: number },
    ): Promise<TelegramUpdate[]> {
      return callMethod<TelegramUpdate[]>(token, "getUpdates", {
        offset: input.offset,
        limit: input.limit ?? 100,
        // Short long-poll; hard AbortSignal still caps total wait.
        timeout: input.timeout ?? 0,
      });
    },
  };
}
