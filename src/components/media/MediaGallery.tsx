import {
  File,
  FileAudio,
  ImagePlus,
  Play,
  Star,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaWithPath } from "@collector/core";
import type { ItemFile } from "@collector/shared";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { toDisplayAssetSrc } from "../../utils/asset-src";
import type { PlayableMediaKind } from "../../utils/local-media-playback";
import {
  getCollectorService,
  getUiSession,
} from "../../services/collector-client";

interface MediaGalleryProps {
  itemId: string;
  /** Item cover — poster for video tiles (`<video>` frames often stay blank). */
  item?: ItemFile;
  onUpdated?: () => void;
  onPlayMedia?: (file: MediaWithPath) => void;
}

function isPlayableMediaType(
  mediaType: string,
): mediaType is PlayableMediaKind {
  return mediaType === "video" || mediaType === "audio";
}

function fileTypeLabel(filename: string, mediaType: string): string {
  const ext = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".") + 1).toUpperCase()
    : mediaType.toUpperCase();
  return ext || mediaType.toUpperCase();
}

function NonImageIcon({ mediaType }: { mediaType: string }) {
  if (mediaType === "audio") {
    return <FileAudio />;
  }
  return <File />;
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

  const handleDelete = async (mediaId: string) => {
    if (!window.confirm("Удалить файл?")) {
      return;
    }

    setError(null);
    try {
      await getCollectorService().media.deleteItemMedia(itemId, mediaId);
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
      await getCollectorService().media.setItemCoverFromMedia(itemId, mediaId);
      onUpdated?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCoverMediaId(null);
    }
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
              {visualFiles.map((file) => {
                const isVideo = file.media_type === "video";
                const src = toDisplayAssetSrc(file.absolute_path);
                return (
                  <Attachment
                    key={file.id}
                    orientation="vertical"
                    size="default"
                    state="done"
                    className="w-32! flex-col! flex-nowrap! items-stretch"
                  >
                    <AttachmentMedia
                      variant="image"
                      className="aspect-square w-full!"
                    >
                      {isVideo ? (
                        <>
                          {coverSrc ? (
                            <img src={coverSrc} alt="" />
                          ) : (
                            <video
                              src={`${src}#t=0.1`}
                              muted
                              preload="metadata"
                              playsInline
                              aria-hidden
                            />
                          )}
                          <span className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
                            <span className="flex size-8 items-center justify-center rounded-full bg-black/65 text-white shadow-sm">
                              <Play
                                className="ml-px size-4 fill-current"
                                strokeWidth={0}
                              />
                            </span>
                          </span>
                        </>
                      ) : (
                        <img src={src} alt="" />
                      )}
                    </AttachmentMedia>
                    <AttachmentContent>
                      <AttachmentTitle>{file.filename}</AttachmentTitle>
                      <AttachmentDescription>
                        {fileTypeLabel(file.filename, file.media_type)}
                      </AttachmentDescription>
                    </AttachmentContent>
                    <AttachmentActions className="opacity-0 transition-opacity group-hover/attachment:opacity-100 group-focus-within/attachment:opacity-100">
                      <AttachmentAction
                        aria-label={`Сделать обложкой ${file.filename}`}
                        title="Сделать обложкой"
                        disabled={coverMediaId === file.id}
                        onClick={() => void handleSetCover(file.id)}
                      >
                        <Star />
                      </AttachmentAction>
                      <AttachmentAction
                        aria-label={`Удалить ${file.filename}`}
                        onClick={() => void handleDelete(file.id)}
                      >
                        <Trash2 />
                      </AttachmentAction>
                    </AttachmentActions>
                    {isVideo && onPlayMedia ? (
                      <AttachmentTrigger
                        aria-label={`Смотреть ${file.filename}`}
                        onClick={() => onPlayMedia(file)}
                      />
                    ) : null}
                  </Attachment>
                );
              })}
            </div>
          )}

          {listFiles.length > 0 && (
            <div className="flex flex-col gap-2">
              {listFiles.map((file) => {
                const playable =
                  isPlayableMediaType(file.media_type) && onPlayMedia;
                return (
                  <Attachment
                    key={file.id}
                    orientation="horizontal"
                    size="sm"
                    state="done"
                    className="w-full max-w-none"
                  >
                    <AttachmentMedia variant="icon">
                      <NonImageIcon mediaType={file.media_type} />
                    </AttachmentMedia>
                    <AttachmentContent>
                      <AttachmentTitle>{file.filename}</AttachmentTitle>
                      <AttachmentDescription>
                        {fileTypeLabel(file.filename, file.media_type)}
                      </AttachmentDescription>
                    </AttachmentContent>
                    <AttachmentActions>
                      <AttachmentAction
                        aria-label={`Удалить ${file.filename}`}
                        onClick={() => void handleDelete(file.id)}
                      >
                        <Trash2 />
                      </AttachmentAction>
                    </AttachmentActions>
                    {playable ? (
                      <AttachmentTrigger
                        aria-label={`Слушать ${file.filename}`}
                        onClick={() => onPlayMedia(file)}
                      />
                    ) : null}
                  </Attachment>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
