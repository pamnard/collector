import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Code, Copy, Eye, Form, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import type { ItemFile } from "@collector/shared";
import { Alert } from "../components/alerts/Alert";
import { AlertStack } from "../components/alerts/AlertStack";
import { MarkdownContent } from "../components/content/MarkdownContent";
import { ItemDetailHero } from "../components/items/ItemDetailHero";
import { ItemDetailInlineEditor } from "../components/items/ItemDetailInlineEditor";
import { ItemDetailMetadata } from "../components/items/ItemDetailMetadata";
import { ItemDetailSourceEditor } from "../components/items/ItemDetailSourceEditor";
import { MediaGallery } from "../components/media/MediaGallery";
import { useShell } from "../components/layout/AppLayout";
import type { ItemFormValues } from "../types/item";
import { getCollectorClient } from "../services/collector-client";

type ItemDetailMode = "view" | "form" | "source";

function toFormValues(
  item: ItemFile,
  content: string | null,
): ItemFormValues {
  return {
    title: item.title,
    description: item.description,
    url: item.url ?? "",
    content_type: item.content_type,
    content: content ?? "",
    tag_ids: item.tag_ids,
    folder_path: item.folder_path,
  };
}

function sameTagIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, index) => id === sortedB[index]);
}

function isFormDirty(
  form: ItemFormValues,
  item: ItemFile,
  content: string | null,
): boolean {
  return (
    form.title.trim() !== item.title ||
    form.description.trim() !== item.description ||
    (form.url.trim() || null) !== (item.url ?? null) ||
    form.content_type !== item.content_type ||
    form.content.trim() !== (content ?? "").trim() ||
    form.folder_path !== item.folder_path ||
    !sameTagIds(form.tag_ids, item.tag_ids)
  );
}

export function ItemDetailPage() {
  const params = useParams();
  const id = params["*"];
  const navigate = useNavigate();
  const { refreshVault } = useShell();
  const [item, setItem] = useState<ItemFile | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<ItemFormValues | null>(null);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [sourceBaseline, setSourceBaseline] = useState<string | null>(null);
  const [mode, setMode] = useState<ItemDetailMode>("view");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idCopyFeedback, setIdCopyFeedback] = useState<
    "copied" | "failed" | null
  >(null);
  const idCopyFeedbackTimer = useRef<number | null>(null);
  const isFormMode = mode === "form";
  const isSourceMode = mode === "source";
  const isSourceDirty =
    sourceText !== null &&
    sourceBaseline !== null &&
    sourceText !== sourceBaseline;

  const reloadItem = async (itemId: string) => {
    const { item: loadedItem, content: loadedContent } = await getCollectorClient().getItemById(itemId);
    setItem(loadedItem);
    setContent(loadedContent);
    setFormValues(toFormValues(loadedItem, loadedContent));
    return { item: loadedItem, content: loadedContent };
  };

  useEffect(() => {
    if (!id) {
      setError("Item id is missing");
      return;
    }

    reloadItem(id).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [id]);

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
      const updated = await getCollectorClient().updateItem(id, {
        title: formValues.title.trim(),
        description: formValues.description.trim(),
        url: formValues.url.trim() || null,
        content_type: formValues.content_type,
        content: formValues.content.trim() || null,
        tag_ids: formValues.tag_ids,
        folder_path: formValues.folder_path,
      });
      const updatedContent = formValues.content.trim() || null;
      setItem(updated);
      setContent(updatedContent);
      setFormValues(toFormValues(updated, updatedContent));
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
      const updated = await getCollectorClient().updateItemSource(id, sourceText);
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

  const handleDelete = async () => {
    if (!id || !window.confirm("Удалить элемент без возможности восстановления?")) {
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      await getCollectorClient().deleteItem(id);
      refreshVault();
      navigate("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
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
    if (!isFormDirty(formValues, item, content)) {
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
        isFormDirty(formValues, item, content)
      ) {
        const saved = await handleSave();
        if (!saved) {
          return;
        }
      }

      setIsSaving(true);
      setError(null);
      try {
        const raw = await getCollectorClient().getItemSource(id);
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

  const toolbar = (
    <div className="flex items-center justify-between gap-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 rounded-lg bg-input/80 px-3 py-2 text-sm text-secondary backdrop-blur-md transition-colors hover:text-primary"
      >
        <ArrowLeft size={20} />
        Назад
      </button>

      {item && (
        <div
          role="group"
          aria-label="Режим страницы"
          className="flex items-center rounded-lg bg-input/80 p-1 backdrop-blur-sm"
        >
          <button
            type="button"
            aria-label={
              idCopyFeedback === "copied"
                ? "Id скопирован"
                : idCopyFeedback === "failed"
                  ? "Не удалось скопировать id"
                  : "Скопировать id элемента"
            }
            title={
              idCopyFeedback === "copied"
                ? "Id скопирован"
                : idCopyFeedback === "failed"
                  ? "Не удалось скопировать id"
                  : "Скопировать id элемента"
            }
            className={`rounded-md p-1.5 transition-all ${
              idCopyFeedback === "copied"
                ? "text-primary"
                : idCopyFeedback === "failed"
                  ? "text-red-400"
                  : "text-secondary hover:text-primary"
            }`}
            onClick={() => void handleCopyItemId()}
          >
            {idCopyFeedback === "copied" ? (
              <Check size={18} />
            ) : (
              <Copy size={18} />
            )}
          </button>
          <button
            type="button"
            aria-label="Просмотр"
            aria-pressed={mode === "view"}
            title="Просмотр"
            className={`rounded-md p-1.5 transition-all ${
              mode === "view"
                ? "bg-header/70 text-primary shadow-sm"
                : "text-secondary hover:text-primary"
            }`}
            onClick={switchToView}
            disabled={isSaving}
          >
            <Eye size={18} />
          </button>
          <button
            type="button"
            aria-label="Редактирование формы"
            aria-pressed={mode === "form"}
            title="Редактирование формы"
            className={`rounded-md p-1.5 transition-all ${
              mode === "form"
                ? "bg-header/70 text-primary shadow-sm"
                : "text-secondary hover:text-primary"
            }`}
            onClick={switchToForm}
            disabled={isSaving}
          >
            <Form size={18} />
          </button>
          <button
            type="button"
            aria-label="Исходный текст"
            aria-pressed={mode === "source"}
            title="Исходный текст"
            className={`rounded-md p-1.5 transition-all ${
              mode === "source"
                ? "bg-header/70 text-primary shadow-sm"
                : "text-secondary hover:text-primary"
            }`}
            onClick={switchToSource}
            disabled={isSaving}
          >
            <Code size={18} />
          </button>
          <button
            type="button"
            aria-label="Удалить"
            title="Удалить"
            className="rounded-md p-1.5 text-red-400 transition-all hover:bg-red-500/10 hover:text-red-400"
            onClick={() => void handleDelete()}
            disabled={isDeleting || isSaving}
          >
            <Trash2 size={18} />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="@container w-full p-4 md:p-8">
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

      {!item && (
        <div className="mx-auto mb-4 w-full max-w-[900px]">{toolbar}</div>
      )}

      {item && (
        <article className="grid grid-cols-1 gap-6 @[1100px]:grid-cols-12 @[1100px]:items-start @[1100px]:gap-8">
          <div className="min-w-0 @[1100px]:col-span-9">
            <div className="mx-auto w-full max-w-[900px]">{toolbar}</div>
          </div>

          {mode === "view" && <ItemDetailHero item={item} />}

          <aside className="min-w-0 @[1100px]:col-span-3 @[1100px]:col-start-10 @[1100px]:row-span-6 @[1100px]:row-start-1">
            <div className="mx-auto w-full max-w-[900px] @[1100px]:max-w-none @[1100px]:sticky @[1100px]:top-4">
              <ItemDetailMetadata item={item} />
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

          <div className="min-w-0 @[1100px]:col-span-9">
            <div className="mx-auto w-full max-w-[900px]">
              <MediaGallery itemId={item.id} onUpdated={handleItemUpdated} />
            </div>
          </div>
        </article>
      )}
    </div>
  );
}
