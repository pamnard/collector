import { useEffect, useState } from "react";
import type { TagWithCount } from "@collector/core";
import type { Tag } from "@collector/shared";
import {
  createTag,
  deleteTag,
  listTags,
  updateTagRecord,
} from "../../services/collector-service";

interface TagPickerProps {
  selectedTagIds: string[];
  onChange: (tagIds: string[]) => void;
}

export function TagPicker({ selectedTagIds, onChange }: TagPickerProps) {
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listTags()
      .then(setTags)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const toggleTag = (tagId: string) => {
    if (selectedTagIds.includes(tagId)) {
      onChange(selectedTagIds.filter((id) => id !== tagId));
      return;
    }
    onChange([...selectedTagIds, tagId]);
  };

  const handleCreateTag = async () => {
    const name = newTagName.trim();
    if (!name) {
      return;
    }

    setError(null);
    try {
      const tag: Tag = await createTag({ name });
      setTags((current) =>
        [...current, { ...tag, item_count: 0 }].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      onChange([...selectedTagIds, tag.id]);
      setNewTagName("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    if (!window.confirm("Удалить тег? Он будет снят со всех элементов.")) {
      return;
    }

    setError(null);
    try {
      await deleteTag(tagId);
      setTags((current) => current.filter((tag) => tag.id !== tagId));
      onChange(selectedTagIds.filter((id) => id !== tagId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRenameTag = async (tag: TagWithCount) => {
    const nextName = window.prompt("Новое имя тега", tag.name)?.trim();
    if (!nextName || nextName === tag.name) {
      return;
    }

    setError(null);
    try {
      const updated = await updateTagRecord(tag.id, { name: nextName });
      setTags((current) =>
        current
          .map((entry) =>
            entry.id === tag.id
              ? { ...entry, ...updated, item_count: entry.item_count }
              : entry,
          )
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Теги</p>

      {error && (
        <p className="text-red-400 text-sm">{error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => {
          const selected = selectedTagIds.includes(tag.id);
          return (
            <div key={tag.id} className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => toggleTag(tag.id)}
                className={`rounded-full px-3 py-1 text-sm border transition-colors ${
                  selected
                    ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-300"
                    : "border-border text-secondary hover:bg-input/65"
                }`}
                style={
                  tag.color
                    ? { borderColor: tag.color, color: tag.color }
                    : undefined
                }
              >
                {tag.name}
              </button>
              <button
                type="button"
                onClick={() => handleRenameTag(tag)}
                className="text-muted hover:text-secondary text-sm px-1"
                aria-label={`Переименовать ${tag.name}`}
              >
                ✎
              </button>
              <button
                type="button"
                onClick={() => handleDeleteTag(tag.id)}
                className="text-muted hover:text-red-400 text-sm px-1"
                aria-label={`Удалить ${tag.name}`}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={newTagName}
          onChange={(event) => setNewTagName(event.target.value)}
          placeholder="Новый тег"
          className="flex-1 rounded-lg border border-border bg-input/20 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={handleCreateTag}
          disabled={!newTagName.trim()}
          className="px-3 py-2 rounded-lg border border-border hover:bg-input/65 text-sm disabled:opacity-50"
        >
          Добавить
        </button>
      </div>
    </div>
  );
}
