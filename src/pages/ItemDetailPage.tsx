import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ItemFile } from "@collector/shared";
import type { MediaWithPath } from "@collector/core";
import { Alert } from "../components/alerts/Alert";
import { AlertStack } from "../components/alerts/AlertStack";
import { MarkdownContent } from "../components/content/MarkdownContent";
import { ItemDetailHero } from "../components/items/ItemDetailHero";
import { ItemDetailInlineEditor } from "../components/items/ItemDetailInlineEditor";
import { ItemDetailMetadata } from "../components/items/ItemDetailMetadata";
import { ItemDetailSourceEditor } from "../components/items/ItemDetailSourceEditor";
import { MediaGallery } from "../components/media/MediaGallery";
import { MediaPlayerOverlay } from "../components/media/MediaPlayerOverlay";
import { useShell } from "../components/layout/AppLayout";
import { usePanelHeader } from "../components/layout/panel-header-context";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { useMediaPlayerOverlay } from "../hooks/useMediaPlayerOverlay";
import type { ItemFormValues } from "../types/item";
import { getCollectorService } from "../services/collector-client";
import type { PlayableMediaKind } from "../utils/local-media-playback";

type ItemDetailMode = "view" | "form" | "source";

function toFormValues(
  item: ItemFile,
  content: string | null,
  tagNames: string[],
): ItemFormValues {
  return {
    title: item.title,
    description: item.description,
    url: item.url ?? "",
    content_type: item.content_type,
    content: content ?? "",
    tags: tagNames,
    folder_path: item.folder_path,
  };
}

function sameTagNames(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].map((name) => name.trim().toLowerCase()).sort();
  const sortedB = [...b].map((name) => name.trim().toLowerCase()).sort();
  return sortedA.every((name, index) => name === sortedB[index]);
}

function isFormDirty(
  form: ItemFormValues,
  item: ItemFile,
  content: string | null,
  itemTagNames: string[],
): boolean {
  return (
    form.title.trim() !== item.title ||
    form.description.trim() !== item.description ||
    (form.url.trim() || null) !== (item.url ?? null) ||
    form.content_type !== item.content_type ||
    form.content.trim() !== (content ?? "").trim() ||
    form.folder_path !== item.folder_path ||
    !sameTagNames(form.tags, itemTagNames)
  );
}

export function ItemDetailPage() {
  const params = useParams();
  const id = params["*"];
  const navigate = useNavigate();
  const { refreshVault } = useShell();
  const { setItemHeader, setItemActions, setItemAdjacent } = usePanelHeader();
  const [item, setItem] = useState<ItemFile | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<ItemFormValues | null>(null);
  const [itemTagNames, setItemTagNames] = useState<string[]>([]);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [sourceBaseline, setSourceBaseline] = useState<string | null>(null);
  const [mode, setMode] = useState<ItemDetailMode>("view");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idCopyFeedback, setIdCopyFeedback] = useState<
    "copied" | "failed" | null
  >(null);
  const [mediaPlayError, setMediaPlayError] = useState<string | null>(null);
  const idCopyFeedbackTimer = useRef<number | null>(null);
  const {
    session: mediaPlayerSession,
    openItemMedia,
    openMediaRef,
    close: closeMediaPlayer,
  } = useMediaPlayerOverlay();
  const isFormMode = mode === "form";
  const isSourceMode = mode === "source";
  const isSourceDirty =
    sourceText !== null &&
    sourceBaseline !== null &&
    sourceText !== sourceBaseline;

  const handlePlayHeroVideo = useCallback(() => {
    if (!item) {
      return;
    }
    setMediaPlayError(null);
    void openItemMedia(item.id, "video").catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
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

  const resolveTagNames = async (loaded: ItemFile): Promise<string[]> => {
    if (loaded.tag_ids.length === 0) {
      return [];
    }
    const allTags = await getCollectorService().tags.listTags();
    const byId = new Map(allTags.map((tag) => [tag.id, tag.name]));
    return loaded.tag_ids
      .map((tagId) => byId.get(tagId))
      .filter((name): name is string => typeof name === "string");
  };

  const reloadItem = async (itemId: string) => {
    const { item: loadedItem, content: loadedContent } =
      await getCollectorService().items.getItemById(itemId);
    const tagNames = await resolveTagNames(loadedItem);
    setItem(loadedItem);
    setContent(loadedContent);
    setItemTagNames(tagNames);
    setFormValues(toFormValues(loadedItem, loadedContent, tagNames));
    return { item: loadedItem, content: loadedContent };
  };

  useEffect(() => {
    setItemHeader({ status: "loading" });
    return () => {
      setItemHeader(null);
      setItemActions(null);
      setItemAdjacent(null);
    };
  }, [setItemHeader, setItemActions, setItemAdjacent]);

  useEffect(() => {
    if (item) {
      setItemHeader({
        status: "ready",
        folderPath: item.folder_path,
        title: item.title,
      });
      return;
    }
    if (error) {
      setItemHeader({
        status: "ready",
        folderPath: "",
        title: "",
      });
    }
  }, [item, error, setItemHeader]);

  useEffect(() => {
    if (!id) {
      setError("Item id is missing");
      return;
    }

    setItem(null);
    setItemAdjacent(null);
    setError(null);
    setItemHeader({ status: "loading" });

    reloadItem(id).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [id, setItemHeader, setItemAdjacent]);

  useEffect(() => {
    if (!id || mode !== "view") {
      setItemAdjacent(null);
      return;
    }
    let cancelled = false;
    setItemAdjacent(null);
    void getCollectorService().items
      .getAdjacentItems(id)
      .then((result) => {
        if (!cancelled) {
          setItemAdjacent(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setItemAdjacent(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, mode, setItemAdjacent]);

  const handleSave = async (): Promise<boolean> => {
    if (!id || !formValues) {
      return false;
    }
    if (!formValues.title.trim()) {
      setError("Название обязательно");
      return false;
    }

    setIsSaving(true);
    setError(null);

    try {
      const updated = await getCollectorService().items.updateItem(id, {
        title: formValues.title.trim(),
        description: formValues.description.trim(),
        url: formValues.url.trim() || null,
        content_type: formValues.content_type,
        content: formValues.content.trim() || null,
        tags: formValues.tags,
        folder_path: formValues.folder_path,
      });
      const updatedContent = formValues.content.trim() || null;
      const tagNames = await resolveTagNames(updated);
      setItem(updated);
      setContent(updatedContent);
      setItemTagNames(tagNames);
      setFormValues(toFormValues(updated, updatedContent, tagNames));
      setMode("view");
      refreshVault();
      if (updated.id !== id) {
        navigate(`/item/${updated.id}`, { replace: true });
      }
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSourceSave = async (): Promise<boolean> => {
    if (!id || sourceText === null) {
      return false;
    }

    setIsSaving(true);
    setError(null);

    try {
      const updated = await getCollectorService().items.updateItemSource(id, sourceText);
      await reloadItem(updated.id);
      setSourceText(null);
      setSourceBaseline(null);
      setMode("view");
      refreshVault();
      if (updated.id !== id) {
        navigate(`/item/${updated.id}`, { replace: true });
      }
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!id) {
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      await getCollectorService().items.deleteItem(id);
      refreshVault();
      navigate("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setIsDeleting(false);
    }
  };

  const clearSource = () => {
    setSourceText(null);
    setSourceBaseline(null);
  };

  const switchToView = () => {
    if (mode === "view" || isSaving) {
      return;
    }
    if (mode === "source") {
      if (!isSourceDirty) {
        clearSource();
        setMode("view");
        setError(null);
        return;
      }
      void handleSourceSave();
      return;
    }
    if (!formValues || !item) {
      setMode("view");
      return;
    }
    if (!isFormDirty(formValues, item, content, itemTagNames)) {
      setMode("view");
      setError(null);
      return;
    }
    void handleSave();
  };

  const switchToForm = () => {
    if (isSaving) {
      return;
    }

    const enter = async () => {
      if (mode === "source" && isSourceDirty) {
        const saved = await handleSourceSave();
        if (!saved) {
          return;
        }
      } else if (mode === "source") {
        clearSource();
      }
      setMode("form");
      setError(null);
    };

    void enter();
  };

  const switchToSource = () => {
    if (!id || isSaving) {
      return;
    }

    const enter = async () => {
      if (
        mode === "form" &&
        formValues &&
        item &&
        isFormDirty(formValues, item, content, itemTagNames)
      ) {
        const saved = await handleSave();
        if (!saved) {
          return;
        }
      }

      setIsSaving(true);
      setError(null);
      try {
        const raw = await getCollectorService().items.getItemSource(id);
        setSourceText(raw);
        setSourceBaseline(raw);
        setMode("source");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsSaving(false);
      }
    };

    void enter();
  };

  const handleItemUpdated = () => {
    if (!item) {
      return;
    }

    void reloadItem(item.id).finally(() => refreshVault());
  };

  useEffect(() => {
    return () => {
      if (idCopyFeedbackTimer.current !== null) {
        window.clearTimeout(idCopyFeedbackTimer.current);
      }
    };
  }, []);

  const showIdCopyFeedback = (next: "copied" | "failed") => {
    if (idCopyFeedbackTimer.current !== null) {
      window.clearTimeout(idCopyFeedbackTimer.current);
    }
    setIdCopyFeedback(next);
    idCopyFeedbackTimer.current = window.setTimeout(() => {
      setIdCopyFeedback(null);
      idCopyFeedbackTimer.current = null;
    }, 2000);
  };

  const handleCopyItemId = async () => {
    if (!item) {
      return;
    }

    try {
      await navigator.clipboard.writeText(item.id);
      showIdCopyFeedback("copied");
    } catch (err: unknown) {
      console.error("Item id copy failed", { error: err, itemId: item.id });
      showIdCopyFeedback("failed");
    }
  };

  useEffect(() => {
    setItemActions({
      mode,
      idCopyFeedback,
      isSaving,
      isDeleting,
      ready: item !== null,
      onCopyId: () => {
        void handleCopyItemId();
      },
      onView: switchToView,
      onForm: switchToForm,
      onSource: switchToSource,
      onDelete: () => {
        setDeleteConfirmOpen(true);
      },
    });
  }, [
    mode,
    idCopyFeedback,
    isSaving,
    isDeleting,
    item,
    setItemActions,
  ]);

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

      {idCopyFeedback !== null && (
        <AlertStack>
          <Alert
            tone={idCopyFeedback === "failed" ? "danger" : "info"}
            onDismiss={() => {
              if (idCopyFeedbackTimer.current !== null) {
                window.clearTimeout(idCopyFeedbackTimer.current);
                idCopyFeedbackTimer.current = null;
              }
              setIdCopyFeedback(null);
            }}
          >
            {idCopyFeedback === "failed"
              ? "Не удалось скопировать id"
              : "Id скопирован"}
          </Alert>
        </AlertStack>
      )}

      {error && (
        <pre className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400 whitespace-pre-wrap">
          {error}
        </pre>
      )}

      {item && (
        <article className="grid grid-cols-1 gap-6 @[1100px]:grid-cols-12 @[1100px]:items-start @[1100px]:gap-8">
          {mode === "view" && (
            <ItemDetailHero
              item={item}
              onPlayLocalVideo={handlePlayHeroVideo}
              playError={mediaPlayError}
            />
          )}

          <aside className="min-w-0 @[1100px]:col-span-3 @[1100px]:col-start-10 @[1100px]:row-span-6 @[1100px]:row-start-1">
            <div className="mx-auto w-full max-w-[900px] @[1100px]:max-w-none @[1100px]:sticky @[1100px]:top-4">
              <ItemDetailMetadata item={item} />
              <MediaGallery
                itemId={item.id}
                item={item}
                onUpdated={handleItemUpdated}
                onPlayMedia={handlePlayGalleryMedia}
              />
            </div>
          </aside>

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
          ) : (
            <>
              <header className="min-w-0 @[1100px]:col-span-9">
                <div className="mx-auto w-full max-w-[900px]">
                  <h1 className="text-2xl font-semibold">{item.title}</h1>
                </div>
              </header>

              {content && (
                <section className="min-w-0 @[1100px]:col-span-9">
                  <div className="mx-auto w-full max-w-[900px]">
                    <MarkdownContent content={content} />
                  </div>
                </section>
              )}
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
