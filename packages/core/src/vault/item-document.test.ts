import { describe, expect, it } from "vitest";
import type { ItemFile, Tag } from "@collector/shared";
import {
  buildTagMaps,
  parseItemDocument,
  parseItemDocumentResolved,
  serializeItemDocument,
} from "./item-document.js";

const VAULT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_ID = "Inbox/note.md";
const TAG_A: Tag = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  name: "Focus",
  color: null,
  created_at: "2020-01-01T00:00:00.000Z",
};
const TAG_B: Tag = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  name: "Research",
  color: "#112233",
  created_at: "2020-01-01T00:00:00.000Z",
};

function sampleItem(overrides: Partial<ItemFile> = {}): ItemFile {
  return {
    id: ITEM_ID,
    vault_id: VAULT_ID,
    title: "Hello",
    description: "desc",
    url: "https://example.com",
    content_type: "article",
    source_type: "manual",
    source_id: null,
    metadata: {},
    properties: {},
    thumbnail: null,
    tag_ids: [TAG_A.id],
    collection_ids: [],
    folder_path: "Inbox",
    content_revision: 2,
      word_count: 0,
      character_count: 0,
      created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("item-document mapping", () => {
  it("round-trips ItemFile through markdown with tag names", () => {
    const { byId, byName } = buildTagMaps([TAG_A, TAG_B]);
    const body = "# Body\n";
    const item = sampleItem({
      tag_ids: [TAG_A.id, TAG_B.id],
      word_count: 1,
      character_count: 7,
    });
    const md = serializeItemDocument(item, body, byId);
    expect(md).toContain("tags:");
    expect(md).toContain("focus");
    expect(md).toContain("research");
    expect(md).not.toContain(TAG_A.id);
    expect(md).not.toContain("word_count");
    expect(md).not.toContain("character_count");

    const parsed = parseItemDocumentResolved(md, {
      itemId: ITEM_ID,
      vaultId: VAULT_ID,
      tagsByName: byName,
    });
    expect(parsed.item.tag_ids).toEqual([TAG_A.id, TAG_B.id]);
    expect(parsed.body).toBe(body);
  });

  it("reports missing tag names without inventing ids", () => {
    const { byName } = buildTagMaps([TAG_A]);
    const md = `---
title: X
tags:
  - Focus
  - Unknown
created: 2024-01-01T00:00:00.000Z
updated: 2024-01-01T00:00:00.000Z
---
`;
    const result = parseItemDocument(md, {
      itemId: ITEM_ID,
      vaultId: VAULT_ID,
      tagsByName: byName,
    });
    expect(result.missingTagNames).toEqual(["Unknown"]);
    expect(result.item.tag_ids).toEqual([TAG_A.id]);
  });

  it("dedupes similarity-key clone names in frontmatter to one tag_id (#943)", () => {
    const cloneA: Tag = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      name: "web-dev",
      color: null,
      created_at: "2020-01-01T00:00:00.000Z",
    };
    const cloneB: Tag = {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      name: "web_dev",
      color: null,
      created_at: "2021-01-01T00:00:00.000Z",
    };
    const { byName } = buildTagMaps([cloneA, cloneB]);
    const md = `---
title: X
tags:
  - web-dev
  - Web_Dev
  - webdev
created: 2024-01-01T00:00:00.000Z
updated: 2024-01-01T00:00:00.000Z
---
`;
    const result = parseItemDocument(md, {
      itemId: ITEM_ID,
      vaultId: VAULT_ID,
      tagsByName: byName,
    });
    expect(result.missingTagNames).toEqual([]);
    expect(result.item.tag_ids).toEqual([cloneA.id]);
  });

  it("trims padded tag names when resolving against the catalog", () => {
    const { byName } = buildTagMaps([TAG_A]);
    const md = `---
title: X
tags:
  - "  Focus  "
  - "  Unknown  "
created: 2024-01-01T00:00:00.000Z
updated: 2024-01-01T00:00:00.000Z
---
`;
    const result = parseItemDocument(md, {
      itemId: ITEM_ID,
      vaultId: VAULT_ID,
      tagsByName: byName,
    });
    expect(result.missingTagNames).toEqual(["  Unknown  "]);
    expect(result.item.tag_ids).toEqual([TAG_A.id]);
  });

  it("fails fast on blank frontmatter tag names", () => {
    const { byName } = buildTagMaps([]);
    expect(() =>
      parseItemDocument(
        `---
title: X
tags:
  - "   "
created: 2024-01-01T00:00:00.000Z
updated: 2024-01-01T00:00:00.000Z
---
`,
        {
          itemId: ITEM_ID,
          vaultId: VAULT_ID,
          tagsByName: byName,
        },
      ),
    ).toThrow(/blank tag name/);
  });

  it("uses mtime fallbacks when FM dates are absent", () => {
    const { byName } = buildTagMaps([]);
    const md = `---
title: Dated
---
body
`;
    const parsed = parseItemDocumentResolved(md, {
      itemId: ITEM_ID,
      vaultId: VAULT_ID,
      tagsByName: byName,
      fallbackCreatedAt: "2023-05-01T12:00:00.000Z",
      fallbackUpdatedAt: "2023-05-02T12:00:00.000Z",
    });
    expect(parsed.item.created_at).toBe("2023-05-01T12:00:00.000Z");
    expect(parsed.item.updated_at).toBe("2023-05-02T12:00:00.000Z");
  });

  it("fails when dates and fallbacks are both missing", () => {
    const { byName } = buildTagMaps([]);
    expect(() =>
      parseItemDocument(`---\ntitle: X\n---\n`, {
        itemId: ITEM_ID,
        vaultId: VAULT_ID,
        tagsByName: byName,
      }),
    ).toThrow(/missing created/);
  });

  it("puts unknown frontmatter keys on item.properties and preserves on serialize", () => {
    const { byId, byName } = buildTagMaps([]);
    const md = `---
title: Portable
created: 2024-01-01T00:00:00.000Z
updated: 2024-01-01T00:00:00.000Z
custom_field: keep-me
obsidian_cssclasses:
  - wide
---
`;
    const parsed = parseItemDocumentResolved(md, {
      itemId: ITEM_ID,
      vaultId: VAULT_ID,
      tagsByName: byName,
    });
    expect(parsed.item.properties).toEqual({
      custom_field: "keep-me",
      obsidian_cssclasses: ["wide"],
    });
    const out = serializeItemDocument(parsed.item, parsed.body, byId);
    expect(out).toContain("custom_field: keep-me");
    expect(out).toContain("obsidian_cssclasses:");
    expect(out).toContain("wide");
  });

  it("survives editing a known field without dropping foreign properties", () => {
    const { byId, byName } = buildTagMaps([]);
    const md = `---
title: Before
created: 2024-01-01T00:00:00.000Z
updated: 2024-01-01T00:00:00.000Z
custom_field: keep-me
---
body
`;
    const parsed = parseItemDocumentResolved(md, {
      itemId: ITEM_ID,
      vaultId: VAULT_ID,
      tagsByName: byName,
    });
    const edited = { ...parsed.item, title: "After" };
    const out = serializeItemDocument(edited, parsed.body, byId);
    const again = parseItemDocumentResolved(out, {
      itemId: ITEM_ID,
      vaultId: VAULT_ID,
      tagsByName: byName,
    });
    expect(again.item.title).toBe("After");
    expect(again.item.properties).toEqual({ custom_field: "keep-me" });
  });

  it("fails serialize on unknown tag_id", () => {
    const { byId } = buildTagMaps([TAG_A]);
    expect(() =>
      serializeItemDocument(sampleItem({ tag_ids: [TAG_B.id] }), "", byId),
    ).toThrow(/unknown tag_id/);
  });

  it("serializeItemDocument writes stored form for legacy catalog names (#943)", () => {
    const legacy: Tag = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      name: "A/B",
      color: null,
      created_at: "2020-01-01T00:00:00.000Z",
    };
    const { byId } = buildTagMaps([legacy]);
    const md = serializeItemDocument(
      sampleItem({ tag_ids: [legacy.id] }),
      "body",
      byId,
    );
    expect(md).toContain("- ab");
    expect(md).not.toContain("A/B");
  });

  it("uses preferred tag names when serializing tags (#949)", () => {
    const { byId, byName } = buildTagMaps([
      { ...TAG_A, name: "Index" },
      TAG_B,
    ]);
    const md = `---
title: Portable
tags:
  - index
created: 2024-01-01T00:00:00.000Z
updated: 2024-01-01T00:00:00.000Z
---
`;
    const parsed = parseItemDocumentResolved(md, {
      itemId: ITEM_ID,
      vaultId: VAULT_ID,
      tagsByName: byName,
    });

    const out = serializeItemDocument(parsed.item, parsed.body, byId, {
      preferredTagNames: ["index"],
    });

    expect(out).toContain("  - index");
    expect(out).not.toContain("  - Index");
  });

  it("preferred tag names win over catalog stored-form spelling (#949)", () => {
    const catalog: Tag = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      name: "web-dev",
      color: null,
      created_at: "2020-01-01T00:00:00.000Z",
    };
    const { byId } = buildTagMaps([catalog]);
    const out = serializeItemDocument(
      sampleItem({ tag_ids: [catalog.id] }),
      "body",
      byId,
      { preferredTagNames: ["web_dev"] },
    );

    expect(out).toContain("  - web_dev");
    expect(out).not.toContain("  - web-dev");
  });
});
