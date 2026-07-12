import { convertFileSrc } from "@tauri-apps/api/core";
import { ImagePlus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaWithPath } from "@collector/core";
import {
  attachMediaFiles,
  deleteItemMedia,
  listItemMedia,
} from "../../services/collector-service";

interface MediaGalleryProps {
  itemId: string;
  onUpdated?: () => void;
}

export function MediaGallery({ itemId, onUpdated }: MediaGalleryProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<MediaWithPath[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const loadMedia = useCallback(async () => {
    setError(null);
    try {
      setFiles(await listItemMedia(itemId));
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
      await attachMediaFiles(itemId, payload);
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
      await deleteItemMedia(itemId, mediaId);
      await loadMedia();
      onUpdated?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
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
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-input/40 disabled:opacity-50"
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
        <p className="text-secondary text-sm">Нет прикреплённых файлов.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {files.map((file) => (
            <div
              key={file.id}
              className="rounded-xl border border-border bg-card overflow-hidden"
            >
              {file.media_type === "image" ? (
                <img
                  src={convertFileSrc(file.absolute_path)}
                  alt={file.filename}
                  className="w-full h-40 object-cover bg-input/20"
                />
              ) : (
                <div className="h-40 flex items-center justify-center bg-input/20 text-secondary text-sm px-4 text-center">
                  {file.media_type}: {file.filename}
                </div>
              )}
              <div className="flex items-center justify-between gap-2 p-3">
                <p className="text-sm truncate">{file.filename}</p>
                <button
                  type="button"
                  onClick={() => handleDelete(file.id)}
                  className="rounded-lg p-1.5 text-secondary hover:text-red-400 hover:bg-red-500/10"
                  aria-label={`Удалить ${file.filename}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
