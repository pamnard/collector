import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaWithPath } from "@collector/core";
import type { ItemFile } from "@collector/shared";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../alerts/AlertBusProvider";
import { errorMessage } from "../alerts/alert-store";
import { toDisplayAssetSrc } from "../../utils/asset-src";
import {
  getCollectorService,
  getUiSession,
} from "../../services/collector-client";
import { partitionMediaFiles } from "./partition-media-files";

export const MEDIA_GALLERY_ERROR_ID = "media-gallery-error";

export function useMediaGallery(args: {
  itemId: string;
  item?: ItemFile;
  onUpdated?: () => void;
}) {
  const { itemId, item, onUpdated } = args;
  const alerts = useAlerts();
  useDismissAlertsOnUnmount([MEDIA_GALLERY_ERROR_ID]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<MediaWithPath[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [coverMediaId, setCoverMediaId] = useState<string | null>(null);
  const [coverSrc, setCoverSrc] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    filename: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadMedia = useCallback(async () => {
    alerts.dismiss(MEDIA_GALLERY_ERROR_ID);
    try {
      setFiles(await getCollectorService().media.listItemMedia(itemId));
    } catch (err: unknown) {
      alerts.upsert(MEDIA_GALLERY_ERROR_ID, {
        tone: "danger",
        message: errorMessage(err),
      });
    }
  }, [alerts, itemId]);

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

  const { visualFiles, listFiles } = useMemo(
    () => partitionMediaFiles(files),
    [files],
  );

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files;
    if (!selected?.length) {
      return;
    }

    setIsUploading(true);
    alerts.dismiss(MEDIA_GALLERY_ERROR_ID);
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
      alerts.upsert(MEDIA_GALLERY_ERROR_ID, {
        tone: "danger",
        message: errorMessage(err),
      });
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) {
      return;
    }

    setIsDeleting(true);
    alerts.dismiss(MEDIA_GALLERY_ERROR_ID);
    try {
      await getCollectorService().media.deleteItemMedia(
        itemId,
        pendingDelete.id,
      );
      await loadMedia();
      onUpdated?.();
    } catch (err: unknown) {
      alerts.upsert(MEDIA_GALLERY_ERROR_ID, {
        tone: "danger",
        message: errorMessage(err),
      });
      throw err;
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSetCover = async (mediaId: string) => {
    setCoverMediaId(mediaId);
    alerts.dismiss(MEDIA_GALLERY_ERROR_ID);
    try {
      await getCollectorService().media.setItemCoverFromMedia(itemId, mediaId);
      onUpdated?.();
    } catch (err: unknown) {
      alerts.upsert(MEDIA_GALLERY_ERROR_ID, {
        tone: "danger",
        message: errorMessage(err),
      });
    } finally {
      setCoverMediaId(null);
    }
  };

  const requestDelete = (file: MediaWithPath) => {
    setPendingDelete({ id: file.id, filename: file.filename });
  };

  return {
    inputRef,
    files,
    isUploading,
    coverMediaId,
    coverSrc,
    pendingDelete,
    setPendingDelete,
    isDeleting,
    visualFiles,
    listFiles,
    handleUpload,
    handleConfirmDelete,
    handleSetCover,
    requestDelete,
  };
}
