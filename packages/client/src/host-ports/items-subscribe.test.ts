import { describe, expect, it, vi } from "vitest";
import type { DashboardIndexPage } from "@collector/api";
import type { HostSessionCtx } from "../host-session-ctx.js";
import { createHostItemsPort } from "./items.js";

const emptyPage: DashboardIndexPage = {
  itemIds: [],
  stamps: [],
  totalCount: 0,
  offset: 0,
};

describe("createHostItemsPort.subscribeDashboardLoad (#797)", () => {
  it("forwards fetch failures via onError", async () => {
    const request = vi.fn(async () => {
      throw new Error("dashboard failed");
    });
    const transport = {
      request,
      onEvent: () => () => {},
    };
    const ctx = { transport } as unknown as HostSessionCtx;
    const onError = vi.fn();
    createHostItemsPort(ctx).subscribeDashboardLoad(
      "all",
      "",
      { onIndexPage: () => {}, onError },
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]![0]).toBe("dashboard load");
    expect(onError.mock.calls[0]![1]).toMatchObject({
      message: "dashboard failed",
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
    const sub = createHostItemsPort(ctx).subscribeDashboardLoad(
      "all",
      "",
      { onIndexPage: () => {}, onError },
      controller.signal,
    );
    controller.abort();
    sub.unsubscribe();
    rejectRequest(new Error("late"));
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });

  it("delivers index page then onLoadComplete", async () => {
    const request = vi.fn(async () => emptyPage);
    const transport = {
      request,
      onEvent: () => () => {},
    };
    const ctx = { transport } as unknown as HostSessionCtx;
    const pages: DashboardIndexPage[] = [];
    const onLoadComplete = vi.fn();
    const sub = createHostItemsPort(ctx).subscribeDashboardLoad(
      "all",
      "",
      {
        onIndexPage: (page) => {
          pages.push(page);
        },
        onLoadComplete,
      },
    );
    await vi.waitFor(() => expect(pages).toEqual([emptyPage]));
    expect(onLoadComplete).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });
});
