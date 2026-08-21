import type { ItemFile } from "@collector/shared";
import { getYouTubeThumbnail } from "./youtube-thumbnail";

export type PlayableMediaKind = "video" | "audio";

export interface PlayableMediaRef {
  path: string;
  kind: PlayableMediaKind;
}

/**
 * Remote YouTube URL → no in-app overlay player.
 * Same host-scoped rules as `getYouTubeThumbnail`.
 */
export function isYouTubeItemUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }
  return getYouTubeThumbnail(url) !== null;
}

export function pickPlayableMedia(
  files: ReadonlyArray<{ media_type: string; absolute_path: string }>,
  prefer?: PlayableMediaKind,
): PlayableMediaRef | null {
  const find = (kind: PlayableMediaKind) =>
    files.find((file) => file.media_type === kind);

  if (prefer) {
    const preferred = find(prefer);
    if (preferred) {
      return { path: preferred.absolute_path, kind: prefer };
    }
  }

  const video = find("video");
  if (video) {
    return { path: video.absolute_path, kind: "video" };
  }

  const audio = find("audio");
  if (audio) {
    return { path: audio.absolute_path, kind: "audio" };
  }

  return null;
}
