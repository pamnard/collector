import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import type { SafeParseReturnType } from "zod";
import {
  coverPixelSizeSchema,
  documentFrontmatterSchema,
  itemFileSchema,
} from "./schemas.js";

const SYNTHETIC_VAULT_ID = "11111111-1111-4111-8111-111111111111";
const SYNTHETIC_TAG_ID = "22222222-2222-4222-8222-222222222222";
const SYNTHETIC_ISO = "2026-01-15T12:00:00.000Z";

function failedIssuePaths<T>(
  result: SafeParseReturnType<unknown, T>,
): string[] {
  if (result.success) {
    assert.fail("expected Zod parse to fail");
  }
  return result.error.issues.map((issue) => issue.path.map(String).join("."));
}

describe("itemFileSchema (#889)", () => {
  const minimalValid = {
    id: "Inbox/synthetic-note.md",
    vault_id: SYNTHETIC_VAULT_ID,
    title: "Synthetic note",
    created_at: SYNTHETIC_ISO,
    updated_at: SYNTHETIC_ISO,
  };

  it("parses a valid item and applies documented defaults", () => {
    const parsed = itemFileSchema.parse(minimalValid);

    expect(parsed.id).toBe("Inbox/synthetic-note.md");
    expect(parsed.vault_id).toBe(SYNTHETIC_VAULT_ID);
    expect(parsed.title).toBe("Synthetic note");
    expect(parsed.description).toBe("");
    expect(parsed.content_type).toBe("bookmark");
    expect(parsed.source_type).toBe("manual");
    expect(parsed.metadata).toEqual({});
    expect(parsed.properties).toEqual({});
    expect(parsed.tag_ids).toEqual([]);
    expect(parsed.collection_ids).toEqual([]);
    expect(parsed.folder_path).toBe("");
    expect(parsed.content_revision).toBe(1);
    expect(parsed.word_count).toBe(0);
    expect(parsed.character_count).toBe(0);
    expect(parsed.created_at).toBe(SYNTHETIC_ISO);
    expect(parsed.updated_at).toBe(SYNTHETIC_ISO);
  });

  it("round-trips a fully populated item DTO", () => {
    const full = itemFileSchema.parse({
      ...minimalValid,
      description: "Synthetic description",
      url: "https://example.test/item",
      content_type: "article",
      source_type: "import",
      source_id: "src-1",
      metadata: { lang: "en" },
      properties: { custom: true },
      thumbnail: "cover.webp",
      tag_ids: [SYNTHETIC_TAG_ID],
      collection_ids: [],
      folder_path: "Inbox",
      content_revision: 3,
      word_count: 12,
      character_count: 48,
    });

    const again = itemFileSchema.parse(JSON.parse(JSON.stringify(full)));
    expect(again).toEqual(full);
  });

  it("rejects invalid fields with stable issue paths", () => {
    const paths = failedIssuePaths(
      itemFileSchema.safeParse({
        ...minimalValid,
        title: "",
        vault_id: "not-a-uuid",
        content_type: "not-a-content-type",
        tag_ids: ["not-a-uuid"],
        word_count: -1,
        created_at: "yesterday",
      }),
    );

    expect(paths).toContain("title");
    expect(paths).toContain("vault_id");
    expect(paths).toContain("content_type");
    expect(paths).toContain("tag_ids.0");
    expect(paths).toContain("word_count");
    expect(paths).toContain("created_at");
  });
});

describe("documentFrontmatterSchema (#889)", () => {
  it("parses empty frontmatter as an empty object", () => {
    expect(documentFrontmatterSchema.parse({})).toEqual({});
  });

  it("parses sparse frontmatter without inventing omitted fields", () => {
    expect(
      documentFrontmatterSchema.parse({
        title: "Synthetic frontmatter",
        tags: ["alpha", "beta"],
        content_type: "note",
        source_type: "manual",
      }),
    ).toEqual({
      title: "Synthetic frontmatter",
      tags: ["alpha", "beta"],
      content_type: "note",
      source_type: "manual",
    });
  });

  it("accepts date aliases as ISO strings and Date values", () => {
    const created = new Date(SYNTHETIC_ISO);
    const parsed = documentFrontmatterSchema.parse({
      created,
      updated_at: SYNTHETIC_ISO,
    });

    expect(parsed.created).toEqual(created);
    expect(parsed.updated_at).toBe(SYNTHETIC_ISO);

    const fromStrings = documentFrontmatterSchema.parse({
      created: SYNTHETIC_ISO,
      created_at: SYNTHETIC_ISO,
      updated: SYNTHETIC_ISO,
      updated_at: SYNTHETIC_ISO,
    });
    expect(fromStrings.created).toBe(SYNTHETIC_ISO);
    expect(fromStrings.created_at).toBe(SYNTHETIC_ISO);
    expect(fromStrings.updated).toBe(SYNTHETIC_ISO);
    expect(fromStrings.updated_at).toBe(SYNTHETIC_ISO);
  });

  it("round-trips JSON-serializable frontmatter", () => {
    const parsed = documentFrontmatterSchema.parse({
      title: "Round-trip note",
      description: "Synthetic",
      url: null,
      thumbnail: null,
      content_revision: 2,
      metadata: { source: "fixture" },
      created_at: SYNTHETIC_ISO,
      updated_at: SYNTHETIC_ISO,
    });

    const again = documentFrontmatterSchema.parse(
      JSON.parse(JSON.stringify(parsed)),
    );
    expect(again).toEqual(parsed);
  });

  it("rejects invalid fields with stable issue paths", () => {
    const paths = failedIssuePaths(
      documentFrontmatterSchema.safeParse({
        title: "",
        url: "not-a-url",
        content_type: "bogus",
        source_type: "bogus",
        tags: [""],
        content_revision: 1.5,
      }),
    );

    expect(paths).toContain("title");
    expect(paths).toContain("url");
    expect(paths).toContain("content_type");
    expect(paths).toContain("source_type");
    expect(paths).toContain("tags.0");
    expect(paths).toContain("content_revision");
  });
});

describe("coverPixelSizeSchema (#889)", () => {
  it("parses positive finite cover dimensions", () => {
    expect(coverPixelSizeSchema.parse({ width: 1280, height: 720 })).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("round-trips cover.size.json payload shape", () => {
    const size = coverPixelSizeSchema.parse({ width: 640, height: 360 });
    const sidecar = `${JSON.stringify(size)}\n`;
    const again = coverPixelSizeSchema.parse(JSON.parse(sidecar));
    expect(again).toEqual(size);
  });

  it.each([
    [{ width: 0, height: 720 }, "width"],
    [{ width: 100, height: -1 }, "height"],
    [{ width: Number.POSITIVE_INFINITY, height: 10 }, "width"],
  ] as const)(
    "rejects invalid dimensions %j at path %s",
    (input, path) => {
      expect(failedIssuePaths(coverPixelSizeSchema.safeParse(input))).toContain(
        path,
      );
    },
  );
});
