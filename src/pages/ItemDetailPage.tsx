import { useCallback, useMemo, useState } from "react";
import type { MediaWithPath } from "@collector/core";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../components/alerts/AlertBusProvider";
import { ItemDetailAside } from "../components/items/ItemDetailAside";
import { ItemDetailInlineEditor } from "../components/items/ItemDetailInlineEditor";
import { ItemDetailSourceEditor } from "../components/items/ItemDetailSourceEditor";
import { ItemDetailViewBody } from "../components/items/ItemDetailViewBody";
import { ItemRenameDialog } from "../components/items/ItemRenameDialog";
import { MediaPlayerOverlay } from "../components/media/MediaPlayerOverlay";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { useItemDetail } from "../hooks/useItemDetail";
import { useItemDetailChrome } from "../hooks/useItemDetailChrome";
import { useMediaPlayerOverlay } from "../hooks/useMediaPlayerOverlay";
import {
  ITEM_RENAME_BUSY_ID,
  ITEM_RENAME_ERROR_ID,
  renameItemTitle,
} from "../lib/item-actions";
import { articleTocForView } from "../lib/markdown/article-toc";
import { errorMessage } from "../services/runtime-error";
import type { PlayableMediaKind } from "../utils/local-media-playback";

export function ItemDetailPage() {
  const detail = useItemDetail();
  const {
    item,
    content,
    formValues,
    setFormValues,
    sourceText,
    setSourceText,
    mode,
    isFormMode,
    isSourceMode,
    isSaving,
    isDeleting,
    error,
    switchToView,
    switchToForm,
    switchToSource,
    handleConfirmDelete,
    handleItemUpdated,
  } = detail;

  const {
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    renameOpen,
    setRenameOpen,
  } = useItemDetailChrome({
    item,
    error,
    mode,
    isSaving,
    isDeleting,
    onView: switchToView,
    onForm: switchToForm,
    onSource: switchToSource,
  });

  const alerts = useAlerts();
  useDismissAlertsOnUnmount([ITEM_RENAME_BUSY_ID, ITEM_RENAME_ERROR_ID]);
  const [isRenaming, setIsRenaming] = useState(false);
  const [mediaPlayError, setMediaPlayError] = useState<string | null>(null);
  const {
    session: mediaPlayerSession,
    openItemMedia,
    openMediaRef,
    close: closeMediaPlayer,
  } = useMediaPlayerOverlay();

  const handleConfirmRename = useCallback(
    async (nextTitle: string) => {
      if (!item) {
        return;
      }
      setIsRenaming(true);
      const updated = await renameItemTitle(alerts, item.id, nextTitle);
      setIsRenaming(false);
      if (updated === undefined) {
        return;
      }
      setRenameOpen(false);
      handleItemUpdated();
    },
    [alerts, handleItemUpdated, item, setRenameOpen],
  );

  const handlePlayHeroVideo = useCallback(() => {
    if (!item) {
      return;
    }
    setMediaPlayError(null);
    void openItemMedia(item.id, "video").catch((err: unknown) => {
      const message = errorMessage(err);
      console.error("[ItemDetailPage] hero video open failed", {
        itemId: item.id,
        message,
      });
      setMediaPlayError(message);
    });
  }, [item, openItemMedia]);

  const handlePlayGalleryMedia = useCallback(
    (file: MediaWithPath) => {
      if (file.media_type !== "video" && file.media_type !== "audio") {
        throw new Error(`Media is not playable: ${file.media_type}`);
      }
      setMediaPlayError(null);
      openMediaRef(
        {
          path: file.absolute_path,
          kind: file.media_type as PlayableMediaKind,
        },
        file.filename,
      );
    },
    [openMediaRef],
  );

  const tocItems = useMemo(
    () => articleTocForView(mode, content),
    [mode, content],
  );

  const aside = item ? (
    <ItemDetailAside
      item={item}
      onUpdated={handleItemUpdated}
      onPlayMedia={handlePlayGalleryMedia}
      tocItems={tocItems}
    />
  ) : null;

  return (
    <div className="@container w-full pb-4 md:pb-8">
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={item?.title.trim() || "Элемент"}
        description="Удалить элемент без возможности восстановления?"
        busy={isDeleting}
        onConfirm={handleConfirmDelete}
      />

      <ItemRenameDialog
        open={renameOpen}
        currentTitle={item?.title ?? ""}
        busy={isRenaming}
        onOpenChange={setRenameOpen}
        onConfirm={(nextTitle) => {
          void handleConfirmRename(nextTitle);
        }}
      />

      {item && (
        <article className="grid grid-cols-1 gap-6 @[1100px]:grid-cols-12 @[1100px]:items-start @[1100px]:gap-8">
          {mode === "view" ? (
            <ItemDetailViewBody
              item={item}
              content={content}
              aside={aside}
              onPlayLocalVideo={handlePlayHeroVideo}
              playError={mediaPlayError}
            />
          ) : (
            <>
              {isFormMode && formValues ? (
                <div className="min-w-0 @[1100px]:col-span-9">
                  <div className="mx-auto w-full max-w-[900px]">
                    <ItemDetailInlineEditor
                      values={formValues}
                      onChange={setFormValues}
                    />
                  </div>
                </div>
              ) : isSourceMode && sourceText !== null ? (
                <div className="min-w-0 @[1100px]:col-span-9">
                  <div className="mx-auto w-full max-w-[900px]">
                    <ItemDetailSourceEditor
                      value={sourceText}
                      onChange={setSourceText}
                    />
                  </div>
                </div>
              ) : null}
              {aside}
            </>
          )}
        </article>
      )}

      {mediaPlayerSession && (
        <MediaPlayerOverlay
          src={mediaPlayerSession.src}
          kind={mediaPlayerSession.kind}
          title={mediaPlayerSession.title}
          onClose={closeMediaPlayer}
        />
      )}
    </div>
  );
}
