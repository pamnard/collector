import { describe, expect, it } from "vitest";
import {
  SQL_IN_LIST_CHUNK,
  SQL_IN_LIST_MAX,
  assertSqlInListSize,
  chunkSqlInList,
} from "./sql-index-helpers.js";

describe("sql IN-list chunking (#666)", () => {
  it("exposes a chunk size under the SQLite bind limit", () => {
    expect(SQL_IN_LIST_CHUNK).toBeGreaterThanOrEqual(200);
    expect(SQL_IN_LIST_CHUNK).toBeLessThanOrEqual(500);
    // vault_id + chunk must stay under default SQLITE_MAX_VARIABLE_NUMBER (999)
    expect(SQL_IN_LIST_CHUNK + 1).toBeLessThanOrEqual(999);
  });

  it("chunks preserve concatenation order", () => {
    const ids = Array.from({ length: SQL_IN_LIST_CHUNK + 3 }, (_, i) => `id-${i}`);
    const chunks = chunkSqlInList(ids);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(SQL_IN_LIST_CHUNK);
    expect(chunks[1]).toEqual([
      `id-${SQL_IN_LIST_CHUNK}`,
      `id-${SQL_IN_LIST_CHUNK + 1}`,
      `id-${SQL_IN_LIST_CHUNK + 2}`,
    ]);
    expect(chunks.flat()).toEqual(ids);
  });

  it("fail-fast rejects absurd list sizes with a clear error", () => {
    expect(() => assertSqlInListSize(SQL_IN_LIST_MAX + 1, "listItemFilesByIds")).toThrow(
      /listItemFilesByIds: id list length \d+ exceeds max \d+/,
    );
  });

  it("allows the max size exactly", () => {
    expect(() => assertSqlInListSize(SQL_IN_LIST_MAX, "listItemFilesByIds")).not.toThrow();
  });
});
