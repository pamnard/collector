import { useEffect, useState } from "react";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import type { ItemFile } from "@collector/shared";
import { ItemForm } from "../components/items/ItemForm";
import { TagPicker } from "../components/tags/TagPicker";
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
  };
}

export function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { refreshVault } = useShell();
  const [item, setItem] = useState<ItemFile | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<ItemFormValues | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError("Item id is missing");
      return;
    }

    getItemById(id)
      .then(({ item: loadedItem, content: loadedContent }) => {
        setItem(loadedItem);
        setContent(loadedContent);
        setFormValues(toFormValues(loadedItem, loadedContent));
        setIsEditing(false);
      })
      .catch((err: unknown) => {
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
      });
      const updatedContent = formValues.content.trim() || null;
      setItem(updated);
      setContent(updatedContent);
      setFormValues(toFormValues(updated, updatedContent));
      setIsEditing(false);
      refreshVault();
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

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-secondary hover:text-primary transition-colors"
        >
          <ArrowLeft size={18} />
          Назад
        </button>

        {item && !isEditing && (
          <div className="flex items-center gap-2">
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
              onClick={handleDelete}
              disabled={isDeleting}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors text-sm disabled:opacity-50"
            >
              <Trash2 size={16} />
              {isDeleting ? "Удаление…" : "Удалить"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <pre className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400 whitespace-pre-wrap">
          {error}
        </pre>
      )}

      {item && isEditing && formValues && (
        <div className="space-y-4">
          <ItemForm
            values={formValues}
            onChange={setFormValues}
            showFlags
          />

          <TagPicker
            selectedTagIds={formValues.tag_ids}
            onChange={(tag_ids) =>
              setFormValues((current) =>
                current ? { ...current, tag_ids } : current,
              )
            }
          />

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleCancelEdit}
              disabled={isSaving}
              className="px-4 py-2 rounded-lg border border-border hover:bg-input/40 transition-colors text-sm"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !formValues.title.trim()}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors text-sm disabled:opacity-50"
            >
              {isSaving ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        </div>
      )}

      {item && !isEditing && (
        <article className="space-y-4">
          <header>
            <h1 className="text-2xl font-semibold">{item.title}</h1>
            {item.description && (
              <p className="text-secondary mt-2">{item.description}</p>
            )}
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-400 text-sm mt-2 inline-block break-all hover:underline"
              >
                {item.url}
              </a>
            )}
            <div className="flex flex-wrap gap-2 mt-3 text-xs text-muted">
              <span className="rounded-full bg-input px-2 py-1">
                {item.content_type}
              </span>
              {item.is_favorite && (
                <span className="rounded-full bg-input px-2 py-1">
                  избранное
                </span>
              )}
              {item.is_archived && (
                <span className="rounded-full bg-input px-2 py-1">архив</span>
              )}
            </div>
          </header>

          {content && (
            <pre className="rounded-xl border border-border bg-card p-4 whitespace-pre-wrap text-sm leading-relaxed">
              {content}
            </pre>
          )}
        </article>
      )}
    </div>
  );
}
