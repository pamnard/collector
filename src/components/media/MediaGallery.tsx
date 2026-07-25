import { ImagePlus, Play, Star, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaWithPath } from "@collector/core";
import { toDisplayAssetSrc } from "../../utils/asset-src";
import type { PlayableMediaKind } from "../../utils/local-media-playback";
import { getCollectorClient } from "../../services/collector-client";

interface MediaGalleryProps {
  itemId: string;
  onUpdated?: () => void;
  onPlayMedia?: (file: MediaWithPath) => void;
}

function isPlayableMediaType(
  mediaType: string,
): mediaType is PlayableMediaKind {
  return mediaType === "video" || mediaType === "audio";
}

export function MediaGallery({
  itemId,
  onUpdated,
  onPlayMedia,
}: MediaGalleryProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<MediaWithPath[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [coverMediaId, setCoverMediaId] = useState<string | null>(null);

  const loadMedia = useCallback(async () => {
    setError(null);
    try {
      setFiles(await getCollectorClient().listItemMedia(itemId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [itemId]);

  useEffect(() => {
    void loadMedia();
  }, [loadMedia]);

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
          filename: file.name,
          data: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      await getCollectorClient().attachMediaFiles(itemId, payload);
      await loadMedia();
      onUpdated?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const handleDelete = async (mediaId: string) => {
    if (!window.confirm("Удалить файл?")) {
      return;
    }

    setError(null);
    try {
      await getCollectorClient().deleteItemMedia(itemId, mediaId);
      await loadMedia();
      onUpdated?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSetCover = async (mediaId: string) => {
    setCoverMediaId(mediaId);
    setError(null);
    try {
      await getCollectorClient().setItemCoverFromMedia(itemId, mediaId);
      onUpdated?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCoverMediaId(null);
    }
  };

  return (
    <section className="space-y-3">
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
        <p className="text-neutral-500 dark:text-neutral-400 text-sm">Нет прикреплённых файлов.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {files.map((file) => {
            const playable = isPlayableMediaType(file.media_type);
            return (
              <div
                key={file.id}
                className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-800 overflow-hidden"
              >
                {file.media_type === "image" ? (
                  <img
                    src={toDisplayAssetSrc(file.absolute_path)}
                    alt={file.filename}
                    className="w-full h-40 object-cover bg-neutral-100/20 dark:bg-neutral-700/20"
                  />
                ) : playable && onPlayMedia ? (
                  <button
                    type="button"
                    onClick={() => onPlayMedia(file)}
                    aria-label={
                      file.media_type === "video"
                        ? `Смотреть ${file.filename}`
                        : `Слушать ${file.filename}`
                    }
                    className="relative flex h-40 w-full items-center justify-center bg-neutral-100/20 dark:bg-neutral-700/20 text-neutral-500 dark:text-neutral-400 transition-colors hover:bg-neutral-100/35 dark:hover:bg-neutral-700/35 hover:text-neutral-900 dark:hover:text-neutral-100"
                  >
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex size-12 items-center justify-center rounded-full bg-black/65 text-white">
                        <Play size={22} fill="currentColor" className="ml-0.5" />
                      </span>
                    </span>
                    <span className="relative z-[1] mt-16 max-w-full truncate px-4 text-sm">
                      {file.media_type}: {file.filename}
                    </span>
                  </button>
                ) : (
                  <div className="h-40 flex items-center justify-center bg-neutral-100/20 dark:bg-neutral-700/20 text-neutral-500 dark:text-neutral-400 text-sm px-4 text-center">
                    {file.media_type}: {file.filename}
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 p-3">
                  <p className="text-sm truncate">{file.filename}</p>
                  <div className="flex items-center gap-1">
                    {(file.media_type === "image" ||
                      file.media_type === "video") && (
                      <button
                        type="button"
                        onClick={() => void handleSetCover(file.id)}
                        disabled={coverMediaId === file.id}
                        className="rounded-lg p-1.5 text-neutral-500 dark:text-neutral-400 hover:text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
                        aria-label={`Сделать обложкой ${file.filename}`}
                        title="Сделать обложкой"
                      >
                        <Star size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleDelete(file.id)}
                      className="rounded-lg p-1.5 text-neutral-500 dark:text-neutral-400 hover:text-red-400 hover:bg-red-500/10"
                      aria-label={`Удалить ${file.filename}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
