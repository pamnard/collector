/**
 * Sync plugin handoff (#28): NormalizedSyncItem → create / attach / delete.
 * Cycle owns markImported between create and attach (#dedup-after-create).
 */

import type {
  AttachMediaFileInput,
  BinaryPayload,
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
  deleteItem: (itemId: string) => Promise<void>;
}

export interface SyncPluginImportResult {
  itemId: string;
  remoteId: string;
}

export interface SyncPluginHandoff {
  createFromNormalized(
    item: NormalizedSyncItem,
  ): Promise<SyncPluginImportResult>;
  attachMedia(itemId: string, media?: BinaryPayload[]): Promise<void>;
  deleteItem(itemId: string): Promise<void>;
  /**
   * create → attach with delete compensate on attach failure.
   * Prefer cycle's create → mark → attach path for plugins with markImported.
   */
  importItem(item: NormalizedSyncItem): Promise<SyncPluginImportResult>;
}

function assertNormalizedItem(item: NormalizedSyncItem): void {
  if (!item.remoteId.trim()) {
    throw new Error("NormalizedSyncItem.remoteId is required");
  }
  if (!item.title.trim()) {
    throw new Error("NormalizedSyncItem.title is required");
  }
  if (!item.content_type) {
    throw new Error("NormalizedSyncItem.content_type is required");
  }
}

export function createSyncPluginHandoff(
  deps: SyncPluginHandoffDeps,
): SyncPluginHandoff {
  const createFromNormalized = async (
    item: NormalizedSyncItem,
  ): Promise<SyncPluginImportResult> => {
    assertNormalizedItem(item);

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
    return { itemId: created.id, remoteId: item.remoteId };
  };

  const attachMedia = async (
    itemId: string,
    media?: BinaryPayload[],
  ): Promise<void> => {
    if (media && media.length > 0) {
      await deps.attachMediaFiles(itemId, media);
    }
  };

  const deleteItem = async (itemId: string): Promise<void> => {
    await deps.deleteItem(itemId);
  };

  return {
    createFromNormalized,
    attachMedia,
    deleteItem,
    async importItem(item: NormalizedSyncItem): Promise<SyncPluginImportResult> {
      const created = await createFromNormalized(item);
      try {
        await attachMedia(created.itemId, item.media);
      } catch (error) {
        await deleteItem(created.itemId);
        throw error;
      }
      return created;
    },
  };
}
