/**
 * Telegram Bot API errors and user-facing formatters (#415 / #433 / #675).
 */

import { TELEGRAM_WEBHOOK_BLOCKS_POLLING_MESSAGE } from "./constants.js";

export class TelegramBotApiError extends Error {
  readonly statusCode?: number;
  readonly telegramDescription?: string;
  /** True when Telegram API host was unreachable or the request timed out. */
  readonly connectivity: boolean;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      telegramDescription?: string;
      connectivity?: boolean;
    },
  ) {
    super(message);
    this.name = "TelegramBotApiError";
    this.statusCode = options?.statusCode;
    this.telegramDescription = options?.telegramDescription;
    this.connectivity = options?.connectivity === true;
  }
}

export function isTelegramConnectivityError(error: unknown): boolean {
  return error instanceof TelegramBotApiError && error.connectivity;
}

/** For wrapped `new Error(formatTelegramSyncError(...))` where the class is lost. */
export function isTelegramConnectivityErrorMessage(message: string): boolean {
  return (
    /network error:/i.test(message) || /timed out after \d+ms/i.test(message)
  );
}

export function isTelegramDownloadLimitError(error: unknown): boolean {
  if (!(error instanceof TelegramBotApiError)) {
    return false;
  }
  return /exceeds download limit|exceeds limit/.test(error.message);
}

export function isTelegramWebhookConflictError(error: unknown): boolean {
  if (!(error instanceof TelegramBotApiError)) {
    return false;
  }
  const text = `${error.telegramDescription ?? ""} ${error.message}`;
  return /webhook/i.test(text) || /Conflict:.*getUpdates/i.test(text);
}

/** User-facing Russian message for settings / sync errors. */
export function formatTelegramSyncError(error: unknown): string {
  if (isTelegramWebhookConflictError(error)) {
    return TELEGRAM_WEBHOOK_BLOCKS_POLLING_MESSAGE;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
