import { describe, expect, it } from "vitest";
import { buildFtsMatchQuery } from "../search/fts-query.js";

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
