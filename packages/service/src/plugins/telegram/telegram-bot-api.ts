/**
 * Telegram Bot API client for Path C sync (#415 / #433).
 * Methods are grouped by concern under `./telegram-bot-api/` (#675);
 * this module is the public façade.
 */

export {
  TELEGRAM_API_BASE,
  TELEGRAM_DOWNLOAD_TIMEOUT_MS,
  TELEGRAM_MAX_DOWNLOAD_BYTES,
  TELEGRAM_REQUEST_TIMEOUT_MS,
  TELEGRAM_WEBHOOK_BLOCKS_POLLING_MESSAGE,
} from "./telegram-bot-api/constants.js";

export {
  TelegramBotApiError,
  formatTelegramSyncError,
  isTelegramConnectivityError,
  isTelegramConnectivityErrorMessage,
  isTelegramDownloadLimitError,
  isTelegramWebhookConflictError,
} from "./telegram-bot-api/errors.js";

export type {
  TelegramBotApiDeps,
  TelegramChat,
  TelegramDocument,
  TelegramFetch,
  TelegramFile,
  TelegramFileAttachment,
  TelegramMessage,
  TelegramMessageEntity,
  TelegramPhotoSize,
  TelegramUpdate,
  TelegramUser,
  TelegramWebhookInfo,
} from "./telegram-bot-api/types.js";

import { createAuthMethods } from "./telegram-bot-api/auth.js";
import { createTelegramBotApiClient } from "./telegram-bot-api/client.js";
import { createFileMethods } from "./telegram-bot-api/files.js";
import { createMessageMethods } from "./telegram-bot-api/messages.js";
import type { TelegramBotApiDeps } from "./telegram-bot-api/types.js";
import { createUpdatesMethods } from "./telegram-bot-api/updates.js";

export function createTelegramBotApi(deps: TelegramBotApiDeps = {}) {
  const client = createTelegramBotApiClient(deps);
  return {
    ...createAuthMethods(client),
    ...createUpdatesMethods(client),
    ...createMessageMethods(client),
    ...createFileMethods(client),
  };
}

export type TelegramBotApi = ReturnType<typeof createTelegramBotApi>;
