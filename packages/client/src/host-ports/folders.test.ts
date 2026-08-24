import { describe, expect, it, vi } from "vitest";
import { SERVICE_HOST_EVENTS } from "@collector/service/wire";
import { createHostFoldersPort } from "./folders.js";
import type { HostSessionCtx } from "../host-session-ctx.js";

function foldersCtx(transport: {
  request: (...args: never[]) => unknown;
  onEvent: (...args: never[]) => unknown;
}): HostSessionCtx {
  return {
    transport,
    cachedSyncStatus: {
      vaultId: null,
      status: "idle",
      progress: null,
      metadataReady: false,
      ftsReady: false,
    },
  } as unknown as HostSessionCtx;
}

describe("createHostFoldersPort.subscribeFolderTree (#567)", () => {
  it("re-lists the tree when vaultIndexSyncStatus transitions to done", async () => {
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    const request = vi.fn(async () => [{ path: "Inbox", item_count: 0, children: [] }]);
    const transport = {
      request,
      onEvent: (event: string, handler: (payload: unknown) => void) => {
        let set = listeners.get(event);
        if (!set) {
          set = new Set();
          listeners.set(event, set);
        }
        set.add(handler);
        return () => {
          set!.delete(handler);
        };
      },
    };

    const updates: unknown[] = [];
    const sub = createHostFoldersPort(foldersCtx(transport)).subscribeFolderTree(
      (tree) => {
        updates.push(tree);
      },
    );

    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    const statusListeners = listeners.get(SERVICE_HOST_EVENTS.vaultIndexSyncStatus);
    expect(statusListeners?.size).toBe(1);
    const emit = [...statusListeners!][0]!;
    emit({
      vaultId: "v1",
      status: "running",
      progress: null,
      metadataReady: true,
      ftsReady: true,
    });
    emit({
      vaultId: "v1",
      status: "done",
      progress: null,
      metadataReady: true,
      ftsReady: true,
    });

    await vi.waitFor(() => expect(request.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(updates.length).toBeGreaterThanOrEqual(2);
    sub.unsubscribe();
  });

  it("does not start listFolderTree when the abort signal is already aborted (#798)", async () => {
    const request = vi.fn(async () => {
      throw new Error("should not call host");
    });
    const updates: unknown[] = [];
    const onError = vi.fn();
    const sub = createHostFoldersPort(
      foldersCtx({ request, onEvent: () => () => {} }),
    ).subscribeFolderTree(
      (tree) => {
        updates.push(tree);
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

  it("suppresses onError when aborted before a failing list settles (#798)", async () => {
    let rejectRequest!: (error: unknown) => void;
    const request = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject;
        }),
    );
    const onError = vi.fn();
    const external = new AbortController();
    const sub = createHostFoldersPort(
      foldersCtx({ request, onEvent: () => () => {} }),
    ).subscribeFolderTree(() => {}, { onError }, external.signal);

    expect(request).toHaveBeenCalledOnce();
    external.abort();
    rejectRequest(new Error("folder tree down"));
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
    sub.unsubscribe();
  });
});
