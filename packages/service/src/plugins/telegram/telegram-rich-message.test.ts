/**
 * Bot API 10.1+ inbound rich_message flattening.
 */

import { describe, expect, it } from "vitest";
import {
  collectImportableMessages,
  deriveTelegramTitle,
  listDownloadTargets,
  mapTelegramMessageToItem,
  messageHasImportableContent,
} from "./telegram-map.js";
import {
  formatRichMessageToMarkdown,
  formatRichTextToMarkdown,
  richMessageHasMedia,
  richMessageHasText,
} from "./telegram-rich-message.js";
import { telegramMessageFormattedBody } from "./telegram-entities.js";

describe("telegram-rich-message", () => {
  it("flattens nested RichText bold/url to markdown", () => {
    expect(formatRichTextToMarkdown({ type: "bold", text: "Hi" })).toBe(
      "**Hi**",
    );
    expect(
      formatRichTextToMarkdown({
        type: "url",
        text: "docs",
        url: "https://example.com",
      }),
    ).toBe("[docs](https://example.com)");
  });

  it("formats paragraph + heading + list blocks like pasted rich paste", () => {
    const markdown = formatRichMessageToMarkdown({
      blocks: [
        { type: "paragraph", text: "Intro line" },
        {
          type: "paragraph",
          text: { type: "bold", text: "Heading-ish" },
        },
        {
          type: "list",
          items: [
            {
              label: "•",
              blocks: [{ type: "paragraph", text: "First item" }],
            },
            {
              label: "•",
              blocks: [{ type: "paragraph", text: "Second item" }],
            },
          ],
        },
      ],
    });
    expect(markdown).toBe(
      ["Intro line", "**Heading-ish**", "• First item\n• Second item"].join(
        "\n\n",
      ),
    );
  });

  it("treats rich_message-only updates as importable", () => {
    const message = {
      message_id: 42,
      date: 0,
      chat: { id: 7, type: "private" },
      rich_message: {
        blocks: [{ type: "paragraph", text: "Rich only body" }],
      },
    };
    expect(messageHasImportableContent(message)).toBe(true);
    expect(richMessageHasText(message.rich_message)).toBe(true);
    expect(richMessageHasMedia(message.rich_message)).toBe(false);
    expect(collectImportableMessages([{ update_id: 1, message }])).toHaveLength(
      1,
    );
    expect(deriveTelegramTitle(message)).toBe("Rich only body");
    expect(telegramMessageFormattedBody(message)).toBe("Rich only body");
    const item = mapTelegramMessageToItem(message, "Inbox");
    expect(item.body).toBe("Rich only body");
    expect(item.title).toBe("Rich only body");
  });

  it("does not treat empty rich_message as importable", () => {
    const message = {
      message_id: 43,
      date: 0,
      chat: { id: 7, type: "private" },
      rich_message: { blocks: [{ type: "anchor", name: "x" }] },
    };
    expect(messageHasImportableContent(message)).toBe(false);
    expect(collectImportableMessages([{ update_id: 2, message }])).toHaveLength(
      0,
    );
  });

  it("lists download targets from rich photo blocks", () => {
    const message = {
      message_id: 44,
      date: 0,
      chat: { id: 7, type: "private" },
      rich_message: {
        blocks: [
          {
            type: "photo",
            photo: [
              {
                file_id: "small",
                file_unique_id: "u1",
                width: 10,
                height: 10,
                file_size: 10,
              },
              {
                file_id: "big",
                file_unique_id: "u2",
                width: 100,
                height: 100,
                file_size: 99,
              },
            ],
            caption: { text: "cap" },
          },
        ],
      },
    };
    expect(messageHasImportableContent(message)).toBe(true);
    expect(listDownloadTargets(message)).toEqual([
      {
        fileId: "big",
        fileSize: 99,
        defaultName: "photo.jpg",
        kind: "photo",
      },
    ]);
    expect(telegramMessageFormattedBody(message)).toBe("cap");
  });
});
