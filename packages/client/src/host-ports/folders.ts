import type {
  FolderTreeNode,
  FoldersPort,
  ServiceSubscribeHandlers,
  Subscription,
} from "@collector/api";
import {
  asCollectorApiError,
  subscriptionFromTeardown,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import type { IpcSessionCtx } from "../ipc-session-ctx.js";

export function createIpcFoldersPort(ctx: IpcSessionCtx): FoldersPort {
  const { transport } = ctx;
  return {
    subscribeFolderTree(
      onUpdate: (tree: FolderTreeNode[]) => void,
      handlers?: ServiceSubscribeHandlers,
      signal?: AbortSignal,
    ): Subscription {
      const controller = new AbortController();
      if (signal) {
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener("abort", () => controller.abort(), {
            once: true,
          });
        }
      }
      const active = controller.signal;
      void (async () => {
        try {
          if (active.aborted) {
            return;
          }
          onUpdate(
            (await transport.request("listFolderTree")) as FolderTreeNode[],
          );
        } catch (error: unknown) {
          if (!active.aborted) {
            handlers?.onError?.("folder tree", asCollectorApiError(error));
          }
        }
      })();
      return subscriptionFromTeardown(() => controller.abort());
    },
    listFolderTree: async (): Promise<FolderTreeNode[]> =>
      transport.request("listFolderTree") as Promise<FolderTreeNode[]>,
    createFolder: async (folderPath: string): Promise<string> =>
      transport.request("createFolder", { folderPath }) as Promise<string>,
    renameFolder: async (oldPath: string, newPath: string): Promise<string> =>
      transport.request("renameFolder", {
        oldPath,
        newPath,
      }) as Promise<string>,
    deleteFolder: async (folderPath: string): Promise<void> => {
      await transport.request("deleteFolder", { folderPath });
    },
    moveItemToFolderPath: async (
      itemId: string,
      folderPath: string,
    ): Promise<ItemFile> =>
      transport.request("moveItemToFolderPath", {
        itemId,
        folderPath,
      }) as Promise<ItemFile>,
  };
}
