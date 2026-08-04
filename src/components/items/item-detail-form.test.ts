import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import type { ItemFormValues } from "../../types/item.ts";
import {
  isFormDirty,
  sameTagNames,
  toFormValues,
} from "./item-detail-form.ts";

const VAULT_ID = "00000000-0000-4000-8000-000000000001";

function item(overrides: Partial<ItemFile> = {}): ItemFile {
  return {
    id: "inbox/note.md",
    vault_id: VAULT_ID,
    title: "Title",
    description: "Desc",
    url: "https://example.com",
    content_type: "note",
    source_type: "manual",
    source_id: null,
    metadata: {},
    properties: {},
    thumbnail: null,
    tag_ids: [],
    collection_ids: [],
    folder_path: "inbox",
    content_revision: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function formFrom(
  loaded: ItemFile,
  content: string | null,
  tags: string[],
  overrides: Partial<ItemFormValues> = {},
): ItemFormValues {
  return { ...toFormValues(loaded, content, tags), ...overrides };
}

describe("toFormValues", () => {
  it("maps null url and content to empty strings", () => {
    assert.deepEqual(
      toFormValues(item({ url: null }), null, ["a"]),
      {
        title: "Title",
        description: "Desc",
        url: "",
        content_type: "note",
        content: "",
        tags: ["a"],
        folder_path: "inbox",
        properties: {},
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    );
  });
});

describe("sameTagNames", () => {
  it("treats case and trim as equal", () => {
    assert.equal(sameTagNames([" Foo ", "bar"], ["bar", "foo"]), true);
  });

  it("rejects different lengths", () => {
    assert.equal(sameTagNames(["a"], ["a", "b"]), false);
  });
});

describe("isFormDirty", () => {
  it("is clean when form matches loaded item", () => {
    const loaded = item();
    const values = formFrom(loaded, "body", ["tag"]);
    assert.equal(isFormDirty(values, loaded, "body", ["tag"]), false);
  });

  it("treats empty url as null against item.url", () => {
    const loaded = item({ url: null });
    const values = formFrom(loaded, "", [], { url: "   " });
    assert.equal(isFormDirty(values, loaded, "", []), false);
  });

  it("trims content for dirty check", () => {
    const loaded = item();
    const values = formFrom(loaded, "body", [], { content: "  body  " });
    assert.equal(isFormDirty(values, loaded, "body", []), false);
  });

  it("flags tag renames ignoring case/trim", () => {
    const loaded = item();
    const values = formFrom(loaded, "", ["foo"], { tags: ["FOO"] });
    assert.equal(isFormDirty(values, loaded, "", ["foo"]), false);
    assert.equal(
      isFormDirty(formFrom(loaded, "", ["foo"], { tags: ["bar"] }), loaded, "", [
        "foo",
      ]),
      true,
    );
  });

  it("flags title change after trim", () => {
    const loaded = item();
    assert.equal(
      isFormDirty(formFrom(loaded, "", [], { title: "Other" }), loaded, "", []),
      true,
    );
  });
});
