import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ItemFile } from "@collector/shared";
import {
  nextItemPruneSignal,
  type ItemPruneSignal,
} from "../../hooks/useItemPruneEffect";
import { SIDEBAR_SEARCH_PAGE_SIZE } from "../../lib/sidebar-search-page";
import { useSidebarSearchResults } from "./use-sidebar-search-results";

function stubItem(id: string, title = id): ItemFile {
  return { id, title } as ItemFile;
}

function createItemsMock(allIds: string[]) {
  const queryIndex = vi.fn(
    async (
      _filter: "all",
      _query: string | undefined,
      page: { limit: number; offset: number },
    ) => {
      const ids = allIds.slice(page.offset, page.offset + page.limit);
      return {
        ids,
        stamps: ids.map((_, i) => String(i)),
        total: allIds.length,
        offset: page.offset,
      };
    },
  );
  const hydrate = vi.fn(async function* (ids: string[]) {
    for (const id of ids) {
      yield stubItem(id);
    }
  });
  return { queryIndex, hydrate };
}

describe("useSidebarSearchResults", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("keeps an empty list and does not fetch when the query is blank", async () => {
    const items = createItemsMock(["a.md", "b.md"]);
    const { result } = renderHook(() =>
      useSidebarSearchResults({
        searchQuery: "   ",
        vaultRevision: 1,
        itemPruneSignal: null,
        sidebarSearchLiveSeq: 0,
        items,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current.results).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(items.queryIndex).not.toHaveBeenCalled();
  });

  it("loads the first page after debounce", async () => {
    const allIds = Array.from({ length: 5 }, (_, i) => `item-${i}.md`);
    const items = createItemsMock(allIds);

    const { result } = renderHook(() =>
      useSidebarSearchResults({
        searchQuery: "hello",
        vaultRevision: 1,
        itemPruneSignal: null,
        sidebarSearchLiveSeq: 0,
        items,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.results.map((row) => row.id)).toEqual(allIds);
    expect(result.current.totalCount).toBe(5);
    expect(result.current.loadedIdCount).toBe(5);
    expect(result.current.hasMore).toBe(false);
    expect(items.queryIndex).toHaveBeenCalled();
  });

  it("appends the next page on loadMore", async () => {
    const allIds = Array.from(
      { length: SIDEBAR_SEARCH_PAGE_SIZE + 5 },
      (_, i) => `item-${i}.md`,
    );
    const items = createItemsMock(allIds);

    const { result } = renderHook(() =>
      useSidebarSearchResults({
        searchQuery: "page",
        vaultRevision: 1,
        itemPruneSignal: null,
        sidebarSearchLiveSeq: 0,
        items,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.results).toHaveLength(SIDEBAR_SEARCH_PAGE_SIZE);
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => {
      expect(result.current.isLoadingMore).toBe(false);
    });

    expect(result.current.results).toHaveLength(SIDEBAR_SEARCH_PAGE_SIZE + 5);
    expect(result.current.loadedIdCount).toBe(SIDEBAR_SEARCH_PAGE_SIZE + 5);
    expect(result.current.hasMore).toBe(false);
  });

  it("soft-refetches on live seq without flipping isLoading", async () => {
    const items = createItemsMock(["a.md", "b.md"]);
    let liveSeq = 0;
    const { result, rerender } = renderHook(
      ({ seq }: { seq: number }) =>
        useSidebarSearchResults({
          searchQuery: "live",
          vaultRevision: 1,
          itemPruneSignal: null,
          sidebarSearchLiveSeq: seq,
          items,
        }),
      { initialProps: { seq: liveSeq } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.results.map((row) => row.id)).toEqual([
      "a.md",
      "b.md",
    ]);

    items.queryIndex.mockImplementationOnce(
      async (
        _filter: "all",
        _query: string | undefined,
        page: { limit: number; offset: number },
      ) => {
        const ids = ["a.md", "c.md"].slice(page.offset, page.offset + page.limit);
        return {
          ids,
          stamps: ids.map((_, i) => String(i)),
          total: 2,
          offset: page.offset,
        };
      },
    );
    items.hydrate.mockImplementationOnce(async function* (ids: string[]) {
      for (const id of ids) {
        yield stubItem(id);
      }
    });

    liveSeq = 1;
    rerender({ seq: liveSeq });

    await waitFor(() => {
      expect(result.current.results.map((row) => row.id)).toEqual([
        "a.md",
        "c.md",
      ]);
    });
    expect(result.current.isLoading).toBe(false);
  });

  it("prunes a deleted id without lowering loadedIdCount high-water", async () => {
    const items = createItemsMock(["a.md", "b.md", "c.md"]);
    const { result, rerender } = renderHook(
      ({ signal }: { signal: ItemPruneSignal | null }) =>
        useSidebarSearchResults({
          searchQuery: "prune",
          vaultRevision: 1,
          itemPruneSignal: signal,
          sidebarSearchLiveSeq: 0,
          items,
        }),
      { initialProps: { signal: null as ItemPruneSignal | null } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const loadedBefore = result.current.loadedIdCount;
    expect(loadedBefore).toBe(3);
    expect(result.current.totalCount).toBe(3);

    rerender({ signal: nextItemPruneSignal(null, "b.md") });

    await waitFor(() => {
      expect(result.current.results.map((row) => row.id)).toEqual([
        "a.md",
        "c.md",
      ]);
    });
    expect(result.current.totalCount).toBe(2);
    expect(result.current.loadedIdCount).toBe(loadedBefore);
  });
});
