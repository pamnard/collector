import { describe, expect, it, vi } from "vitest";
import type { TagWithCount } from "@collector/api";
import type { HostSessionCtx } from "../host-session-ctx.js";
import { createHostTagsPort } from "./tags.js";

describe("createHostTagsPort.subscribeTags (#797)", () => {
  it("forwards listTags failures via onError", async () => {
    const request = vi.fn(async () => {
      throw new Error("list failed");
    });
    const transport = {
      request,
      onEvent: () => () => {},
    };
    const ctx = { transport } as unknown as HostSessionCtx;
    const onError = vi.fn();
    createHostTagsPort(ctx).subscribeTags(() => {}, { onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]![0]).toBe("tags");
    expect(onError.mock.calls[0]![1]).toMatchObject({
      message: "list failed",
    });
  });

  it("skips onError after abort", async () => {
    let rejectRequest!: (error: Error) => void;
    const request = vi.fn(
      () =>
        new Promise<never>((_, reject) => {
          rejectRequest = reject;
        }),
    );
    const transport = {
      request,
      onEvent: () => () => {},
    };
    const ctx = { transport } as unknown as HostSessionCtx;
    const onError = vi.fn();
    const controller = new AbortController();
    const sub = createHostTagsPort(ctx).subscribeTags(
      () => {},
      { onError },
      controller.signal,
    );
    controller.abort();
    sub.unsubscribe();
    rejectRequest(new Error("late"));
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });

  it("skips onUpdate after abort mid-request when listTags later resolves (#813)", async () => {
    let resolveRequest!: (value: TagWithCount[]) => void;
    const request = vi.fn(
      () =>
        new Promise<TagWithCount[]>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const transport = {
      request,
      onEvent: () => () => {},
    };
    const ctx = { transport } as unknown as HostSessionCtx;
    const onUpdate = vi.fn();
    const onError = vi.fn();
    const controller = new AbortController();
    const sub = createHostTagsPort(ctx).subscribeTags(
      onUpdate,
      { onError },
      controller.signal,
    );
    controller.abort();
    sub.unsubscribe();
    resolveRequest([{ id: "t1", name: "a", color: null, item_count: 1 }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("publishes listTags result when not aborted", async () => {
    const tags: TagWithCount[] = [
      { id: "t1", name: "a", color: null, item_count: 1 },
    ];
    const request = vi.fn(async () => tags);
    const transport = {
      request,
      onEvent: () => () => {},
    };
    const ctx = { transport } as unknown as HostSessionCtx;
    const updates: TagWithCount[][] = [];
    const sub = createHostTagsPort(ctx).subscribeTags((next) => {
      updates.push(next);
    });
    await vi.waitFor(() => expect(updates).toEqual([tags]));
    sub.unsubscribe();
  });
});
