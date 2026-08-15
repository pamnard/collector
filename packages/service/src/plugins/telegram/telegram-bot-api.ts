/**
 * Telegram Bot API client for Path C sync (#415 / #433).
 * Thin façade: methods live in `telegram-bot-api/` grouped by concern.
 * All requests use a hard AbortSignal timeout — no hanging fetch.
 */

import { createTelegramBotApiClient } from "./telegram-bot-api/client.js";
import { createTelegramFilesApi } from "./telegram-bot-api/files.js";
import { createTelegramIdentityApi } from "./telegram-bot-api/identity.js";
import { createTelegramMessagesApi } from "./telegram-bot-api/messages.js";
import { createTelegramUpdatesApi } from "./telegram-bot-api/updates.js";
import type { TelegramBotApiDeps } from "./telegram-bot-api/client.js";

export {
  TELEGRAM_API_BASE,
  TELEGRAM_DOWNLOAD_TIMEOUT_MS,
  TELEGRAM_MAX_DOWNLOAD_BYTES,
  TELEGRAM_REQUEST_TIMEOUT_MS,
  type TelegramBotApiDeps,
  type TelegramFetch,
} from "./telegram-bot-api/client.js";

export {
  TELEGRAM_WEBHOOK_BLOCKS_POLLING_MESSAGE,
  TelegramBotApiError,
  formatTelegramSyncError,
  isTelegramConnectivityError,
  isTelegramConnectivityErrorMessage,
  isTelegramDownloadLimitError,
  isTelegramWebhookConflictError,
} from "./telegram-bot-api/errors.js";

export type {
  TelegramChat,
  TelegramDocument,
  TelegramFile,
  TelegramFileAttachment,
  TelegramMessage,
  TelegramMessageEntity,
  TelegramPhotoSize,
  TelegramUpdate,
  TelegramUser,
  TelegramWebhookInfo,
} from "./telegram-bot-api/types.js";

export function createTelegramBotApi(deps: TelegramBotApiDeps = {}) {
  const client = createTelegramBotApiClient(deps);
  return {
    ...createTelegramIdentityApi(client),
    ...createTelegramUpdatesApi(client),
    ...createTelegramMessagesApi(client),
    ...createTelegramFilesApi(client),
  };
}

export type TelegramBotApi = ReturnType<typeof createTelegramBotApi>;
