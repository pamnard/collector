import { describe, expect, it, vi } from "vitest";
import { SERVICE_HOST_EVENTS } from "@collector/service/wire";
import { createHostFoldersPort } from "./folders.js";
import type { HostSessionCtx } from "../host-session-ctx.js";

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
    const ctx = {
      transport,
      cachedSyncStatus: {
        vaultId: null,
        status: "idle",
        progress: null,
        metadataReady: false,
        ftsReady: false,
      },
    } as unknown as HostSessionCtx;

    const updates: unknown[] = [];
    const sub = createHostFoldersPort(ctx).subscribeFolderTree((tree) => {
      updates.push(tree);
    });

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

  it("forwards listFolderTree failures via onError (#797)", async () => {
    const request = vi.fn(async () => {
      throw new Error("tree failed");
    });
    const transport = {
      request,
      onEvent: () => () => {},
    };
    const ctx = { transport } as unknown as HostSessionCtx;
    const onError = vi.fn();
    createHostFoldersPort(ctx).subscribeFolderTree(() => {}, { onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]![0]).toBe("folder tree");
    expect(onError.mock.calls[0]![1]).toMatchObject({ message: "tree failed" });
  });

  it("skips onError after unsubscribe (#797)", async () => {
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
    const sub = createHostFoldersPort(ctx).subscribeFolderTree(() => {}, {
      onError,
    });
    sub.unsubscribe();
    rejectRequest(new Error("late"));
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });

  it("skips onUpdate after unsubscribe mid-request when listFolderTree later resolves (#813)", async () => {
    let resolveRequest!: (value: unknown) => void;
    const request = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
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
    const sub = createHostFoldersPort(ctx).subscribeFolderTree(onUpdate, {
      onError,
    });
    sub.unsubscribe();
    resolveRequest([{ path: "Inbox", item_count: 0, children: [] }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("createHostFoldersPort.listFolderItems (#844)", () => {
  it("forwards folderPath over the host wire", async () => {
    const request = vi.fn(async () => [{ id: "Parent/a.md", folder_path: "Parent" }]);
    const transport = {
      request,
      onEvent: () => () => {},
    };
    const ctx = {
      transport,
      cachedSyncStatus: {
        vaultId: null,
        status: "idle",
        progress: null,
        metadataReady: false,
        ftsReady: false,
      },
    } as unknown as HostSessionCtx;

    const items = await createHostFoldersPort(ctx).listFolderItems("Parent");
    expect(request).toHaveBeenCalledWith("listFolderItems", {
      folderPath: "Parent",
    });
    expect(items).toEqual([{ id: "Parent/a.md", folder_path: "Parent" }]);
  });
});
