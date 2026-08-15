/** Telegram Bot API client for Path C sync (#415 / #433). */

export const TELEGRAM_API_BASE = "https://api.telegram.org";
export const TELEGRAM_REQUEST_TIMEOUT_MS = 15_000;
export const TELEGRAM_DOWNLOAD_TIMEOUT_MS = 60_000;
/** Bot API getFile download limit for bots (20 MiB). */
export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

export const TELEGRAM_WEBHOOK_BLOCKS_POLLING_MESSAGE =
  "На боте включён webhook, мешает опросу. Снимите webhook или сохраните токен снова.";
