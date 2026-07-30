import type {
  AttachMediaFileInput,
  MediaPort,
  MediaWithPath,
} from "@collector/api";
import type { ItemFile, MediaFileMeta } from "@collector/shared";
import type { IpcSessionCtx } from "../ipc-session-ctx.js";

export function createIpcMediaPort(ctx: IpcSessionCtx): MediaPort {
  const { transport, thumbnails } = ctx;
  return {
    listItemMedia: async (itemId: string): Promise<MediaWithPath[]> =>
      transport.request("listItemMedia", {
        itemId,
      }) as Promise<MediaWithPath[]>,
    resolveItemThumbnailPath: (item: ItemFile): Promise<string | null> =>
      thumbnails.resolveItemThumbnailPath(item),
    resolveItemThumbnailPaths: (
      items: ItemFile[],
    ): Promise<Map<string, string | null>> =>
      thumbnails.resolveItemThumbnailPaths(items),
    setItemCoverFromMedia: async (
      itemId: string,
      mediaId: string,
    ): Promise<ItemFile> =>
      transport.request("setItemCoverFromMedia", {
        itemId,
        mediaId,
      }) as Promise<ItemFile>,
    attachMediaFiles: async (
      itemId: string,
      files: AttachMediaFileInput[],
    ): Promise<MediaFileMeta[]> =>
      transport.request("attachMediaFiles", {
        itemId,
        files: files.map((file) => ({
          filename: file.name,
          dataBase64: Buffer.from(file.bytes).toString("base64"),
        })),
      }) as Promise<MediaFileMeta[]>,
    replaceItemMedia: async (
      itemId: string,
      mediaId: string,
      file: AttachMediaFileInput,
    ): Promise<MediaFileMeta> =>
      transport.request("replaceItemMedia", {
        itemId,
        mediaId,
        file: {
          filename: file.name,
          dataBase64: Buffer.from(file.bytes).toString("base64"),
        },
      }) as Promise<MediaFileMeta>,
    deleteItemMedia: async (
      itemId: string,
      mediaId: string,
    ): Promise<void> => {
      await transport.request("deleteItemMedia", { itemId, mediaId });
    },
  };
}
