import { describe, expect, it } from "vitest";
import { sidebarSearchCacheKey } from "./sidebar-search-cache-key";

describe("sidebarSearchCacheKey", () => {
  it("changes when vaultRevision changes with the same query", () => {
    // Item ids are vault-relative paths; after a move the path changes, so
    // cached search hits must be keyed by vault revision as well as query text.
    expect(sidebarSearchCacheKey("hello", 1)).not.toBe(
      sidebarSearchCacheKey("hello", 2),
    );
  });

  it("changes when the query changes at the same revision", () => {
    expect(sidebarSearchCacheKey("a", 1)).not.toBe(sidebarSearchCacheKey("b", 1));
  });

  it("is stable for the same query and revision", () => {
    expect(sidebarSearchCacheKey("hello", 3)).toBe(sidebarSearchCacheKey("hello", 3));
  });
});
