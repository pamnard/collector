import { describe, expect, it, vi } from "vitest";
import { createHostTagsPort } from "./tags.js";
import type { HostSessionCtx } from "../host-session-ctx.js";

function tagsCtx(request: (...args: never[]) => unknown): HostSessionCtx {
  return {
    transport: { request, onEvent: () => () => {} },
  } as unknown as HostSessionCtx;
}

describe("createHostTagsPort.subscribeTags abort (#798)", () => {
  it("does not start listTags when the abort signal is already aborted", async () => {
    const request = vi.fn(async () => {
      throw new Error("should not call host");
    });
    const updates: unknown[] = [];
    const onError = vi.fn();
    const sub = createHostTagsPort(tagsCtx(request)).subscribeTags(
      (tags) => {
        updates.push(tags);
      },
      { onError },
      AbortSignal.abort(),
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(request).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it("suppresses onError when aborted before a failing list settles", async () => {
    let rejectRequest!: (error: unknown) => void;
    const request = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject;
        }),
    );
    const onError = vi.fn();
    const external = new AbortController();
    const sub = createHostTagsPort(tagsCtx(request)).subscribeTags(
      () => {},
      { onError },
      external.signal,
    );

    expect(request).toHaveBeenCalledOnce();
    external.abort();
    rejectRequest(new Error("tags down"));
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it("forwards list errors when not aborted", async () => {
    const request = vi.fn(async () => {
      throw new Error("tags down");
    });
    const onError = vi.fn();
    const sub = createHostTagsPort(tagsCtx(request)).subscribeTags(
      () => {},
      { onError },
    );

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0]![0]).toBe("tags");
    sub.unsubscribe();
  });
});
