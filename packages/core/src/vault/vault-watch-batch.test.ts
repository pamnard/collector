import { describe, expect, it, vi } from "vitest";
import {
  createVaultWatchBatcher,
  dedupeVaultWatchItemIds,
} from "./vault-watch-batch.js";

describe("dedupeVaultWatchItemIds", () => {
  it("keeps first occurrence order", () => {
    expect(dedupeVaultWatchItemIds(["b", "a", "b", "c"])).toEqual(["b", "a", "c"]);
  });
});

describe("createVaultWatchBatcher", () => {
  it("debounces bursts into one flush", async () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const batcher = createVaultWatchBatcher({
      debounceMs: 100,
      onFlush,
    });

    batcher.enqueueItem("one");
    batcher.enqueueItem("two");
    batcher.enqueueItem("one");
    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith({
      itemIds: ["one", "two"],
      folderPaths: [],
    });

    batcher.dispose();
    vi.useRealTimers();
  });

  it("batches folder prefixes with item ids (#567)", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const batcher = createVaultWatchBatcher({
      debounceMs: 100,
      onFlush,
    });

    batcher.enqueueFolder("Parent/Child");
    batcher.enqueueItem("note.md");
    batcher.enqueueFolder("Parent/Child");
    vi.advanceTimersByTime(100);

    expect(onFlush).toHaveBeenCalledWith({
      itemIds: ["note.md"],
      folderPaths: ["Parent/Child"],
    });

    batcher.dispose();
    vi.useRealTimers();
  });

  it("flush runs immediately", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const batcher = createVaultWatchBatcher({
      debounceMs: 100,
      onFlush,
    });

    batcher.enqueueItem("a");
    batcher.flush();
    expect(onFlush).toHaveBeenCalledTimes(1);

    batcher.dispose();
    vi.useRealTimers();
  });
});
