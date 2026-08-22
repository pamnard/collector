import { describe, expect, it } from "vitest";
import type { ExtractedTextLink } from "./extract-text-links.js";
import {
  resolveTargetKey,
  resolveTextLinks,
  type TextLinkResolveContext,
} from "./resolve-text-links.js";

function link(
  partial: Pick<ExtractedTextLink, "kind" | "rawTarget"> &
    Partial<ExtractedTextLink>,
): ExtractedTextLink {
  return {
    displayText: null,
    position: 0,
    ...partial,
  };
}

function ctx(options: {
  sourceItemId: string;
  ids: string[];
  titles?: Record<string, string[]>;
}): TextLinkResolveContext {
  const idSet = new Set(options.ids);
  const titles = options.titles ?? {};
  return {
    sourceItemId: options.sourceItemId,
    idExists: (id) => idSet.has(id),
    idsByTitle: (title) => titles[title] ?? [],
  };
}

describe("resolveTargetKey", () => {
  it("strips heading and block suffixes", () => {
    expect(resolveTargetKey("Note#Heading")).toBe("Note");
    expect(resolveTargetKey("Note^blockid")).toBe("Note");
    expect(resolveTargetKey("path/to.md#H")).toBe("path/to.md");
  });
});

describe("resolveTextLinks", () => {
  it("resolves vault-relative path to item id", () => {
    const resolved = resolveTextLinks(
      [link({ kind: "wikilink", rawTarget: "Folder/note.md" })],
      ctx({
        sourceItemId: "Inbox/a.md",
        ids: ["Folder/note.md"],
      }),
    );
    expect(resolved[0]!.resolvedItemId).toBe("Folder/note.md");
  });

  it("appends .md when path without extension matches", () => {
    const resolved = resolveTextLinks(
      [link({ kind: "wikilink", rawTarget: "Folder/note" })],
      ctx({
        sourceItemId: "Inbox/a.md",
        ids: ["Folder/note.md"],
      }),
    );
    expect(resolved[0]!.resolvedItemId).toBe("Folder/note.md");
  });

  it("resolves relative md path from source folder", () => {
    const resolved = resolveTextLinks(
      [link({ kind: "md", rawTarget: "../x.md" })],
      ctx({
        sourceItemId: "Folder/sub/a.md",
        ids: ["Folder/x.md"],
      }),
    );
    expect(resolved[0]!.resolvedItemId).toBe("Folder/x.md");
  });

  it("resolves unique title", () => {
    const resolved = resolveTextLinks(
      [link({ kind: "wikilink", rawTarget: "My Note" })],
      ctx({
        sourceItemId: "Inbox/a.md",
        ids: ["Inbox/b.md"],
        titles: { "My Note": ["Inbox/b.md"] },
      }),
    );
    expect(resolved[0]!.resolvedItemId).toBe("Inbox/b.md");
  });

  it("leaves missing target unresolved", () => {
    const resolved = resolveTextLinks(
      [link({ kind: "wikilink", rawTarget: "Missing" })],
      ctx({ sourceItemId: "Inbox/a.md", ids: [] }),
    );
    expect(resolved[0]!.resolvedItemId).toBeNull();
    expect(resolved[0]!.rawTarget).toBe("Missing");
  });

  it("leaves ambiguous title unresolved", () => {
    const resolved = resolveTextLinks(
      [link({ kind: "wikilink", rawTarget: "Dup" })],
      ctx({
        sourceItemId: "Inbox/a.md",
        ids: ["A/dup.md", "B/dup.md"],
        titles: { Dup: ["A/dup.md", "B/dup.md"] },
      }),
    );
    expect(resolved[0]!.resolvedItemId).toBeNull();
    expect(resolved[0]!.resolveStatus).toBe("ambiguous");
  });

  it("resolves path-style wikilink via unique basename title", () => {
    const resolved = resolveTextLinks(
      [
        link({
          kind: "wikilink",
          rawTarget:
            "Паттерны архитектуры/Безопасность/Hypothesis-Exploit-Validate Loop (тест)",
        }),
      ],
      ctx({
        sourceItemId:
          "AI/Agentic AI/Безопасность/source.md",
        ids: [
          "AI/Agentic AI/Безопасность/2ab8e763-160e-409e-b77d-2adb1310c9cf.md",
        ],
        titles: {
          "Hypothesis-Exploit-Validate Loop (тест)": [
            "AI/Agentic AI/Безопасность/2ab8e763-160e-409e-b77d-2adb1310c9cf.md",
          ],
        },
      }),
    );
    expect(resolved[0]!.resolvedItemId).toBe(
      "AI/Agentic AI/Безопасность/2ab8e763-160e-409e-b77d-2adb1310c9cf.md",
    );
  });

  it("preserves extracted fields on resolved links", () => {
    const input = link({
      kind: "wikilink",
      rawTarget: "Note#Heading",
      displayText: "Alias",
      position: 12,
    });
    const resolved = resolveTextLinks(
      [input],
      ctx({
        sourceItemId: "Inbox/a.md",
        ids: ["Inbox/b.md"],
        titles: { Note: ["Inbox/b.md"] },
      }),
    );
    expect(resolved[0]).toEqual({
      ...input,
      resolvedItemId: "Inbox/b.md",
      resolveStatus: "resolved",
    });
  });
});
