/**
 * Re-exports for Telegram Path C (#415 / #433).
 */

export {
  TELEGRAM_API_BASE,
  TELEGRAM_DOWNLOAD_TIMEOUT_MS,
  TELEGRAM_MAX_DOWNLOAD_BYTES,
  TELEGRAM_REQUEST_TIMEOUT_MS,
  TELEGRAM_WEBHOOK_BLOCKS_POLLING_MESSAGE,
  TelegramBotApiError,
  createTelegramBotApi,
  formatTelegramSyncError,
  isTelegramConnectivityError,
  isTelegramConnectivityErrorMessage,
  isTelegramDownloadLimitError,
  isTelegramWebhookConflictError,
  type TelegramBotApi,
  type TelegramBotApiDeps,
  type TelegramMessage,
  type TelegramUpdate,
  type TelegramUser,
  type TelegramWebhookInfo,
} from "./telegram-bot-api.js";

export {
  DEFAULT_TELEGRAM_SYNC_INTERVAL_MS,
  MIN_TELEGRAM_SYNC_INTERVAL_MS,
  TELEGRAM_BOT_TOKEN_KEY,
  TELEGRAM_CONFIG_DIR,
  TELEGRAM_PLUGIN_ID,
  defaultTelegramPluginConfig,
  expandRemoteIdToDeletes,
  flattenFolderPaths,
  isTelegramAlbumRemoteId,
  loadTelegramPluginConfig,
  parseTelegramRemoteId,
  pendingAlbumKey,
  resolveTelegramDestinationFolder,
  saveTelegramPluginConfig,
  telegramAlbumRemoteId,
  telegramRemoteId,
  toTelegramSyncSettings,
  updateTelegramPluginConfig,
  type TelegramPluginConfig,
  type TelegramSyncSettings,
  type TelegramSyncSettingsPatch,
} from "./telegram-config.js";

export {
  collectImportableMessages,
  deriveTelegramTitle,
  listDownloadTargets,
  mapTelegramAlbumToItem,
  mapTelegramMessageToItem,
  messageHasImportableContent,
  nextTelegramCursor,
  parseTelegramCursor,
  selectAlbumsToClose,
} from "./telegram-map.js";

export {
  createTelegramSyncPlugin,
  type TelegramSyncPluginDeps,
} from "./telegram-sync-plugin.js";

export {
  createTelegramSyncService,
  markTelegramLastSyncAt,
  type TelegramSyncServiceDeps,
} from "./telegram-sync-service.js";
