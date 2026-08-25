import { describe, expect, it, vi } from "vitest";
import {
  createThrottledPublisher,
  forwardSubscribeError,
  voidSubscribePublish,
  voidSubscribePublishResult,
  withAbortBridge,
} from "./subscribe-helpers.js";

describe("withAbortBridge (#797)", () => {
  it("dispose aborts the bridged signal", () => {
    const { signal, dispose } = withAbortBridge();
    expect(signal.aborted).toBe(false);
    dispose();
    expect(signal.aborted).toBe(true);
  });

  it("links an already-aborted external signal", () => {
    const external = AbortSignal.abort();
    const { signal } = withAbortBridge(external);
    expect(signal.aborted).toBe(true);
  });

  it("aborts when the external signal aborts", () => {
    const external = new AbortController();
    const { signal } = withAbortBridge(external.signal);
    expect(signal.aborted).toBe(false);
    external.abort();
    expect(signal.aborted).toBe(true);
  });
});

describe("createThrottledPublisher (#797)", () => {
  it("runs immediately on first schedule, then throttles", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const pub = createThrottledPublisher(fn, 500);
    pub.schedule();
    expect(fn).toHaveBeenCalledTimes(1);
    pub.schedule();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(2);
    pub.cancel();
    vi.useRealTimers();
  });

  it("flush runs immediately and cancel drops a pending timer", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const pub = createThrottledPublisher(fn, 500);
    pub.schedule();
    expect(fn).toHaveBeenCalledTimes(1);
    pub.schedule();
    pub.flush();
    expect(fn).toHaveBeenCalledTimes(2);
    pub.schedule();
    pub.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("forwardSubscribeError (#797)", () => {
  it("forwards via onError when not aborted", () => {
    const onError = vi.fn();
    forwardSubscribeError({ onError }, "tags", new Error("boom"));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBe("tags");
    expect(onError.mock.calls[0]![1]).toEqual({
      layer: "domain",
      code: "failed",
      message: "boom",
    });
  });

  it("skips onError when the signal is aborted", () => {
    const onError = vi.fn();
    forwardSubscribeError(
      { onError },
      "tags",
      new Error("boom"),
      AbortSignal.abort(),
    );
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("voidSubscribePublish (#797)", () => {
  it("forwards errors and skips when aborted", async () => {
    const onError = vi.fn();
    voidSubscribePublish(
      new AbortController().signal,
      async () => {
        throw new Error("publish failed");
      },
      { onError },
      "scope",
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]![0]).toBe("scope");

    const skipped = vi.fn();
    voidSubscribePublish(
      AbortSignal.abort(),
      async () => {
        skipped();
      },
      { onError },
      "scope",
    );
    await Promise.resolve();
    expect(skipped).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("skips onResult after abort mid-request when load later resolves (#813)", async () => {
    let resolveLoad!: (value: string) => void;
    const onResult = vi.fn();
    const onError = vi.fn();
    const controller = new AbortController();
    voidSubscribePublishResult(
      controller.signal,
      () =>
        new Promise<string>((resolve) => {
          resolveLoad = resolve;
        }),
      onResult,
      { onError },
      "scope",
    );
    controller.abort();
    resolveLoad("late");
    await Promise.resolve();
    await Promise.resolve();
    expect(onResult).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
