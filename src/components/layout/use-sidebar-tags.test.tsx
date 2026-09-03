import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { TagWithCount } from "@collector/core";
import { subscriptionFromTeardown } from "@collector/api";
import {
  createDevMockCollectorService,
  createDevMockUiSession,
  setCollectorService,
} from "../../services/collector-client";
import { AlertBusProvider } from "../alerts/AlertBusProvider";
import { emitTagListRefresh } from "../../lib/tag-list-live";
import { useSidebarTags } from "./use-sidebar-tags";

function tag(count: number): TagWithCount {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Research",
    created_at: "2024-01-01T00:00:00.000Z",
    item_count: count,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("useSidebarTags", () => {
  afterEach(() => {
    cleanup();
  });

  it("refetches tags on tag-list live refresh without vaultRevision bump", async () => {
    const first = [tag(2)];
    const second = [tag(1)];
    const listTags = vi
      .fn<() => Promise<TagWithCount[]>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const service = createDevMockCollectorService();
    service.tags.listTags = listTags;
    service.tags.subscribeTags = (onUpdate, _handlers, signal) => {
      void service.tags.listTags().then((tags) => {
        if (!signal?.aborted) {
          onUpdate(tags);
        }
      });
      return subscriptionFromTeardown(() => {});
    };
    setCollectorService(service, createDevMockUiSession(service));

    const { result } = renderHook(() => useSidebarTags(1), {
      wrapper: ({ children }) => <AlertBusProvider>{children}</AlertBusProvider>,
    });

    await waitFor(() => {
      expect(result.current).toEqual(first);
    });

    await act(async () => {
      emitTagListRefresh();
    });

    await waitFor(() => {
      expect(result.current).toEqual(second);
    });
    expect(listTags).toHaveBeenCalledTimes(2);
  });

  it("ignores an older tag refresh that resolves after a newer one", async () => {
    const initial = [tag(3)];
    const older = deferred<TagWithCount[]>();
    const newer = deferred<TagWithCount[]>();
    const stale = [tag(1)];
    const fresh = [tag(4)];
    const listTags = vi
      .fn<() => Promise<TagWithCount[]>>()
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const service = createDevMockCollectorService();
    service.tags.listTags = listTags;
    service.tags.subscribeTags = (onUpdate, _handlers, signal) => {
      void service.tags.listTags().then((tags) => {
        if (!signal?.aborted) {
          onUpdate(tags);
        }
      });
      return subscriptionFromTeardown(() => {});
    };
    setCollectorService(service, createDevMockUiSession(service));

    const { result } = renderHook(() => useSidebarTags(1), {
      wrapper: ({ children }) => <AlertBusProvider>{children}</AlertBusProvider>,
    });

    await waitFor(() => {
      expect(result.current).toEqual(initial);
    });

    await act(async () => {
      emitTagListRefresh();
      emitTagListRefresh();
    });

    await act(async () => {
      newer.resolve(fresh);
      await newer.promise;
    });

    await waitFor(() => {
      expect(result.current).toEqual(fresh);
    });

    await act(async () => {
      older.resolve(stale);
      await older.promise;
    });

    await waitFor(() => {
      expect(result.current).toEqual(fresh);
    });
    expect(listTags).toHaveBeenCalledTimes(3);
  });
});
