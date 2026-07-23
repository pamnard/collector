import type { ItemFile } from "@collector/shared";

export type PlayableMediaKind = "video" | "audio";

export interface PlayableMediaRef {
  path: string;
  kind: PlayableMediaKind;
}

/**
 * Remote YouTube URL → no in-app overlay player.
 * Mirrors `getYouTubeThumbnail` id extraction (non-null id ⇒ YouTube).
 */
export function isYouTubeItemUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }
  const regExp =
    /^.*(?:(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/|shorts\/)|(?:(?:watch)?\?v(?:i)?=|&v(?:i)?=))([^#&?]*).*/;
  const match = url.match(regExp);
  return Boolean(match?.[1]);
}

/**
 * Local vault video item (detail hero play affordance).
 * YouTube / remote bookmark items stay on external-link behavior.
 */
export function isLocalVideoItem(
  item: Pick<ItemFile, "content_type" | "url">,
): boolean {
  return item.content_type === "video" && !isYouTubeItemUrl(item.url);
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
