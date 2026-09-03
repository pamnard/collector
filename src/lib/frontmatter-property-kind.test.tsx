import { describe, expect, it } from "vitest";
import { inferPropertyKind } from "./frontmatter-property-kind";
import {
  formatFrontmatterPropertyValue,
  frontmatterEntriesFromRaw,
} from "../components/items/ItemDetailMetadata";

describe("inferPropertyKind", () => {
  it("uses product kinds for known keys", () => {
    expect(inferPropertyKind("url", "not-a-url")).toBe("url");
    expect(inferPropertyKind("content_type", "note")).toBe("content_type");
    expect(inferPropertyKind("tags", [])).toBe("tags");
    expect(inferPropertyKind("folder_path", "Inbox")).toBe("folder");
    expect(inferPropertyKind("created_at", "x")).toBe("datetime");
  });

  it("infers foreign value shapes", () => {
    expect(inferPropertyKind("custom", "https://example.com")).toBe("url");
    expect(inferPropertyKind("due", "2024-01-02")).toBe("date");
    expect(inferPropertyKind("when", "2024-01-02T03:04:05.000Z")).toBe("datetime");
    expect(inferPropertyKind("flag", true)).toBe("boolean");
    expect(inferPropertyKind("count", 3)).toBe("number");
    expect(inferPropertyKind("blob", { a: 1 })).toBe("json");
    expect(inferPropertyKind("note", "hello")).toBe("text");
  });
});

describe("frontmatterEntriesFromRaw (metadata panel)", () => {
  it("lists all frontmatter keys in file order without sorting", () => {
    const raw = `---
title: Note
aliases:
  - a
tags:
  - x
custom_z: last-alphabetically-first-in-file
url: https://example.com
---
body
`;
    const keys = frontmatterEntriesFromRaw(raw).map(([key]) => key);
    expect(keys).toEqual([
      "title",
      "aliases",
      "tags",
      "custom_z",
      "url",
    ]);
  });

  it("keeps foreign keys alongside product keys", () => {
    const raw = `---
title: T
obsidian_id: abc
content_type: note
---
`;
    const entries = Object.fromEntries(frontmatterEntriesFromRaw(raw));
    expect(entries.title).toBe("T");
    expect(entries.obsidian_id).toBe("abc");
    expect(entries.content_type).toBe("note");
  });
});

describe("formatFrontmatterPropertyValue", () => {
  it("joins tags and stringifies objects", () => {
    expect(formatFrontmatterPropertyValue("tags", ["a", "b"])).toBe("a, b");
    expect(formatFrontmatterPropertyValue("meta", { n: 1 })).toBe(
      JSON.stringify({ n: 1 }, null, 2),
    );
  });

  it("keeps parsed tag casing from raw frontmatter", () => {
    const raw = `---
title: Note
tags:
  - index
---
body
`;

    const entries = Object.fromEntries(frontmatterEntriesFromRaw(raw));

    expect(formatFrontmatterPropertyValue("tags", entries.tags)).toBe("index");
  });
});
