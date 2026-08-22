import { describe, expect, it } from "vitest";
import {
  JOB_PRIORITY_BULK,
  JOB_PRIORITY_INTERACTIVE,
  JOB_TYPE_CATALOG,
  VAULT_MUTATING_BULK_JOB_TYPE_IDS,
  defineJobType,
  importFolderJobType,
  itemDerivedRefreshIdempotencyKey,
  itemDerivedRefreshIdempotencyKeyPrefix,
  itemDerivedRefreshJobType,
  isVaultMutatingBulkJob,
  isVaultMutatingBulkJobType,
  testNoopJobType,
} from "./job-types.js";

describe("job scheduling priorities (#746)", () => {
  it("exports interactive high and bulk low priority constants", () => {
    expect(JOB_PRIORITY_INTERACTIVE).toBe(100);
    expect(JOB_PRIORITY_BULK).toBe(-10);
    expect(JOB_PRIORITY_INTERACTIVE).toBeGreaterThan(JOB_PRIORITY_BULK);
  });

  it("classifies required vault-mutating bulk job types", () => {
    for (const id of [
      "dropImportBatch",
      "syncPluginPull",
      "vaultIndexSync",
      "reindexVaultBatch",
    ] as const) {
      expect(VAULT_MUTATING_BULK_JOB_TYPE_IDS).toContain(id);
      expect(isVaultMutatingBulkJobType(id)).toBe(true);
    }
    expect(isVaultMutatingBulkJobType("__test_noop")).toBe(false);
  });

  it("counts bulk mutator slot by type, not by priority alone", () => {
    expect(isVaultMutatingBulkJob({ type: "vaultIndexSync" })).toBe(true);
    expect(isVaultMutatingBulkJob({ type: "reindexVaultBatch" })).toBe(true);
    expect(isVaultMutatingBulkJob({ type: "dropImportBatch" })).toBe(true);
    expect(isVaultMutatingBulkJob({ type: "syncPluginPull" })).toBe(true);
    expect(isVaultMutatingBulkJob({ type: "__test_noop" })).toBe(false);
    expect(isVaultMutatingBulkJob({ type: "refreshEmbeddings" })).toBe(false);
    expect(isVaultMutatingBulkJob({ type: "itemDerivedRefresh" })).toBe(false);
  });
});

describe("job type catalog (#629)", () => {
  it("includes __test_noop in JOB_TYPE_CATALOG", () => {
    expect(JOB_TYPE_CATALOG.some((t) => t.id === "__test_noop")).toBe(true);
    expect(testNoopJobType.id).toBe("__test_noop");
  });

  it("parses valid noop payload", () => {
    expect(testNoopJobType.payload.parse({})).toEqual({});
    expect(
      testNoopJobType.payload.parse({
        fail: "retryable",
        retryAfterMs: 10,
      }),
    ).toEqual({ fail: "retryable", retryAfterMs: 10 });
  });

  it("rejects invalid noop payload", () => {
    expect(() =>
      testNoopJobType.payload.parse({ fail: "nope" }),
    ).toThrow();
  });

  it("keeps catalog ids unique", () => {
    const ids = JOB_TYPE_CATALOG.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("defineJobType returns id + schema", () => {
    const t = defineJobType({
      id: "example",
      payload: testNoopJobType.payload,
    });
    expect(t.id).toBe("example");
    expect(t.payload.parse({})).toEqual({});
  });

  it("includes itemDerivedRefresh in JOB_TYPE_CATALOG (#766)", () => {
    expect(JOB_TYPE_CATALOG.some((t) => t.id === "itemDerivedRefresh")).toBe(
      true,
    );
    const parsed = itemDerivedRefreshJobType.payload.parse({
      vaultId: "v1",
      vaultPath: "/vault",
      itemId: "a.md",
      contentRevision: 1,
      fileMtimeMs: 1_700_000_000_000,
    });
    expect(parsed.contentRevision).toBe(1);
    expect(parsed.fileMtimeMs).toBe(1_700_000_000_000);
  });

  it("importFolder declares a long-running non-retryable contract (#747)", () => {
    expect(importFolderJobType.timeoutMs).toBeGreaterThanOrEqual(
      60 * 60 * 1000,
    );
    expect(importFolderJobType.maxAttempts).toBe(1);
  });

  it("itemDerivedRefresh idempotency keys align enqueue and waitDerived (#770)", () => {
    expect(itemDerivedRefreshJobType.id).toBe("itemDerivedRefresh");
    expect(isVaultMutatingBulkJobType("itemDerivedRefresh")).toBe(false);
    const snapshot = {
      vaultId: "v1",
      itemId: "Inbox/n.md",
      contentRevision: 3,
      fileMtimeMs: 1_700_000_000_000,
    };
    expect(itemDerivedRefreshIdempotencyKey(snapshot)).toBe(
      "itemDerivedRefresh:v1:Inbox/n.md:3:1700000000000",
    );
    expect(itemDerivedRefreshIdempotencyKeyPrefix(snapshot)).toBe(
      "itemDerivedRefresh:v1:Inbox/n.md:3:",
    );
  });
});
