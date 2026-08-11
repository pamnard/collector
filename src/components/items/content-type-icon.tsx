import {
  FileText,
  Image as ImageIcon,
  Link as LinkIcon,
  Music,
  Video,
} from "lucide-react";

/** Shared content-type glyph for grid cards and related teaser meta. */
export function ContentTypeIcon({
  type,
  size = 16,
}: {
  type: string;
  size?: number;
}) {
  switch (type) {
    case "image":
      return <ImageIcon size={size} />;
    case "video":
      return <Video size={size} />;
    case "audio":
      return <Music size={size} />;
    case "article":
    case "pdf":
    case "document":
      return <FileText size={size} />;
    default:
      return <LinkIcon size={size} />;
  }
}

export function contentTypeAccentClass(type: string): string {
  return type === "image" ? "text-purple-400" : "text-indigo-400";
}
