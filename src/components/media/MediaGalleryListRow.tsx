import { Trash2 } from "lucide-react";
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
import {
  fileTypeLabel,
  isPlayableMediaType,
  NonImageIcon,
} from "./media-gallery-helpers";

interface MediaGalleryListRowProps {
  file: MediaWithPath;
  onRequestDelete: (file: MediaWithPath) => void;
  onPlayMedia?: (file: MediaWithPath) => void;
}

export function MediaGalleryListRow({
  file,
  onRequestDelete,
  onPlayMedia,
}: MediaGalleryListRowProps) {
  const playable = isPlayableMediaType(file.media_type) && onPlayMedia;

  return (
    <Attachment
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
          onClick={() => onRequestDelete(file)}
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
}
