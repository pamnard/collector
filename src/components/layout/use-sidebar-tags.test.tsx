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

describe("useSidebarTags", () => {
  afterEach(() => {
    cleanup();
  });

  it("refetches tags on tag-list live refresh without vaultRevision bump", async () => {
    const first: TagWithCount[] = [{ id: "t1", name: "Research", item_count: 2 }];
    const second: TagWithCount[] = [{ id: "t1", name: "Research", item_count: 1 }];
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
});
