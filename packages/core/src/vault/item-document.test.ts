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
    thumbnail: null,
    tag_ids: [TAG_A.id],
    collection_ids: [],
    folder_path: "Inbox",
    content_revision: 2,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("item-document mapping", () => {
  it("round-trips ItemFile through markdown with tag names", () => {
    const { byId, byName } = buildTagMaps([TAG_A, TAG_B]);
    const item = sampleItem({ tag_ids: [TAG_A.id, TAG_B.id] });
    const md = serializeItemDocument(item, "# Body\n", byId);
    expect(md).toContain("tags:");
    expect(md).toContain("Focus");
    expect(md).toContain("Research");
    expect(md).not.toContain(TAG_A.id);

    const parsed = parseItemDocumentResolved(md, {
      itemId: ITEM_ID,
      vaultId: VAULT_ID,
      tagsByName: byName,
    });
    expect(parsed.item).toEqual(item);
    expect(parsed.body).toBe("# Body\n");
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

  it("preserves unknown frontmatter keys on serialize", () => {
    const { byId, byName } = buildTagMaps([]);
    const md = `---
title: Portable
created: 2024-01-01T00:00:00.000Z
updated: 2024-01-01T00:00:00.000Z
custom_field: keep-me
---
`;
    const parsed = parseItemDocumentResolved(md, {
      itemId: ITEM_ID,
      vaultId: VAULT_ID,
      tagsByName: byName,
    });
    const out = serializeItemDocument(parsed.item, parsed.body, byId, parsed.extra);
    expect(out).toContain("custom_field: keep-me");
  });

  it("fails serialize on unknown tag_id", () => {
    const { byId } = buildTagMaps([TAG_A]);
    expect(() =>
      serializeItemDocument(sampleItem({ tag_ids: [TAG_B.id] }), "", byId),
    ).toThrow(/unknown tag_id/);
  });
});
