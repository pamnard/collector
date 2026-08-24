import { describe, expect, it } from "vitest";
import {
  itemRowToFile,
  parseMetadata,
  parseProperties,
  serializeMetadata,
  serializeProperties,
  sqlPageClause,
  type ItemRow,
} from "./sql-index-helpers.js";

function sampleRow(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: "item-1.md",
    vault_id: "vault-1",
    title: "Title",
    description: "Desc",
    url: null,
    content_type: "note",
    source_type: "manual",
    source_id: null,
    metadata_json: "{}",
    properties_json: "{}",
    thumbnail_path: null,
    folder_path: "Inbox",
    content_revision: 1,
    word_count: 3,
    character_count: 12,
    created_at: "2020-01-01T00:00:00.000Z",
    updated_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("sql-index-helpers parse/serialize (#798 / #792 seam)", () => {
  it("round-trips metadata objects", () => {
    const raw = serializeMetadata({ a: 1, nested: { b: true } });
    expect(parseMetadata(raw)).toEqual({ a: 1, nested: { b: true } });
  });

  it("fail-fast rejects non-object metadata_json", () => {
    expect(() => parseMetadata("null")).toThrow(/Invalid item metadata_json/);
    expect(() => parseMetadata("[]")).toThrow(/Invalid item metadata_json/);
    expect(() => parseMetadata('"x"')).toThrow(/Invalid item metadata_json/);
  });

  it("round-trips properties objects", () => {
    const raw = serializeProperties({ k: "v" });
    expect(parseProperties(raw)).toEqual({ k: "v" });
  });

  it("fail-fast rejects non-object properties_json", () => {
    expect(() => parseProperties("1")).toThrow(/Invalid item properties_json/);
    expect(() => parseProperties("[]")).toThrow(/Invalid item properties_json/);
  });
});

describe("sqlPageClause (#798 / #792 seam)", () => {
  it("returns empty clause when limit is omitted", () => {
    expect(sqlPageClause()).toEqual({ sql: "", binds: [] });
    expect(sqlPageClause({})).toEqual({ sql: "", binds: [] });
  });

  it("emits LIMIT and optional OFFSET binds", () => {
    expect(sqlPageClause({ limit: 20 })).toEqual({
      sql: "LIMIT ?",
      binds: [20],
    });
    expect(sqlPageClause({ limit: 20, offset: 40 })).toEqual({
      sql: "LIMIT ? OFFSET ?",
      binds: [20, 40],
    });
  });
});

describe("itemRowToFile (#798 / #792 seam)", () => {
  it("maps row + ids and omits null optional fields", () => {
    const file = itemRowToFile(sampleRow(), ["tag-a"], ["col-a"]);
    expect(file).toMatchObject({
      id: "item-1.md",
      vault_id: "vault-1",
      title: "Title",
      tag_ids: ["tag-a"],
      collection_ids: ["col-a"],
      folder_path: "Inbox",
      metadata: {},
      properties: {},
    });
    expect(file.url).toBeUndefined();
    expect(file.thumbnail).toBeUndefined();
    expect(file.source_id).toBeUndefined();
  });

  it("preserves optional url / thumbnail / source_id when present", () => {
    const file = itemRowToFile(
      sampleRow({
        url: "https://example.test/x",
        thumbnail_path: "media/cover.jpg",
        source_id: "src-1",
        metadata_json: JSON.stringify({ foo: "bar" }),
      }),
      [],
      [],
    );
    expect(file.url).toBe("https://example.test/x");
    expect(file.thumbnail).toBe("media/cover.jpg");
    expect(file.source_id).toBe("src-1");
    expect(file.metadata).toEqual({ foo: "bar" });
  });
});
