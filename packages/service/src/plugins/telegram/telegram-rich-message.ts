/**
 * Flatten Bot API 10.1+ inbound `rich_message` into markdown + media targets.
 * User clients paste formatted text as `rich_message` with no `text`/`caption`.
 */

import type {
  TelegramFileAttachment,
  TelegramPhotoSize,
} from "./telegram-bot-api/types.js";

/** Same shape as telegram-map `TelegramDownloadTarget` (kept local to avoid cycles). */
export interface RichMessageDownloadTarget {
  fileId: string;
  fileSize?: number;
  defaultName: string;
  kind: string;
}

/** Inbound RichMessage (Message.rich_message). */
export interface TelegramRichMessage {
  blocks: TelegramRichBlock[];
  is_rtl?: boolean;
}

/** Loose block shape — Bot API adds block kinds over time. */
export type TelegramRichBlock = {
  type: string;
  text?: unknown;
  size?: number;
  language?: string;
  expression?: string;
  items?: TelegramRichListItem[];
  caption?: { text?: unknown };
  photo?: TelegramPhotoSize[];
  video?: TelegramFileAttachment;
  animation?: TelegramFileAttachment;
  audio?: TelegramFileAttachment;
  document?: TelegramFileAttachment;
  voice_note?: TelegramFileAttachment;
  cells?: Array<{ text?: unknown }>;
  rows?: Array<{ cells?: Array<{ text?: unknown }> }>;
  blocks?: TelegramRichBlock[];
};

export interface TelegramRichListItem {
  label?: string;
  blocks?: TelegramRichBlock[];
  has_checkbox?: true;
  is_checked?: true;
}

function asRichText(value: unknown): unknown {
  return value;
}

/**
 * Flatten RichText (string | nested typed nodes | arrays) to markdown inline.
 */
export function formatRichTextToMarkdown(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((part) => formatRichTextToMarkdown(part)).join("");
  }
  if (typeof value !== "object") {
    return "";
  }
  const node = value as Record<string, unknown>;
  const type = typeof node.type === "string" ? node.type : "";
  const inner = formatRichTextToMarkdown(node.text);

  switch (type) {
    case "bold":
      return inner ? `**${inner}**` : "";
    case "italic":
      return inner ? `*${inner}*` : "";
    case "underline":
      return inner ? `<u>${inner}</u>` : "";
    case "strikethrough":
      return inner ? `~~${inner}~~` : "";
    case "spoiler":
      return inner ? `||${inner}||` : "";
    case "code":
      return inner ? `\`${inner.replace(/`/g, "\\`")}\`` : "";
    case "url": {
      const url = typeof node.url === "string" ? node.url : "";
      if (!url) {
        return inner;
      }
      const label = inner || url;
      return `[${label.replace(/\\/g, "\\\\").replace(/]/g, "\\]")}](${url})`;
    }
    case "email_address": {
      const email =
        typeof node.email_address === "string" ? node.email_address : inner;
      return email;
    }
    case "phone_number": {
      const phone =
        typeof node.phone_number === "string" ? node.phone_number : inner;
      return phone;
    }
    case "mention":
    case "hashtag":
    case "cashtag":
    case "bot_command":
    case "text_mention":
      return inner;
    case "custom_emoji": {
      const alt =
        typeof node.alternative_text === "string"
          ? node.alternative_text
          : "";
      return alt || inner;
    }
    case "mathematical_expression": {
      const expression =
        typeof node.expression === "string" ? node.expression : "";
      return expression ? `\`${expression}\`` : "";
    }
    default:
      // Unknown wrapper or plain object with nested text — unwrap.
      if ("text" in node) {
        return inner;
      }
      if (typeof node.expression === "string") {
        return node.expression;
      }
      return "";
  }
}

function formatListItem(item: TelegramRichListItem): string {
  const label = item.label?.trim() || "-";
  const checkbox =
    item.has_checkbox === true
      ? item.is_checked === true
        ? "[x] "
        : "[ ] "
      : "";
  const body = (item.blocks ?? [])
    .map((block) => formatRichBlockToMarkdown(block).trim())
    .filter((line) => line.length > 0)
    .join("\n");
  if (!body) {
    return `${label} ${checkbox}`.trimEnd();
  }
  const [first, ...rest] = body.split("\n");
  const head = `${label} ${checkbox}${first}`.replace(/\s+/g, " ").trimEnd();
  if (rest.length === 0) {
    return head;
  }
  return [head, ...rest.map((line) => `  ${line}`)].join("\n");
}

function formatRichBlockToMarkdown(block: TelegramRichBlock): string {
  switch (block.type) {
    case "paragraph":
    case "footer":
      return formatRichTextToMarkdown(asRichText(block.text));
    case "heading": {
      const level = Math.min(6, Math.max(1, block.size ?? 1));
      const hashes = "#".repeat(level);
      const text = formatRichTextToMarkdown(asRichText(block.text)).trim();
      return text ? `${hashes} ${text}` : "";
    }
    case "pre": {
      const lang = block.language?.trim() ?? "";
      const text = formatRichTextToMarkdown(asRichText(block.text));
      return `\`\`\`${lang}\n${text}\n\`\`\``;
    }
    case "divider":
      return "---";
    case "mathematical_expression": {
      const expression = block.expression?.trim() ?? "";
      return expression ? `\`\`\`\n${expression}\n\`\`\`` : "";
    }
    case "list": {
      const items = block.items ?? [];
      return items.map((item) => formatListItem(item)).join("\n");
    }
    case "blockquote":
    case "expandable_blockquote":
    case "pullquote": {
      const nested = (block.blocks ?? [])
        .map((child) => formatRichBlockToMarkdown(child).trim())
        .filter(Boolean)
        .join("\n");
      const fromText = formatRichTextToMarkdown(asRichText(block.text)).trim();
      const body = nested || fromText;
      if (!body) {
        return "";
      }
      return body
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    }
    case "details": {
      const nested = (block.blocks ?? [])
        .map((child) => formatRichBlockToMarkdown(child).trim())
        .filter(Boolean)
        .join("\n\n");
      return nested;
    }
    case "table": {
      const rows = block.rows ?? [];
      if (rows.length === 0 && block.cells) {
        return block.cells
          .map((cell) => formatRichTextToMarkdown(asRichText(cell.text)).trim())
          .filter(Boolean)
          .join(" | ");
      }
      const lines: string[] = [];
      rows.forEach((row, rowIndex) => {
        const cells = (row.cells ?? []).map((cell) =>
          formatRichTextToMarkdown(asRichText(cell.text)).trim() || " ",
        );
        lines.push(`| ${cells.join(" | ")} |`);
        if (rowIndex === 0) {
          lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
        }
      });
      return lines.join("\n");
    }
    case "photo":
    case "video":
    case "animation":
    case "audio":
    case "document":
    case "voice_note": {
      const caption = formatRichTextToMarkdown(
        asRichText(block.caption?.text),
      ).trim();
      return caption;
    }
    case "anchor":
    case "buttons":
    case "collage":
    case "slideshow":
    case "map":
    case "thinking":
      return "";
    default: {
      // Unknown block: try nested blocks / text so future kinds still import.
      const nested = (block.blocks ?? [])
        .map((child) => formatRichBlockToMarkdown(child).trim())
        .filter(Boolean)
        .join("\n\n");
      if (nested) {
        return nested;
      }
      return formatRichTextToMarkdown(asRichText(block.text)).trim();
    }
  }
}

export function formatRichMessageToMarkdown(
  rich: TelegramRichMessage | null | undefined,
): string | undefined {
  if (!rich || !Array.isArray(rich.blocks) || rich.blocks.length === 0) {
    return undefined;
  }
  const parts = rich.blocks
    .map((block) => formatRichBlockToMarkdown(block).trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join("\n\n");
}

export function richMessageHasText(
  rich: TelegramRichMessage | null | undefined,
): boolean {
  const markdown = formatRichMessageToMarkdown(rich);
  return Boolean(markdown && markdown.trim().length > 0);
}

export function richMessageHasMedia(
  rich: TelegramRichMessage | null | undefined,
): boolean {
  if (!rich?.blocks) {
    return false;
  }
  for (const block of rich.blocks) {
    if (block.type === "photo" && block.photo && block.photo.length > 0) {
      return true;
    }
    if (block.type === "video" && block.video?.file_id) {
      return true;
    }
    if (block.type === "animation" && block.animation?.file_id) {
      return true;
    }
    if (block.type === "audio" && block.audio?.file_id) {
      return true;
    }
    if (block.type === "document" && block.document?.file_id) {
      return true;
    }
    if (block.type === "voice_note" && block.voice_note?.file_id) {
      return true;
    }
    if (block.blocks && richMessageHasMedia({ blocks: block.blocks })) {
      return true;
    }
    if (block.items) {
      for (const item of block.items) {
        if (
          item.blocks &&
          richMessageHasMedia({ blocks: item.blocks })
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function largestPhoto(photos: TelegramPhotoSize[]): TelegramPhotoSize {
  let best = photos[0]!;
  for (const size of photos) {
    if ((size.file_size ?? 0) >= (best.file_size ?? 0)) {
      best = size;
    }
  }
  return best;
}

function pushBlockMediaTargets(
  block: TelegramRichBlock,
  targets: RichMessageDownloadTarget[],
): void {
  if (block.type === "photo" && block.photo && block.photo.length > 0) {
    const best = largestPhoto(block.photo);
    targets.push({
      fileId: best.file_id,
      fileSize: best.file_size,
      defaultName: "photo.jpg",
      kind: "photo",
    });
  }
  if (block.type === "video" && block.video?.file_id) {
    targets.push({
      fileId: block.video.file_id,
      fileSize: block.video.file_size,
      defaultName: block.video.file_name?.trim() || "video.mp4",
      kind: "video",
    });
  }
  if (block.type === "animation" && block.animation?.file_id) {
    targets.push({
      fileId: block.animation.file_id,
      fileSize: block.animation.file_size,
      defaultName: block.animation.file_name?.trim() || "animation.mp4",
      kind: "animation",
    });
  }
  if (block.type === "document" && block.document?.file_id) {
    targets.push({
      fileId: block.document.file_id,
      fileSize: block.document.file_size,
      defaultName: block.document.file_name?.trim() || "document.bin",
      kind: "document",
    });
  }
  if (block.type === "audio" && block.audio?.file_id) {
    targets.push({
      fileId: block.audio.file_id,
      fileSize: block.audio.file_size,
      defaultName: block.audio.file_name?.trim() || "audio.mp3",
      kind: "audio",
    });
  }
  if (block.type === "voice_note" && block.voice_note?.file_id) {
    targets.push({
      fileId: block.voice_note.file_id,
      fileSize: block.voice_note.file_size,
      defaultName: "voice.ogg",
      kind: "voice",
    });
  }
  for (const child of block.blocks ?? []) {
    pushBlockMediaTargets(child, targets);
  }
  for (const item of block.items ?? []) {
    for (const child of item.blocks ?? []) {
      pushBlockMediaTargets(child, targets);
    }
  }
}

export function listRichMessageDownloadTargets(
  rich: TelegramRichMessage | null | undefined,
): RichMessageDownloadTarget[] {
  if (!rich?.blocks) {
    return [];
  }
  const targets: RichMessageDownloadTarget[] = [];
  for (const block of rich.blocks) {
    pushBlockMediaTargets(block, targets);
  }
  return targets;
}
