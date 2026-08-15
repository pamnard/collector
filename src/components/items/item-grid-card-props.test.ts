import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import type { TagWithCount } from "@collector/core";
import { itemGridCardPropsAreEqual } from "./item-grid-card-props.ts";

function item(overrides: Partial<ItemFile> = {}): ItemFile {
  return {
    id: "items/a.md",
    vault_id: "11111111-1111-1111-1111-111111111111",
    title: "Alpha",
    description: "Desc",
    url: null,
    content_type: "bookmark",
    source_type: "manual",
    source_id: null,
    metadata: {},
    properties: {},
    thumbnail: "cover.webp",
    tag_ids: [],
    collection_ids: [],
    folder_path: "items",
    content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-02T00:00:00.000Z",
    ...overrides,
  };
}

const onOpen = () => {};
const tagsById = new Map<string, TagWithCount>();

describe("itemGridCardPropsAreEqual", () => {
  it("treats identical rendered props as equal", () => {
    const props = {
      item: item(),
      thumbnailPath: "/thumb.webp" as string | null | undefined,
      tagsById,
      onOpen,
    };
    assert.equal(itemGridCardPropsAreEqual(props, { ...props }), true);
  });

  it("re-renders when title changes with the same cover stamp", () => {
    const base = item();
    assert.equal(
      itemGridCardPropsAreEqual(
        { item: base, thumbnailPath: null, tagsById, onOpen },
        {
          item: item({ title: "Beta" }),
          thumbnailPath: null,
          tagsById,
          onOpen,
        },
      ),
      false,
    );
  });

  it("re-renders when description changes", () => {
    assert.equal(
      itemGridCardPropsAreEqual(
        { item: item(), thumbnailPath: null, tagsById, onOpen },
        {
          item: item({ description: "Other" }),
          thumbnailPath: null,
          tagsById,
          onOpen,
        },
      ),
      false,
    );
  });

  it("re-renders when tag_ids change", () => {
    const tagId = "22222222-2222-2222-2222-222222222222";
    assert.equal(
      itemGridCardPropsAreEqual(
        { item: item(), thumbnailPath: null, tagsById, onOpen },
        {
          item: item({ tag_ids: [tagId] }),
          thumbnailPath: null,
          tagsById,
          onOpen,
        },
      ),
      false,
    );
  });

  it("re-renders when url changes (YouTube cover fallback)", () => {
    assert.equal(
      itemGridCardPropsAreEqual(
        { item: item({ url: null }), thumbnailPath: null, tagsById, onOpen },
        {
          item: item({
            url: "https://www.youtube.com/watch?v=abcdefghijk",
          }),
          thumbnailPath: null,
          tagsById,
          onOpen,
        },
      ),
      false,
    );
  });

  it("re-renders when content_type changes (portrait optimism)", () => {
    assert.equal(
      itemGridCardPropsAreEqual(
        {
          item: item({ content_type: "bookmark" }),
          thumbnailPath: null,
          tagsById,
          onOpen,
        },
        {
          item: item({ content_type: "image" }),
          thumbnailPath: null,
          tagsById,
          onOpen,
        },
      ),
      false,
    );
  });

  it("re-renders when created_at changes", () => {
    assert.equal(
      itemGridCardPropsAreEqual(
        { item: item(), thumbnailPath: null, tagsById, onOpen },
        {
          item: item({ created_at: "2024-06-01T00:00:00.000Z" }),
          thumbnailPath: null,
          tagsById,
          onOpen,
        },
      ),
      false,
    );
  });

  it("re-renders when cover stamp fields change", () => {
    assert.equal(
      itemGridCardPropsAreEqual(
        { item: item(), thumbnailPath: null, tagsById, onOpen },
        {
          item: item({ updated_at: "2024-08-01T00:00:00.000Z" }),
          thumbnailPath: null,
          tagsById,
          onOpen,
        },
      ),
      false,
    );
  });
});
