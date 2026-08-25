import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { requireSqlSelect } from "./sql-index-ports/require-select.js";
import { SqlVaultIndexAdapter } from "./sql-index.js";

describe("sql-index compose seams (#792)", () => {
  it("requireSqlSelect names the method and points at SqlVaultIndexStore", async () => {
    await assert.rejects(
      () => requireSqlSelect("listTagsWithCounts"),
      /listTagsWithCounts requires select\(\); use SqlVaultIndexStore instead/,
    );
  });

  it("adapter select stubs reject without a store", async () => {
    const adapter = new SqlVaultIndexAdapter({
      execute: async () => 0,
      select: async () => [],
    });
    await assert.rejects(
      () => adapter.listVaultItemIds("vault-1"),
      /listVaultItemIds requires select\(\); use SqlVaultIndexStore instead/,
    );
  });
});
