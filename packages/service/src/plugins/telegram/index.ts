export {
  TELEGRAM_API_BASE,
  TELEGRAM_DOWNLOAD_TIMEOUT_MS,
  TELEGRAM_MAX_DOWNLOAD_BYTES,
  TELEGRAM_REQUEST_TIMEOUT_MS,
  TelegramBotApiError,
  createTelegramBotApi,
  type TelegramBotApi,
  type TelegramBotApiDeps,
  type TelegramMessage,
  type TelegramUpdate,
  type TelegramUser,
} from "./telegram-bot-api.js";

export {
  TELEGRAM_BOT_TOKEN_KEY,
  TELEGRAM_CONFIG_DIR,
  TELEGRAM_PLUGIN_ID,
  defaultTelegramPluginConfig,
  flattenFolderPaths,
  loadTelegramPluginConfig,
  parseTelegramRemoteId,
  resolveTelegramDestinationFolder,
  saveTelegramPluginConfig,
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
  mapTelegramMessageToItem,
  nextTelegramCursor,
  parseTelegramCursor,
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
