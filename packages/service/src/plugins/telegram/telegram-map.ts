/**
 * Map Telegram Bot API updates → NormalizedSyncItem (#415).
 * No sourceRef — dedup is delete-after-save + awaiting_delete ledger.
 */

import type { NormalizedSyncItem } from "@collector/api";
import type { TelegramMessage, TelegramUpdate } from "./telegram-bot-api.js";
import { telegramRemoteId } from "./telegram-config.js";

export function deriveTelegramTitle(message: TelegramMessage): string {
  const text = (message.text ?? message.caption ?? "").trim();
  if (text) {
    const line = text.split(/\r?\n/, 1)[0]!.trim();
    if (line.length <= 80) {
      return line;
    }
    return `${line.slice(0, 77)}...`;
  }
  if (message.photo && message.photo.length > 0) {
    return "Telegram photo";
  }
  if (message.document) {
    return message.document.file_name?.trim() || "Telegram document";
  }
  return "Telegram message";
}

export function messageHasImportableContent(message: TelegramMessage): boolean {
  const text = (message.text ?? message.caption ?? "").trim();
  if (text) {
    return true;
  }
  if (message.photo && message.photo.length > 0) {
    return true;
  }
  if (message.document) {
    return true;
  }
  return false;
}

export function largestPhotoFileId(message: TelegramMessage): string | null {
  const photos = message.photo;
  if (!photos || photos.length === 0) {
    return null;
  }
  let best = photos[0]!;
  for (const size of photos) {
    if ((size.file_size ?? 0) >= (best.file_size ?? 0)) {
      best = size;
    }
  }
  return best.file_id;
}

export function mapTelegramMessageToItem(
  message: TelegramMessage,
  folderPath: string,
  media?: Array<{ name: string; bytes: Uint8Array }>,
): NormalizedSyncItem {
  const body = (message.text ?? message.caption ?? "").trim() || undefined;
  return {
    remoteId: telegramRemoteId(message.chat.id, message.message_id),
    title: deriveTelegramTitle(message),
    content_type: "note",
    body,
    folder_path: folderPath,
    ...(media && media.length > 0 ? { media } : {}),
  };
}

export function collectImportableMessages(
  updates: TelegramUpdate[],
): TelegramMessage[] {
  const out: TelegramMessage[] = [];
  for (const update of updates) {
    const message = update.message;
    if (!message) {
      continue;
    }
    if (!messageHasImportableContent(message)) {
      continue;
    }
    out.push(message);
  }
  return out;
}

export function nextTelegramCursor(updates: TelegramUpdate[]): string | null {
  if (updates.length === 0) {
    return null;
  }
  let maxId = updates[0]!.update_id;
  for (const update of updates) {
    if (update.update_id > maxId) {
      maxId = update.update_id;
    }
  }
  return String(maxId + 1);
}

export function parseTelegramCursor(cursor: string | null): number | undefined {
  if (cursor === null || cursor === "") {
    return undefined;
  }
  const n = Number(cursor);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`telegram: invalid sync cursor ${cursor}`);
  }
  return Math.floor(n);
}
