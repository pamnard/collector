/**
 * Reconstruct markdown from Telegram Bot API message entities (#678).
 * Offsets/lengths are UTF-16 code units per Bot API.
 */

import type {
  TelegramMessage,
  TelegramMessageEntity,
} from "./telegram-bot-api.js";

function utf16Units(text: string): number[] {
  const units: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    units.push(text.charCodeAt(i));
  }
  return units;
}

function sliceUtf16(units: number[], start: number, end: number): string {
  return String.fromCharCode(...units.slice(start, end));
}

function escapeMarkdownLinkLabel(label: string): string {
  return label.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
}

function isValidSpan(
  entity: TelegramMessageEntity,
  unitCount: number,
): boolean {
  if (
    !Number.isInteger(entity.offset) ||
    !Number.isInteger(entity.length) ||
    entity.offset < 0 ||
    entity.length <= 0
  ) {
    return false;
  }
  return entity.offset + entity.length <= unitCount;
}

/**
 * Apply Telegram entities to text. Only `text_link` with a url becomes
 * `[label](url)`. Other types leave the underlying text unchanged.
 */
export function formatTelegramTextToMarkdown(
  text: string,
  entities?: TelegramMessageEntity[],
): string {
  if (!entities || entities.length === 0) {
    return text;
  }

  const units = utf16Units(text);
  const unitCount = units.length;

  const sorted = [...entities]
    .filter((entity) => isValidSpan(entity, unitCount))
    .sort((a, b) => {
      if (a.offset !== b.offset) {
        return a.offset - b.offset;
      }
      return a.length - b.length;
    });

  const parts: string[] = [];
  let cursor = 0;

  for (const entity of sorted) {
    if (entity.offset < cursor) {
      // Overlapping or nested past cursor — skip, keep surrounding text via later slices.
      continue;
    }
    if (entity.offset > cursor) {
      parts.push(sliceUtf16(units, cursor, entity.offset));
    }

    const span = sliceUtf16(units, entity.offset, entity.offset + entity.length);
    if (entity.type === "text_link" && entity.url) {
      parts.push(`[${escapeMarkdownLinkLabel(span)}](${entity.url})`);
    } else {
      parts.push(span);
    }
    cursor = entity.offset + entity.length;
  }

  if (cursor < unitCount) {
    parts.push(sliceUtf16(units, cursor, unitCount));
  }

  return parts.join("");
}

/**
 * Body for vault notes: same source pick as `text ?? caption`, with matching entities.
 * Empty / whitespace-only after format+trim → undefined.
 */
export function telegramMessageFormattedBody(
  message: TelegramMessage,
): string | undefined {
  let raw: string | undefined;
  let entities: TelegramMessageEntity[] | undefined;
  if (message.text !== undefined) {
    raw = message.text;
    entities = message.entities;
  } else if (message.caption !== undefined) {
    raw = message.caption;
    entities = message.caption_entities;
  } else {
    return undefined;
  }

  const formatted = formatTelegramTextToMarkdown(raw, entities).trim();
  return formatted.length > 0 ? formatted : undefined;
}
