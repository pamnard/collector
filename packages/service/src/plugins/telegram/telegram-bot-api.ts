/**
 * Telegram Bot API client for Path C sync (#415).
 * All requests use a hard AbortSignal timeout — no hanging fetch.
 */

export const TELEGRAM_API_BASE = "https://api.telegram.org";
export const TELEGRAM_REQUEST_TIMEOUT_MS = 15_000;
export const TELEGRAM_DOWNLOAD_TIMEOUT_MS = 60_000;
/** Bot API getFile download limit for bots (20 MiB). */
export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

export type TelegramFetch = typeof fetch;

export interface TelegramBotApiDeps {
  fetchFn?: TelegramFetch;
  requestTimeoutMs?: number;
  downloadTimeoutMs?: number;
  maxDownloadBytes?: number;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  forward_origin?: unknown;
  forward_from?: unknown;
  forward_from_chat?: unknown;
  forward_date?: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  description?: string;
  result?: T;
}

export class TelegramBotApiError extends Error {
  readonly statusCode?: number;
  readonly telegramDescription?: string;

  constructor(
    message: string,
    options?: { statusCode?: number; telegramDescription?: string },
  ) {
    super(message);
    this.name = "TelegramBotApiError";
    this.statusCode = options?.statusCode;
    this.telegramDescription = options?.telegramDescription;
  }
}

function abortAfter(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, ms);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

export function createTelegramBotApi(deps: TelegramBotApiDeps = {}) {
  const fetchFn = deps.fetchFn ?? fetch;
  const requestTimeoutMs = deps.requestTimeoutMs ?? TELEGRAM_REQUEST_TIMEOUT_MS;
  const downloadTimeoutMs =
    deps.downloadTimeoutMs ?? TELEGRAM_DOWNLOAD_TIMEOUT_MS;
  const maxDownloadBytes =
    deps.maxDownloadBytes ?? TELEGRAM_MAX_DOWNLOAD_BYTES;

  async function callMethod<T>(
    token: string,
    method: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    if (!token.trim()) {
      throw new TelegramBotApiError("telegram: bot token required");
    }
    const url = `${TELEGRAM_API_BASE}/bot${token}/${method}`;
    const { signal, cancel } = abortAfter(requestTimeoutMs);
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new TelegramBotApiError(
          `telegram: ${method} timed out after ${requestTimeoutMs}ms`,
        );
      }
      throw new TelegramBotApiError(
        `telegram: ${method} network error: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      cancel();
    }

    const payload = (await response.json()) as TelegramApiResponse<T>;
    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new TelegramBotApiError(
        `telegram: ${method} failed: ${payload.description ?? response.statusText}`,
        {
          statusCode: response.status,
          telegramDescription: payload.description,
        },
      );
    }
    return payload.result;
  }

  return {
    getMe(token: string): Promise<TelegramUser> {
      return callMethod<TelegramUser>(token, "getMe");
    },

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

    getFile(token: string, fileId: string): Promise<TelegramFile> {
      return callMethod<TelegramFile>(token, "getFile", { file_id: fileId });
    },

    async downloadFile(
      token: string,
      filePath: string,
      expectedSize?: number,
    ): Promise<Uint8Array> {
      if (!token.trim()) {
        throw new TelegramBotApiError("telegram: bot token required");
      }
      if (!filePath.trim()) {
        throw new TelegramBotApiError("telegram: file_path required");
      }
      if (
        typeof expectedSize === "number" &&
        expectedSize > maxDownloadBytes
      ) {
        throw new TelegramBotApiError(
          `telegram: file exceeds download limit (${expectedSize} > ${maxDownloadBytes})`,
        );
      }

      const url = `${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`;
      const { signal, cancel } = abortAfter(downloadTimeoutMs);
      let response: Response;
      try {
        response = await fetchFn(url, { method: "GET", signal });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new TelegramBotApiError(
            `telegram: download timed out after ${downloadTimeoutMs}ms`,
          );
        }
        throw new TelegramBotApiError(
          `telegram: download network error: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        cancel();
      }

      if (!response.ok) {
        throw new TelegramBotApiError(
          `telegram: download failed: ${response.status} ${response.statusText}`,
          { statusCode: response.status },
        );
      }

      const buffer = new Uint8Array(await response.arrayBuffer());
      if (buffer.byteLength > maxDownloadBytes) {
        throw new TelegramBotApiError(
          `telegram: downloaded file exceeds limit (${buffer.byteLength} > ${maxDownloadBytes})`,
        );
      }
      return buffer;
    },
  };
}

export type TelegramBotApi = ReturnType<typeof createTelegramBotApi>;
