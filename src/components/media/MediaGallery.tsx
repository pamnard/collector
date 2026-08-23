import { ImagePlus } from "lucide-react";
import type { MediaWithPath } from "@collector/core";
import type { ItemFile } from "@collector/shared";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MediaGalleryListRow } from "./MediaGalleryListRow";
import { MediaGalleryVisualTile } from "./MediaGalleryVisualTile";
import { ItemDetailAsideSection } from "../items/ItemDetailAsideSection";
import { useMediaGallery } from "./use-media-gallery";

interface MediaGalleryProps {
  itemId: string;
  /** Item cover — poster for video tiles (`<video>` frames often stay blank). */
  item?: ItemFile;
  onUpdated?: () => void;
  onPlayMedia?: (file: MediaWithPath) => void;
}

export function MediaGallery({
  itemId,
  item,
  onUpdated,
  onPlayMedia,
}: MediaGalleryProps) {
  const {
    inputRef,
    files,
    isUploading,
    coverMediaId,
    coverSrc,
    pendingDelete,
    setPendingDelete,
    isDeleting,
    visualFiles,
    listFiles,
    handleUpload,
    handleConfirmDelete,
    handleSetCover,
    requestDelete,
  } = useMediaGallery({ itemId, item, onUpdated });

  return (
    <>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
          }
        }}
        title={pendingDelete?.filename.trim() || "Файл"}
        description="Удалить файл?"
        busy={isDeleting}
        onConfirm={handleConfirmDelete}
      />

      <ItemDetailAsideSection
        title={
          <>
            Медиа
            <Badge
              variant="ghost"
              className="h-5 min-w-5 shrink-0 px-1.5 text-xs font-medium tabular-nums text-neutral-500 dark:text-neutral-400"
            >
              {files.length}
            </Badge>
          </>
        }
        defaultOpen={false}
      >
        <div className="space-y-3">
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleUpload}
          />

          {files.length === 0 ? (
            <p className="text-neutral-500 dark:text-neutral-400 text-sm">
              Нет прикреплённых файлов.
            </p>
          ) : (
            <div className="space-y-3">
              {visualFiles.length > 0 && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2">
                  {visualFiles.map((file) => (
                    <MediaGalleryVisualTile
                      key={file.id}
                      file={file}
                      coverSrc={coverSrc}
                      coverBusy={coverMediaId === file.id}
                      onSetCover={(mediaId) => void handleSetCover(mediaId)}
                      onRequestDelete={requestDelete}
                      onPlayMedia={onPlayMedia}
                    />
                  ))}
                </div>
              )}

              {listFiles.length > 0 && (
                <div className="flex flex-col gap-2">
                  {listFiles.map((file) => (
                    <MediaGalleryListRow
                      key={file.id}
                      file={file}
                      onRequestDelete={requestDelete}
                      onPlayMedia={onPlayMedia}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-black/10 dark:border-white/10 px-3 py-1.5 text-sm hover:bg-neutral-100/65 dark:hover:bg-neutral-700/65 disabled:opacity-50"
          >
            <ImagePlus size={16} />
            {isUploading ? "Загрузка…" : "Добавить"}
          </button>
        </div>
      </ItemDetailAsideSection>
    </>
  );
}
