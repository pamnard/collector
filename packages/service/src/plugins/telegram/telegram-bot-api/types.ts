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

/** Shared file fields for video / animation / audio / voice / video_note / sticker. */
export interface TelegramFileAttachment {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_name?: string;
  mime_type?: string;
}

export interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  entities?: TelegramMessageEntity[];
  caption_entities?: TelegramMessageEntity[];
  media_group_id?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  video?: TelegramFileAttachment;
  animation?: TelegramFileAttachment;
  audio?: TelegramFileAttachment;
  voice?: TelegramFileAttachment;
  video_note?: TelegramFileAttachment;
  sticker?: TelegramFileAttachment;
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

export interface TelegramWebhookInfo {
  url: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  ip_address?: string;
}
