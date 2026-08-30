import type { ItemFile, MediaFileMeta } from "@collector/shared";
import type { AttachMediaFileInput, MediaWithPath } from "../domain.js";

/** Media / cover port (#361). */
export interface MediaPort {
  listItemMedia(itemId: string): Promise<MediaWithPath[]>;
  /**
   * @deprecated Absolute path resolution belongs on {@link UiSession.thumbnails} (#363).
   * Not part of the long-lived host transport contract (`Map` / abs paths).
   */
  resolveItemThumbnailPath(item: ItemFile): Promise<string | null>;
  /**
   * @deprecated Absolute path batch belongs on {@link UiSession.thumbnails} (#363).
   * Not part of the long-lived host transport contract (`Map` / abs paths).
   */
  resolveItemThumbnailPaths(
    items: ItemFile[],
  ): Promise<Map<string, string | null>>;
  setItemCoverFromMedia(itemId: string, mediaId: string): Promise<ItemFile>;
  attachMediaFiles(
    itemId: string,
    files: AttachMediaFileInput[],
  ): Promise<MediaFileMeta[]>;
  replaceItemMedia(
    itemId: string,
    mediaId: string,
    file: AttachMediaFileInput,
  ): Promise<MediaFileMeta>;
  deleteItemMedia(itemId: string, mediaId: string): Promise<void>;
}
