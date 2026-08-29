import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useNearViewport } from "./useNearViewport";

describe("useNearViewport", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("starts optimistic near so cover decode is not deferred on first paint", () => {
    const { result } = renderHook(() => useNearViewport(null));
    expect(result.current).toBe(true);
  });

  it("does not flip to false while the card node is still null", async () => {
    const { result, rerender } = renderHook(
      ({ node }: { node: Element | null }) => useNearViewport(node),
      { initialProps: { node: null } },
    );
    expect(result.current).toBe(true);
    rerender({ node: null });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(true);
  });

  it("follows IntersectionObserver once a node is attached", async () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    let listener:
      | ((entries: IntersectionObserverEntry[]) => void)
      | null = null;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          cb: (entries: IntersectionObserverEntry[]) => void,
        ) {
          listener = cb;
        }
        observe = observe;
        disconnect = disconnect;
        unobserve = vi.fn();
        takeRecords = vi.fn(() => []);
        root = null;
        rootMargin = "";
        thresholds = [];
      },
    );

    const el = document.createElement("div");
    const { result } = renderHook(() => useNearViewport(el));
    expect(observe).toHaveBeenCalledWith(el);

    await act(async () => {
      listener?.([
        { isIntersecting: false } as IntersectionObserverEntry,
      ]);
    });
    expect(result.current).toBe(false);

    await act(async () => {
      listener?.([
        { isIntersecting: true } as IntersectionObserverEntry,
      ]);
    });
    expect(result.current).toBe(true);
  });
});
