/**
 * Shared Telegram Bot API HTTP client (#415 / #433 / #675).
 * All requests use a hard AbortSignal timeout — no hanging fetch.
 */

import {
  TELEGRAM_API_BASE,
  TELEGRAM_DOWNLOAD_TIMEOUT_MS,
  TELEGRAM_MAX_DOWNLOAD_BYTES,
  TELEGRAM_REQUEST_TIMEOUT_MS,
} from "./constants.js";
import { TelegramBotApiError } from "./errors.js";
import type {
  TelegramApiResponse,
  TelegramBotApiDeps,
  TelegramFetch,
} from "./types.js";

export type TelegramCallMethod = <T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
) => Promise<T>;

export interface TelegramBotApiClient {
  fetchFn: TelegramFetch;
  requestTimeoutMs: number;
  downloadTimeoutMs: number;
  maxDownloadBytes: number;
  callMethod: TelegramCallMethod;
}

export function abortAfter(ms: number): {
  signal: AbortSignal;
  cancel: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, ms);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

export function createTelegramBotApiClient(
  deps: TelegramBotApiDeps = {},
): TelegramBotApiClient {
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
          { connectivity: true },
        );
      }
      throw new TelegramBotApiError(
        `telegram: ${method} network error: ${error instanceof Error ? error.message : String(error)}`,
        { connectivity: true },
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
    fetchFn,
    requestTimeoutMs,
    downloadTimeoutMs,
    maxDownloadBytes,
    callMethod,
  };
}
