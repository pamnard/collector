import { TELEGRAM_API_BASE, TELEGRAM_REQUEST_TIMEOUT_MS } from "./constants.js";
import { TelegramBotApiError } from "./errors.js";
import type { TelegramBotApiDeps, TelegramFetch } from "./types.js";

interface TelegramApiResponse<T> {
  ok: boolean;
  description?: string;
  result?: T;
}

export function abortAfter(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, ms);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

export interface TelegramCallMethod {
  <T>(
    token: string,
    method: string,
    body?: Record<string, unknown>,
  ): Promise<T>;
}

export function createCallMethod(deps: TelegramBotApiDeps): TelegramCallMethod {
  const fetchFn: TelegramFetch = deps.fetchFn ?? fetch;
  const requestTimeoutMs =
    deps.requestTimeoutMs ?? TELEGRAM_REQUEST_TIMEOUT_MS;

  return async function callMethod<T>(
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
  };
}
