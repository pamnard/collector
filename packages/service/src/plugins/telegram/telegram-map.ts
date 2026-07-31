/**
 * Map Telegram Bot API updates → NormalizedSyncItem (#415 / #433).
 * No sourceRef — dedup is delete-after-save + awaiting_delete ledger.
 */

import type { NormalizedSyncItem } from "@collector/api";
import type { TelegramMessage, TelegramUpdate } from "./telegram-bot-api.js";
import {
  telegramAlbumRemoteId,
  telegramRemoteId,
} from "./telegram-config.js";

export interface TelegramDownloadTarget {
  fileId: string;
  fileSize?: number;
  defaultName: string;
  kind: string;
}

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
  if (message.video) {
    return "Telegram video";
  }
  if (message.animation) {
    return "Telegram animation";
  }
  if (message.audio) {
    return message.audio.file_name?.trim() || "Telegram audio";
  }
  if (message.voice) {
    return "Telegram voice";
  }
  if (message.video_note) {
    return "Telegram video note";
  }
  if (message.sticker) {
    return "Telegram sticker";
  }
  if (message.document) {
    return message.document.file_name?.trim() || "Telegram document";
  }
  return "Telegram message";
}

export function deriveTelegramAlbumTitle(messages: TelegramMessage[]): string {
  for (const message of messages) {
    const text = (message.text ?? message.caption ?? "").trim();
    if (text) {
      return deriveTelegramTitle(message);
    }
  }
  return "Telegram album";
}

export function messageHasImportableContent(message: TelegramMessage): boolean {
  const text = (message.text ?? message.caption ?? "").trim();
  if (text) {
    return true;
  }
  if (message.photo && message.photo.length > 0) {
    return true;
  }
  if (message.video) {
    return true;
  }
  if (message.animation) {
    return true;
  }
  if (message.audio) {
    return true;
  }
  if (message.voice) {
    return true;
  }
  if (message.video_note) {
    return true;
  }
  if (message.sticker) {
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

/**
 * Targets to download for one message.
 * animation supersedes document (Bot API compatibility duplicate).
 */
export function listDownloadTargets(
  message: TelegramMessage,
): TelegramDownloadTarget[] {
  const targets: TelegramDownloadTarget[] = [];
  const photoId = largestPhotoFileId(message);
  if (photoId) {
    const photos = message.photo!;
    let best = photos[0]!;
    for (const size of photos) {
      if ((size.file_size ?? 0) >= (best.file_size ?? 0)) {
        best = size;
      }
    }
    targets.push({
      fileId: photoId,
      fileSize: best.file_size,
      defaultName: "photo.jpg",
      kind: "photo",
    });
  }

  if (message.video) {
    targets.push({
      fileId: message.video.file_id,
      fileSize: message.video.file_size,
      defaultName: message.video.file_name?.trim() || "video.mp4",
      kind: "video",
    });
  }

  if (message.animation) {
    targets.push({
      fileId: message.animation.file_id,
      fileSize: message.animation.file_size,
      defaultName: message.animation.file_name?.trim() || "animation.mp4",
      kind: "animation",
    });
  } else if (message.document) {
    targets.push({
      fileId: message.document.file_id,
      fileSize: message.document.file_size,
      defaultName: message.document.file_name?.trim() || "document.bin",
      kind: "document",
    });
  }

  if (message.audio) {
    targets.push({
      fileId: message.audio.file_id,
      fileSize: message.audio.file_size,
      defaultName: message.audio.file_name?.trim() || "audio.mp3",
      kind: "audio",
    });
  }

  if (message.voice) {
    targets.push({
      fileId: message.voice.file_id,
      fileSize: message.voice.file_size,
      defaultName: "voice.ogg",
      kind: "voice",
    });
  }

  if (message.video_note) {
    targets.push({
      fileId: message.video_note.file_id,
      fileSize: message.video_note.file_size,
      defaultName: "video_note.mp4",
      kind: "video_note",
    });
  }

  if (message.sticker) {
    targets.push({
      fileId: message.sticker.file_id,
      fileSize: message.sticker.file_size,
      defaultName: "sticker.webp",
      kind: "sticker",
    });
  }

  return targets;
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

export function mapTelegramAlbumToItem(
  messages: TelegramMessage[],
  folderPath: string,
  media?: Array<{ name: string; bytes: Uint8Array }>,
): NormalizedSyncItem {
  if (messages.length === 0) {
    throw new Error("telegram: album has no messages");
  }
  const first = messages[0]!;
  const mediaGroupId = first.media_group_id;
  if (!mediaGroupId) {
    throw new Error("telegram: album messages missing media_group_id");
  }
  let body: string | undefined;
  for (const message of messages) {
    const text = (message.text ?? message.caption ?? "").trim();
    if (text) {
      body = text;
      break;
    }
  }
  return {
    remoteId: telegramAlbumRemoteId(first.chat.id, mediaGroupId),
    title: deriveTelegramAlbumTitle(messages),
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

/**
 * Decide which pending albums to close this pull.
 * - 10 parts (Telegram max), or
 * - same-chat message after the group in this batch, or
 * - album existed before this pull and received no new parts.
 */
export function selectAlbumsToClose(input: {
  pendingBeforeKeys: Set<string>;
  albums: Map<
    string,
    { chat_id: number; media_group_id: string; messages: TelegramMessage[] }
  >;
  touchedKeys: Set<string>;
  batchMessagesInOrder: TelegramMessage[];
}): string[] {
  const close = new Set<string>();

  for (const [key, album] of input.albums) {
    if (album.messages.length >= 10) {
      close.add(key);
    }
  }

  const lastIndexByKey = new Map<string, number>();
  input.batchMessagesInOrder.forEach((message, index) => {
    const groupId = message.media_group_id?.trim();
    if (!groupId) {
      return;
    }
    lastIndexByKey.set(
      `${message.chat.id}:${groupId}`,
      index,
    );
  });

  for (const [key, album] of input.albums) {
    const lastIdx = lastIndexByKey.get(key);
    if (lastIdx === undefined) {
      continue;
    }
    for (let i = lastIdx + 1; i < input.batchMessagesInOrder.length; i += 1) {
      const later = input.batchMessagesInOrder[i]!;
      if (later.chat.id !== album.chat_id) {
        continue;
      }
      const laterGroup = later.media_group_id?.trim();
      if (laterGroup !== album.media_group_id) {
        close.add(key);
        break;
      }
    }
  }

  for (const [key] of input.albums) {
    if (input.pendingBeforeKeys.has(key) && !input.touchedKeys.has(key)) {
      close.add(key);
    }
  }

  return [...close];
}
