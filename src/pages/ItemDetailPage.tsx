import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import type { ItemFile } from "@collector/shared";
import { getItemById } from "../services/collector-service";

export function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [item, setItem] = useState<ItemFile | null>(null);
  const [content, setContent] = useState<string | null>(null);
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
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [id]);

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-2 text-secondary hover:text-primary transition-colors"
      >
        <ArrowLeft size={18} />
        Назад
      </button>

      {error && (
        <pre className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400 whitespace-pre-wrap">
          {error}
        </pre>
      )}

      {item && (
        <article className="space-y-4">
          <header>
            <h1 className="text-2xl font-semibold">{item.title}</h1>
            {item.description && (
              <p className="text-secondary mt-2">{item.description}</p>
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
