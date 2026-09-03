import { describe, expect, it } from "vitest";
import type { Tag } from "@collector/shared";
import {
  normalizeTagName,
  preferTagForSimilarityMap,
  resolveTagFromMaps,
  tagSimilarityKey,
} from "./tag-normalize.js";

describe("tag-normalize (#943)", () => {
  it("normalizes spaces, hyphen-adjacent spaces, specials, and Cyrillic", () => {
    expect(normalizeTagName("Foo   Bar!")).toEqual({
      storedForm: "foo_bar",
      similarityKey: "foobar",
    });
    expect(normalizeTagName("web - dev")).toEqual({
      storedForm: "web-dev",
      similarityKey: "webdev",
    });
    expect(normalizeTagName("Web_Dev!")).toEqual({
      storedForm: "web_dev",
      similarityKey: "webdev",
    });
    expect(normalizeTagName("  Focus  ")).toEqual({
      storedForm: "focus",
      similarityKey: "focus",
    });
    expect(normalizeTagName("Веб-Разработка")).toEqual({
      storedForm: "веб-разработка",
      similarityKey: "вебразработка",
    });
    expect(normalizeTagName("hello___world")).toEqual({
      storedForm: "hello___world",
      similarityKey: "helloworld",
    });
  });

  it("maps separator variants to the same similarity key", () => {
    const keys = ["web-dev", "web_dev", "webdev", "web Dev"].map(
      tagSimilarityKey,
    );
    expect(new Set(keys)).toEqual(new Set(["webdev"]));
  });

  it("fails fast when empty after clean", () => {
    expect(() => normalizeTagName("")).toThrow(/non-empty/i);
    expect(() => normalizeTagName("   ")).toThrow(/non-empty/i);
    expect(() => normalizeTagName("!!!")).toThrow(/non-empty/i);
    expect(() => normalizeTagName("---")).toThrow(/non-empty/i);
  });

  it("resolveTagFromMaps looks up by similarity key", () => {
    const tag: Tag = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "web-dev",
      color: null,
      created_at: "2020-01-01T00:00:00.000Z",
    };
    const maps = { byName: new Map([["webdev", tag]]) };
    expect(resolveTagFromMaps(maps.byName, "Web_Dev!")?.id).toBe(tag.id);
    expect(resolveTagFromMaps(maps.byName, "other")).toBeUndefined();
  });

  it("preferTagForSimilarityMap picks earlier created_at then smaller id", () => {
    const older: Tag = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "web_dev",
      color: null,
      created_at: "2020-01-01T00:00:00.000Z",
    };
    const newer: Tag = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "web-dev",
      color: null,
      created_at: "2021-01-01T00:00:00.000Z",
    };
    expect(preferTagForSimilarityMap(older, newer).id).toBe(older.id);

    const a: Tag = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "a",
      color: null,
      created_at: "2020-01-01T00:00:00.000Z",
    };
    const b: Tag = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "b",
      color: null,
      created_at: "2020-01-01T00:00:00.000Z",
    };
    expect(preferTagForSimilarityMap(a, b).id).toBe(a.id);
  });
});
