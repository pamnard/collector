import { describe, expect, it, vi } from "vitest";
import { flushEmbeddingRefresh } from "./item-embedding-refresh.js";
import type { VaultContext } from "../adapters/types.js";

const sampleInput = {
  itemId: "note.md",
  title: "t",
  description: "d",
  tagNames: [] as string[],
  contentRevision: 1,
};

describe("flushEmbeddingRefresh (#639)", () => {
  it("enqueues when embeddingRefreshJobs is set", async () => {
    const enqueue = vi.fn(async () => undefined);
    const ctx = {
      embeddingRefreshJobs: { enqueue },
    } as unknown as VaultContext;

    await flushEmbeddingRefresh(ctx, "v1", [sampleInput]);

    expect(enqueue).toHaveBeenCalledWith("v1", [sampleInput]);
  });

  it("no-ops when neither jobs nor embeddings are set", async () => {
    const ctx = {} as VaultContext;
    await expect(
      flushEmbeddingRefresh(ctx, "v1", [sampleInput]),
    ).resolves.toBeUndefined();
  });

  it("throws when embeddings exist without embeddingRefreshJobs", async () => {
    const refresh = vi.fn(async () => undefined);
    const ctx = {
      embeddings: { refresh },
    } as unknown as VaultContext;

    await expect(
      flushEmbeddingRefresh(ctx, "v1", [sampleInput]),
    ).rejects.toThrow(/embedding refresh requires embeddingRefreshJobs/);
    expect(refresh).not.toHaveBeenCalled();
  });
});
