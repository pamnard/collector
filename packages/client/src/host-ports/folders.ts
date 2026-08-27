import type {
  FolderTreeNode,
  FoldersPort,
  ServiceSubscribeHandlers,
  Subscription,
  VaultIndexSyncStatus,
} from "@collector/api";
import { subscriptionFromTeardown } from "@collector/api";
import type { ItemFile } from "@collector/shared";
import { SERVICE_HOST_EVENTS } from "@collector/service/wire";
import type { HostSessionCtx } from "../host-session-ctx.js";
import {
  createThrottledPublisher,
  voidSubscribePublishResult,
  withAbortBridge,
} from "./subscribe-helpers.js";

const FOLDER_TREE_SYNC_REPUBLISH_MS = 500;

export function createHostFoldersPort(ctx: HostSessionCtx): FoldersPort {
  const { transport } = ctx;
  return {
    subscribeFolderTree(
      onUpdate: (tree: FolderTreeNode[]) => void,
      handlers?: ServiceSubscribeHandlers,
      signal?: AbortSignal,
    ): Subscription {
      const { signal: active, dispose } = withAbortBridge(signal);
      let lastStatus: VaultIndexSyncStatus["status"] | null = null;

      const publish = () =>
        voidSubscribePublishResult(
          active,
          () => transport.request("listFolderTree") as Promise<FolderTreeNode[]>,
          onUpdate,
          handlers,
          "folder tree",
        );

      const republish = createThrottledPublisher(() => {
        publish();
      }, FOLDER_TREE_SYNC_REPUBLISH_MS);

      const unsubEvent = transport.onEvent(
        SERVICE_HOST_EVENTS.vaultIndexSyncStatus,
        (payload) => {
          if (active.aborted) {
            return;
          }
          const status = (payload as VaultIndexSyncStatus).status;
          const prev = lastStatus;
          lastStatus = status;
          if (status === "running" || status === "rebuilding") {
            republish.schedule();
          }
          if (
            (prev === "running" || prev === "rebuilding") &&
            status === "done"
          ) {
            republish.flush();
          }
        },
      );

      publish();

      return subscriptionFromTeardown(() => {
        republish.cancel();
        unsubEvent();
        dispose();
      });
    },
    listFolderTree: async (): Promise<FolderTreeNode[]> =>
      transport.request("listFolderTree") as Promise<FolderTreeNode[]>,
    listFolderItems: async (folderPath: string): Promise<ItemFile[]> =>
      transport.request("listFolderItems", { folderPath }) as Promise<
        ItemFile[]
      >,
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
