/**
 * File methods (#675).
 */

import { TELEGRAM_API_BASE } from "./constants.js";
import { abortAfter, type TelegramBotApiClient } from "./client.js";
import { TelegramBotApiError } from "./errors.js";
import type { TelegramFile } from "./types.js";

export function createFileMethods(client: TelegramBotApiClient) {
  const { fetchFn, downloadTimeoutMs, maxDownloadBytes } = client;

  return {
    getFile(token: string, fileId: string): Promise<TelegramFile> {
      return client.callMethod<TelegramFile>(token, "getFile", {
        file_id: fileId,
      });
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
            { connectivity: true },
          );
        }
        throw new TelegramBotApiError(
          `telegram: download network error: ${error instanceof Error ? error.message : String(error)}`,
          { connectivity: true },
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
