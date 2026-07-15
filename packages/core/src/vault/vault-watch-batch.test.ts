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

    batcher.enqueue("one");
    batcher.enqueue("two");
    batcher.enqueue("one");
    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith(["one", "two"]);

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

    batcher.enqueue("a");
    batcher.flush();
    expect(onFlush).toHaveBeenCalledTimes(1);

    batcher.dispose();
    vi.useRealTimers();
  });
});
