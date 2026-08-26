import { useCallback, useState } from "react";
import { toDisplayAssetSrc } from "../utils/asset-src";
import {
  pickPlayableMedia,
  type OverlayMediaKind,
  type PlayableMediaKind,
  type PlayableMediaRef,
} from "../utils/local-media-playback";
import { getCollectorService } from "../services/collector-client";

export interface MediaPlayerSession {
  src: string;
  kind: OverlayMediaKind;
  title?: string;
}

/**
 * Shared entry for detail hero / gallery → one overlay session.
 * Render `MediaPlayerOverlay` from `session` at the call site.
 */
export function useMediaPlayerOverlay() {
  const [session, setSession] = useState<MediaPlayerSession | null>(null);

  const close = useCallback(() => {
    setSession(null);
  }, []);

  const openPath = useCallback(
    (path: string, kind: OverlayMediaKind, title?: string) => {
      setSession({
        src: kind === "image" ? path : toDisplayAssetSrc(path),
        kind,
        title,
      });
    },
    [],
  );

  const openImageSrc = useCallback(
    (src: string, title?: string) => {
      if (!src.trim()) {
        return;
      }
      setSession({ src, kind: "image", title });
    },
    [],
  );

  const openMediaRef = useCallback(
    (ref: PlayableMediaRef, title?: string) => {
      openPath(ref.path, ref.kind, title);
    },
    [openPath],
  );

  const openItemMedia = useCallback(
    async (itemId: string, prefer?: PlayableMediaKind) => {
      const files = await getCollectorService().media.listItemMedia(itemId);
      const picked = pickPlayableMedia(files, prefer);
      if (!picked) {
        throw new Error(
          prefer
            ? `No local ${prefer} file attached to item ${itemId}`
            : `No local video/audio file attached to item ${itemId}`,
        );
      }
      const match = files.find(
        (file) =>
          file.absolute_path === picked.path && file.media_type === picked.kind,
      );
      openMediaRef(picked, match?.filename);
    },
    [openMediaRef],
  );

  return {
    session,
    openPath,
    openImageSrc,
    openMediaRef,
    openItemMedia,
    close,
    isOpen: session !== null,
  };
}
