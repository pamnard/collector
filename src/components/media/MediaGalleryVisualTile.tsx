import { Play, Star, Trash2 } from "lucide-react";
import type { MediaWithPath } from "@collector/core";
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
import { fileTypeLabel } from "./media-gallery-helpers";

interface MediaGalleryVisualTileProps {
  file: MediaWithPath;
  coverSrc: string | null;
  coverBusy: boolean;
  onSetCover: (mediaId: string) => void;
  onRequestDelete: (file: MediaWithPath) => void;
  onPlayMedia?: (file: MediaWithPath) => void;
}

export function MediaGalleryVisualTile({
  file,
  coverSrc,
  coverBusy,
  onSetCover,
  onRequestDelete,
  onPlayMedia,
}: MediaGalleryVisualTileProps) {
  const isVideo = file.media_type === "video";
  const src = toDisplayAssetSrc(file.absolute_path);

  return (
    <Attachment
      orientation="vertical"
      size="default"
      state="done"
      className="w-32! flex-col! flex-nowrap! items-stretch"
    >
      <AttachmentMedia variant="image" className="aspect-square w-full!">
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
          disabled={coverBusy}
          onClick={() => onSetCover(file.id)}
        >
          <Star />
        </AttachmentAction>
        <AttachmentAction
          aria-label={`Удалить ${file.filename}`}
          onClick={() => onRequestDelete(file)}
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
}
