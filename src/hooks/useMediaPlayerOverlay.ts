import { useCallback, useState } from "react";
import { toDisplayAssetSrc } from "../utils/asset-src";
import {
  pickPlayableMedia,
  type PlayableMediaKind,
  type PlayableMediaRef,
} from "../utils/local-media-playback";
import { getCollectorClient } from "../services/collector-client";

export interface MediaPlayerSession {
  src: string;
  kind: PlayableMediaKind;
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
    (path: string, kind: PlayableMediaKind, title?: string) => {
      setSession({
        src: toDisplayAssetSrc(path),
        kind,
        title,
      });
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
      const files = await getCollectorClient().listItemMedia(itemId);
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
    openMediaRef,
    openItemMedia,
    close,
    isOpen: session !== null,
  };
}
