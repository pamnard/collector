import { describe, expect, it } from "vitest";
import {
  JOB_PRIORITY_BULK,
  JOB_PRIORITY_INTERACTIVE,
  JOB_TYPE_CATALOG,
  VAULT_MUTATING_BULK_JOB_TYPE_IDS,
  defineJobType,
  importFolderJobType,
  isLowPriorityVaultMutatingJob,
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
    expect(
      isLowPriorityVaultMutatingJob({
        type: "vaultIndexSync",
        priority: JOB_PRIORITY_BULK,
      }),
    ).toBe(true);
    expect(
      isLowPriorityVaultMutatingJob({
        type: "vaultIndexSync",
        priority: JOB_PRIORITY_BULK + 1,
      }),
    ).toBe(true);
    expect(
      isLowPriorityVaultMutatingJob({
        type: "reindexVaultBatch",
        priority: 0,
      }),
    ).toBe(true);
    expect(
      isLowPriorityVaultMutatingJob({
        type: "dropImportBatch",
      }),
    ).toBe(true);
    expect(
      isLowPriorityVaultMutatingJob({
        type: "__test_noop",
        priority: JOB_PRIORITY_BULK,
      }),
    ).toBe(false);
    expect(
      isLowPriorityVaultMutatingJob({
        type: "refreshEmbeddings",
        priority: JOB_PRIORITY_BULK,
      }),
    ).toBe(false);
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

  it("importFolder declares a long-running non-retryable contract (#747)", () => {
    expect(importFolderJobType.timeoutMs).toBeGreaterThanOrEqual(
      60 * 60 * 1000,
    );
    expect(importFolderJobType.maxAttempts).toBe(1);
  });
});
