import { describe, expect, it } from "vitest";
import {
  buildFtsMatchQuery,
  buildMetadataFtsMatchQuery,
} from "../search/fts-query.js";

describe("buildFtsMatchQuery", () => {
  it("returns null for empty input", () => {
    expect(buildFtsMatchQuery("")).toBeNull();
    expect(buildFtsMatchQuery("   ")).toBeNull();
  });

  it("builds prefix match terms", () => {
    expect(buildFtsMatchQuery("hello")).toBe('"hello"*');
    expect(buildFtsMatchQuery("hello world")).toBe('"hello"* "world"*');
  });

  it("strips FTS special characters", () => {
    expect(buildFtsMatchQuery('foo"bar*baz')).toBe('"foobarbaz"*');
  });
});

describe("buildMetadataFtsMatchQuery", () => {
  it("returns null for empty input", () => {
    expect(buildMetadataFtsMatchQuery("")).toBeNull();
    expect(buildMetadataFtsMatchQuery("   ")).toBeNull();
  });

  it("scopes terms to title and description columns", () => {
    expect(buildMetadataFtsMatchQuery("hello")).toBe(
      '(title : "hello"* OR description : "hello"*)',
    );
    expect(buildMetadataFtsMatchQuery("hello world")).toBe(
      '(title : "hello"* OR description : "hello"*) (title : "world"* OR description : "world"*)',
    );
  });
});
