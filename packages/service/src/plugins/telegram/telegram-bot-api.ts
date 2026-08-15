/**
 * Public entry for Telegram Bot API client (#415 / #433, #675).
 * Implementation is split by concern under `./telegram-bot-api/`.
 */

export {
  TELEGRAM_API_BASE,
  TELEGRAM_DOWNLOAD_TIMEOUT_MS,
  TELEGRAM_MAX_DOWNLOAD_BYTES,
  TELEGRAM_REQUEST_TIMEOUT_MS,
  TELEGRAM_WEBHOOK_BLOCKS_POLLING_MESSAGE,
} from "./telegram-bot-api/constants.js";

export type {
  TelegramBotApiDeps,
  TelegramChat,
  TelegramDocument,
  TelegramFile,
  TelegramFileAttachment,
  TelegramFetch,
  TelegramMessage,
  TelegramMessageEntity,
  TelegramPhotoSize,
  TelegramUpdate,
  TelegramUser,
  TelegramWebhookInfo,
} from "./telegram-bot-api/types.js";

export {
  TelegramBotApiError,
  formatTelegramSyncError,
  isTelegramConnectivityError,
  isTelegramConnectivityErrorMessage,
  isTelegramDownloadLimitError,
  isTelegramWebhookConflictError,
} from "./telegram-bot-api/errors.js";

export {
  createTelegramBotApi,
  type TelegramBotApi,
} from "./telegram-bot-api/create-telegram-bot-api.js";
