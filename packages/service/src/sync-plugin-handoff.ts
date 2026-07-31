/**
 * Sync plugin handoff (#28): NormalizedSyncItem → createItem + attachMediaFiles.
 */

import type {
  AttachMediaFileInput,
  CreateItemInput,
  NormalizedSyncItem,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";

export interface SyncPluginHandoffDeps {
  createItem: (input: CreateItemInput) => Promise<ItemFile>;
  attachMediaFiles: (
    itemId: string,
    files: AttachMediaFileInput[],
  ) => Promise<unknown>;
}

export interface SyncPluginImportResult {
  itemId: string;
  remoteId: string;
}

export interface SyncPluginHandoff {
  importItem(item: NormalizedSyncItem): Promise<SyncPluginImportResult>;
}

export function createSyncPluginHandoff(
  deps: SyncPluginHandoffDeps,
): SyncPluginHandoff {
  return {
    async importItem(item: NormalizedSyncItem): Promise<SyncPluginImportResult> {
      if (!item.remoteId.trim()) {
        throw new Error("NormalizedSyncItem.remoteId is required");
      }
      if (!item.title.trim()) {
        throw new Error("NormalizedSyncItem.title is required");
      }
      if (!item.content_type) {
        throw new Error("NormalizedSyncItem.content_type is required");
      }

      const folder = item.folder_path?.trim() ?? "";
      const createInput: CreateItemInput = {
        title: item.title,
        content_type: item.content_type,
        content: item.body ?? null,
        url: item.url ?? null,
        source_type: "plugin",
      };
      if (folder) {
        createInput.folder_path = folder;
      }
      if (item.sourceRef) {
        createInput.sourceRef = item.sourceRef;
      }

      const created = await deps.createItem(createInput);
      if (item.media && item.media.length > 0) {
        await deps.attachMediaFiles(created.id, item.media);
      }

      return { itemId: created.id, remoteId: item.remoteId };
    },
  };
}
