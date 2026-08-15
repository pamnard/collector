import { describe, expect, it } from "vitest";
import {
  formatTelegramTextToMarkdown,
  telegramMessageFormattedBody,
} from "./telegram-entities.js";
import type { TelegramMessage } from "./telegram-bot-api.js";

function baseMessage(
  overrides: Partial<TelegramMessage> = {},
): TelegramMessage {
  return {
    message_id: 1,
    date: 0,
    chat: { id: 1, type: "private" },
    ...overrides,
  };
}

describe("formatTelegramTextToMarkdown", () => {
  it("returns text unchanged when entities are missing", () => {
    expect(formatTelegramTextToMarkdown("plain note")).toBe("plain note");
    expect(formatTelegramTextToMarkdown("plain note", [])).toBe("plain note");
  });

  it("wraps a mid-string text_link as markdown", () => {
    const text = "Try Product today";
    expect(
      formatTelegramTextToMarkdown(text, [
        { type: "text_link", offset: 4, length: 7, url: "https://example.com/p" },
      ]),
    ).toBe("Try [Product](https://example.com/p) today");
  });

  it("wraps multiple text_link entities", () => {
    const text = "A and B";
    expect(
      formatTelegramTextToMarkdown(text, [
        { type: "text_link", offset: 0, length: 1, url: "https://a.example" },
        { type: "text_link", offset: 6, length: 1, url: "https://b.example" },
      ]),
    ).toBe("[A](https://a.example) and [B](https://b.example)");
  });

  it("respects UTF-16 offsets when a non-BMP emoji precedes a link", () => {
    // "😀" is one code point, two UTF-16 code units
    const text = "😀 Link";
    expect(
      formatTelegramTextToMarkdown(text, [
        { type: "text_link", offset: 3, length: 4, url: "https://emoji.example" },
      ]),
    ).toBe("😀 [Link](https://emoji.example)");
  });

  it("leaves url entities as visible plain text", () => {
    const text = "see https://visible.example/path here";
    expect(
      formatTelegramTextToMarkdown(text, [
        { type: "url", offset: 4, length: 28 },
      ]),
    ).toBe(text);
  });

  it("leaves text_link without url as plain span", () => {
    const text = "Try Product today";
    expect(
      formatTelegramTextToMarkdown(text, [
        { type: "text_link", offset: 4, length: 7 },
      ]),
    ).toBe(text);
  });

  it("skips overlapping entities without dropping surrounding text", () => {
    const text = "ABCDEF";
    expect(
      formatTelegramTextToMarkdown(text, [
        { type: "text_link", offset: 0, length: 4, url: "https://first.example" },
        { type: "text_link", offset: 2, length: 4, url: "https://overlap.example" },
      ]),
    ).toBe("[ABCD](https://first.example)EF");
  });

  it("ignores unknown entity types", () => {
    const text = "bold word";
    expect(
      formatTelegramTextToMarkdown(text, [
        { type: "bold", offset: 0, length: 4 },
      ]),
    ).toBe(text);
  });

  it("escapes ] and backslash in link labels", () => {
    const text = "a]b\\c";
    expect(
      formatTelegramTextToMarkdown(text, [
        { type: "text_link", offset: 0, length: 5, url: "https://esc.example" },
      ]),
    ).toBe("[a\\]b\\\\c](https://esc.example)");
  });
});

describe("telegramMessageFormattedBody", () => {
  it("formats text with entities", () => {
    expect(
      telegramMessageFormattedBody(
        baseMessage({
          text: "Try Product",
          entities: [
            {
              type: "text_link",
              offset: 4,
              length: 7,
              url: "https://example.com/p",
            },
          ],
        }),
      ),
    ).toBe("Try [Product](https://example.com/p)");
  });

  it("formats caption with caption_entities when text is absent", () => {
    expect(
      telegramMessageFormattedBody(
        baseMessage({
          caption: "Cap Link",
          caption_entities: [
            {
              type: "text_link",
              offset: 4,
              length: 4,
              url: "https://cap.example",
            },
          ],
        }),
      ),
    ).toBe("Cap [Link](https://cap.example)");
  });

  it("returns undefined for empty body", () => {
    expect(telegramMessageFormattedBody(baseMessage({}))).toBeUndefined();
    expect(
      telegramMessageFormattedBody(baseMessage({ text: "   " })),
    ).toBeUndefined();
  });

  it("trims the formatted body", () => {
    expect(
      telegramMessageFormattedBody(
        baseMessage({
          text: "  hi  ",
        }),
      ),
    ).toBe("hi");
  });
});
