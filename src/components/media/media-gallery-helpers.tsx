import { File, FileAudio } from "lucide-react";
import type { PlayableMediaKind } from "../../utils/local-media-playback";

export function isPlayableMediaType(
  mediaType: string,
): mediaType is PlayableMediaKind {
  return mediaType === "video" || mediaType === "audio";
}

export function fileTypeLabel(filename: string, mediaType: string): string {
  const ext = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".") + 1).toUpperCase()
    : mediaType.toUpperCase();
  return ext || mediaType.toUpperCase();
}

export function NonImageIcon({ mediaType }: { mediaType: string }) {
  if (mediaType === "audio") {
    return <FileAudio />;
  }
  return <File />;
}
