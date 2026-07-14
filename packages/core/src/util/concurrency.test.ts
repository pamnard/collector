import { describe, expect, it, vi } from "vitest";
import {
  createSingleFlight,
  INDEX_SYNC_YIELD_MS,
  runWithConcurrencyYielding,
  yieldToEventLoop,
} from "./concurrency.js";

describe("concurrency backpressure", () => {
  it("yieldToEventLoop sleeps for the requested ms", async () => {
    vi.useFakeTimers();
    const done = yieldToEventLoop(INDEX_SYNC_YIELD_MS);
    let resolved = false;
    void done.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(INDEX_SYNC_YIELD_MS - 1);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });

  it("runWithConcurrencyYielding yields between chunks", async () => {
    vi.useFakeTimers();
    const started: number[] = [];
    const running = runWithConcurrencyYielding(
      5,
      2,
      async (index) => {
        started.push(index);
        return index;
      },
      { yieldEvery: 2, yieldMs: 16 },
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(started.length).toBe(2);

    await vi.advanceTimersByTimeAsync(16);
    await vi.advanceTimersByTimeAsync(0);
    expect(started.length).toBe(4);

    await vi.advanceTimersByTimeAsync(16);
    const results = await running;
    expect(results).toEqual([0, 1, 2, 3, 4]);
    vi.useRealTimers();
  });

  it("createSingleFlight shares one in-flight promise across concurrent callers", async () => {
    let runs = 0;
    let release!: (value: string) => void;
    const barrier = new Promise<string>((resolve) => {
      release = resolve;
    });
    const shared = createSingleFlight(async () => {
      runs += 1;
      return barrier;
    });

    const first = shared();
    const second = shared();
    expect(runs).toBe(1);

    release("ok");
    await expect(Promise.all([first, second])).resolves.toEqual(["ok", "ok"]);
    expect(runs).toBe(1);

    await expect(shared()).resolves.toBe("ok");
    expect(runs).toBe(2);
  });
});
