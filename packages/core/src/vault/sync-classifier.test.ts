import { describe, expect, it } from "vitest";
import { classifyItemSyncAction } from "./sync-classifier.js";

const base = {
  diskMtimeMs: 1_700_000_000_000,
  diskUpdatedAt: "2024-01-01T00:00:00.000Z",
  diskContentRevision: 1,
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

  it("skips when directory mtime matches the index", () => {
    expect(
      classifyItemSyncAction({
        ...base,
        indexed: true,
        dbMtimeMs: base.diskMtimeMs,
        dbUpdatedAt: base.diskUpdatedAt,
        dbContentRevision: base.diskContentRevision,
      }),
    ).toBe("skip");
  });

  it("patches when mtime is unknown but metadata matches", () => {
    expect(
      classifyItemSyncAction({
        ...base,
        indexed: true,
        dbMtimeMs: null,
        dbUpdatedAt: base.diskUpdatedAt,
        dbContentRevision: base.diskContentRevision,
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
      }),
    ).toBe("reindex");
  });
});
