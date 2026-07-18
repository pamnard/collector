import { describe, expect, it } from "vitest";
import { classifyItemSyncAction } from "./sync-classifier.js";

const base = {
  diskMtimeMs: 1_700_000_000_000,
  diskUpdatedAt: "2024-01-01T00:00:00.000Z",
  diskContentRevision: 1,
  diskCreatedAt: "2020-01-01T00:00:00.000Z",
};

describe("classifyItemSyncAction", () => {
  it("reindexes items missing from the index", () => {
    expect(
      classifyItemSyncAction({
        ...base,
        indexed: false,
        dbMtimeMs: null,
      }),
    ).toBe("reindex");
  });

  it("skips when mtime and created_at match the index", () => {
    expect(
      classifyItemSyncAction({
        ...base,
        indexed: true,
        dbMtimeMs: base.diskMtimeMs,
        dbUpdatedAt: base.diskUpdatedAt,
        dbContentRevision: base.diskContentRevision,
        dbCreatedAt: base.diskCreatedAt,
      }),
    ).toBe("skip");
  });

  it("patches when mtime matches but created_at drifted", () => {
    expect(
      classifyItemSyncAction({
        ...base,
        indexed: true,
        dbMtimeMs: base.diskMtimeMs,
        dbUpdatedAt: base.diskUpdatedAt,
        dbContentRevision: base.diskContentRevision,
        dbCreatedAt: "1999-01-01T00:00:00.000Z",
      }),
    ).toBe("patch");
  });

  it("patches when mtime is unknown but metadata matches", () => {
    expect(
      classifyItemSyncAction({
        ...base,
        indexed: true,
        dbMtimeMs: null,
        dbUpdatedAt: base.diskUpdatedAt,
        dbContentRevision: base.diskContentRevision,
        dbCreatedAt: base.diskCreatedAt,
      }),
    ).toBe("patch");
  });

  it("patches when mtime differs but metadata matches", () => {
    expect(
      classifyItemSyncAction({
        ...base,
        indexed: true,
        dbMtimeMs: 1,
        dbUpdatedAt: base.diskUpdatedAt,
        dbContentRevision: base.diskContentRevision,
        dbCreatedAt: base.diskCreatedAt,
      }),
    ).toBe("patch");
  });

  it("reindexes when metadata changed", () => {
    expect(
      classifyItemSyncAction({
        ...base,
        indexed: true,
        dbMtimeMs: null,
        dbUpdatedAt: "2023-01-01T00:00:00.000Z",
        dbContentRevision: 1,
        dbCreatedAt: base.diskCreatedAt,
      }),
    ).toBe("reindex");
  });

  it("reindexes when content revision changed", () => {
    expect(
      classifyItemSyncAction({
        ...base,
        diskContentRevision: 2,
        indexed: true,
        dbMtimeMs: base.diskMtimeMs,
        dbUpdatedAt: base.diskUpdatedAt,
        dbContentRevision: 1,
        dbCreatedAt: base.diskCreatedAt,
      }),
    ).toBe("reindex");
  });
});
