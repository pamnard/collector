import { ImagePlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaWithPath } from "@collector/core";
import type { ItemFile } from "@collector/shared";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toDisplayAssetSrc } from "../../utils/asset-src";
import {
  getCollectorService,
  getUiSession,
} from "../../services/collector-client";
import { MediaGalleryListRow } from "./MediaGalleryListRow";
import { MediaGalleryVisualTile } from "./MediaGalleryVisualTile";

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
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<MediaWithPath[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [coverMediaId, setCoverMediaId] = useState<string | null>(null);
  const [coverSrc, setCoverSrc] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    filename: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadMedia = useCallback(async () => {
    setError(null);
    try {
      setFiles(await getCollectorService().media.listItemMedia(itemId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [itemId]);

  useEffect(() => {
    void loadMedia();
  }, [loadMedia]);

  useEffect(() => {
    if (!item) {
      setCoverSrc(null);
      return;
    }

    let cancelled = false;
    setCoverSrc(null);
    void getUiSession()
      .thumbnails.resolveItemThumbnailPath(item)
      .catch(() => null)
      .then((path) => {
        if (cancelled || !path) {
          return;
        }
        setCoverSrc(toDisplayAssetSrc(path));
      });

    return () => {
      cancelled = true;
    };
  }, [item?.id, item?.thumbnail, item?.updated_at]);

  const { images, others } = useMemo(() => {
    const imageFiles: MediaWithPath[] = [];
    const otherFiles: MediaWithPath[] = [];
    for (const file of files) {
      if (file.media_type === "image") {
        imageFiles.push(file);
      } else {
        otherFiles.push(file);
      }
    }
    return { images: imageFiles, others: otherFiles };
  }, [files]);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files;
    if (!selected?.length) {
      return;
    }

    setIsUploading(true);
    setError(null);
    try {
      const payload = await Promise.all(
        [...selected].map(async (file) => ({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      await getCollectorService().media.attachMediaFiles(itemId, payload);
      await loadMedia();
      onUpdated?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) {
      return;
    }

    setIsDeleting(true);
    setError(null);
    try {
      await getCollectorService().media.deleteItemMedia(
        itemId,
        pendingDelete.id,
      );
      await loadMedia();
      onUpdated?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSetCover = async (mediaId: string) => {
    setCoverMediaId(mediaId);
    setError(null);
    try {
      await getCollectorService().media.setItemCoverFromMedia(itemId, mediaId);
      onUpdated?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCoverMediaId(null);
    }
  };

  const requestDelete = (file: MediaWithPath) => {
    setPendingDelete({ id: file.id, filename: file.filename });
  };

  const visualFiles = useMemo(
    () => [...images, ...others.filter((f) => f.media_type === "video")],
    [images, others],
  );
  const listFiles = useMemo(
    () => others.filter((f) => f.media_type !== "video"),
    [others],
  );

  return (
    <section className="mt-4 space-y-3">
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

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Медиа</h2>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
          className="inline-flex items-center gap-2 rounded-lg border border-black/10 dark:border-white/10 px-3 py-1.5 text-sm hover:bg-neutral-100/65 dark:hover:bg-neutral-700/65 disabled:opacity-50"
        >
          <ImagePlus size={16} />
          {isUploading ? "Загрузка…" : "Добавить"}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleUpload}
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {files.length === 0 ? (
        <p className="text-neutral-500 dark:text-neutral-400 text-sm">
          Нет прикреплённых файлов.
        </p>
      ) : (
        <div className="space-y-3">
          {visualFiles.length > 0 && (
            <div className="flex flex-wrap gap-2">
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
    </section>
  );
}
