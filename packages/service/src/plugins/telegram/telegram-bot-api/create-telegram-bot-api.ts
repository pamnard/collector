import { createBotMethods } from "./methods/bot.js";
import { createFileMethods } from "./methods/files.js";
import { createMessageMethods } from "./methods/messages.js";
import { createUpdateMethods } from "./methods/updates.js";
import { createWebhookMethods } from "./methods/webhook.js";
import { createCallMethod } from "./transport.js";
import type { TelegramBotApiDeps } from "./types.js";

/** All requests use a hard AbortSignal timeout — no hanging fetch. */
export function createTelegramBotApi(deps: TelegramBotApiDeps = {}) {
  const callMethod = createCallMethod(deps);

  return {
    ...createBotMethods(callMethod),
    ...createWebhookMethods(callMethod),
    ...createUpdateMethods(callMethod),
    ...createMessageMethods(callMethod),
    ...createFileMethods(deps, callMethod),
  };
}

export type TelegramBotApi = ReturnType<typeof createTelegramBotApi>;
