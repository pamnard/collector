import { useEffect, useState } from "react";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import type { ItemFile } from "@collector/shared";
import { MarkdownContent } from "../components/content/MarkdownContent";
import { ItemDetailHero } from "../components/items/ItemDetailHero";
import { ItemDetailInlineEditor } from "../components/items/ItemDetailInlineEditor";
import { ItemDetailMetadata } from "../components/items/ItemDetailMetadata";
import { ItemFlagActions } from "../components/items/ItemFlagActions";
import { MediaGallery } from "../components/media/MediaGallery";
import { useShell } from "../components/layout/AppLayout";
import {
  deleteItem,
  getItemById,
  updateItem,
} from "../services/collector-service";
import type { ItemFormValues } from "../types/item";

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
    is_favorite: item.is_favorite,
    is_archived: item.is_archived,
    tag_ids: item.tag_ids,
    folder_path: item.folder_path,
  };
}

export function ItemDetailPage() {
  const params = useParams();
  const id = params["*"];
  const navigate = useNavigate();
  const { refreshVault } = useShell();
  const [item, setItem] = useState<ItemFile | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<ItemFormValues | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadItem = async (itemId: string) => {
    const { item: loadedItem, content: loadedContent } = await getItemById(itemId);
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

  const handleSave = async () => {
    if (!id || !formValues || !formValues.title.trim()) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const updated = await updateItem(id, {
        title: formValues.title.trim(),
        description: formValues.description.trim(),
        url: formValues.url.trim() || null,
        content_type: formValues.content_type,
        content: formValues.content.trim() || null,
        is_favorite: formValues.is_favorite,
        is_archived: formValues.is_archived,
        tag_ids: formValues.tag_ids,
        folder_path: formValues.folder_path,
      });
      const updatedContent = formValues.content.trim() || null;
      setItem(updated);
      setContent(updatedContent);
      setFormValues(toFormValues(updated, updatedContent));
      setIsEditing(false);
      refreshVault();
      if (updated.id !== id) {
        navigate(`/item/${updated.id}`, { replace: true });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
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
      await deleteItem(id);
      refreshVault();
      navigate("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancelEdit = () => {
    if (item) {
      setFormValues(toFormValues(item, content));
    }
    setIsEditing(false);
    setError(null);
  };

  const handleItemUpdated = () => {
    if (!item) {
      return;
    }

    void reloadItem(item.id).finally(() => refreshVault());
  };

  const toolbar = (
    <div className="flex items-center justify-between gap-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-secondary hover:text-primary transition-colors"
      >
        <ArrowLeft size={18} />
        Назад
      </button>

      {item && isEditing && formValues && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCancelEdit}
            disabled={isSaving}
            className="px-3 py-1.5 rounded-lg border border-border hover:bg-input/40 transition-colors text-sm"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || !formValues.title.trim()}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors text-sm disabled:opacity-50"
          >
            {isSaving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      )}

      {item && !isEditing && (
        <div className="flex items-center gap-2">
          <ItemFlagActions
            itemId={item.id}
            isFavorite={item.is_favorite}
            isArchived={item.is_archived}
            onUpdated={handleItemUpdated}
          />
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border hover:bg-input/40 transition-colors text-sm"
          >
            <Pencil size={16} />
            Редактировать
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={isDeleting}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors text-sm disabled:opacity-50"
          >
            <Trash2 size={16} />
            {isDeleting ? "Удаление…" : "Удалить"}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="@container w-full p-4 md:p-8">
      {error && (
        <pre className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400 whitespace-pre-wrap">
          {error}
        </pre>
      )}

      {(!item || isEditing) && (
        <div className="mx-auto mb-4 w-full max-w-[900px]">{toolbar}</div>
      )}

      {item && isEditing && formValues && (
        <div className="mx-auto w-full max-w-[900px]">
          <ItemDetailInlineEditor values={formValues} onChange={setFormValues} />
        </div>
      )}

      {item && !isEditing && (
        <article className="grid grid-cols-1 gap-6 @[1100px]:grid-cols-12 @[1100px]:items-start @[1100px]:gap-8">
          <div className="min-w-0 @[1100px]:col-span-9">
            <div className="mx-auto w-full max-w-[900px]">{toolbar}</div>
          </div>

          <ItemDetailHero item={item} />

          <header className="min-w-0 @[1100px]:col-span-9">
            <div className="mx-auto w-full max-w-[900px]">
              <h1 className="text-2xl font-semibold">{item.title}</h1>
            </div>
          </header>

          <aside className="min-w-0 @[1100px]:col-span-3 @[1100px]:col-start-10 @[1100px]:row-span-6 @[1100px]:row-start-1">
            <div className="mx-auto w-full max-w-[900px] @[1100px]:max-w-none @[1100px]:sticky @[1100px]:top-4">
              <ItemDetailMetadata item={item} />
            </div>
          </aside>

          {content && (
            <section className="min-w-0 @[1100px]:col-span-9">
              <div className="mx-auto w-full max-w-[900px] rounded-xl border border-border bg-card p-4 md:p-6">
                <MarkdownContent content={content} />
              </div>
            </section>
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
