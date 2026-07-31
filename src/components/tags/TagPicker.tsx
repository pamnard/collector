import { useEffect, useMemo, useState } from "react";
import type { TagWithCount } from "@collector/core";
import { getCollectorService } from "../../services/collector-client";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { TagPickerChip } from "./TagPickerChip";
import { TagRenameDialog } from "./TagRenameDialog";

interface TagPickerProps {
  selectedTagNames: string[];
  onChange: (tagNames: string[]) => void;
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function TagPicker({ selectedTagNames, onChange }: TagPickerProps) {
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TagWithCount | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pendingRename, setPendingRename] = useState<TagWithCount | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  useEffect(() => {
    getCollectorService()
      .tags.listTags()
      .then(setTags)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const displayNames = useMemo(() => {
    const known = tags.map((tag) => tag.name);
    const pending = selectedTagNames.filter(
      (name) => !known.some((knownName) => sameName(knownName, name)),
    );
    return [...known, ...pending];
  }, [tags, selectedTagNames]);

  const toggleTag = (name: string) => {
    if (selectedTagNames.some((selected) => sameName(selected, name))) {
      onChange(
        selectedTagNames.filter((selected) => !sameName(selected, name)),
      );
      return;
    }
    onChange([...selectedTagNames, name.trim()]);
  };

  const handleAddTagName = () => {
    const name = newTagName.trim();
    if (!name) {
      return;
    }
    if (!selectedTagNames.some((selected) => sameName(selected, name))) {
      onChange([...selectedTagNames, name]);
    }
    setNewTagName("");
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) {
      return;
    }

    setIsDeleting(true);
    setError(null);
    try {
      await getCollectorService().tags.deleteTag(pendingDelete.id);
      setTags((current) =>
        current.filter((entry) => entry.id !== pendingDelete.id),
      );
      onChange(
        selectedTagNames.filter(
          (selected) => !sameName(selected, pendingDelete.name),
        ),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setIsDeleting(false);
    }
  };

  const openRename = (tag: TagWithCount) => {
    setPendingRename(tag);
    setRenameValue(tag.name);
  };

  const handleConfirmRename = async () => {
    if (!pendingRename) {
      return;
    }

    const nextName = renameValue.trim();
    if (!nextName || nextName === pendingRename.name) {
      setPendingRename(null);
      return;
    }

    setIsRenaming(true);
    setError(null);
    try {
      const updated = await getCollectorService().tags.updateTagRecord(
        pendingRename.id,
        {
          name: nextName,
        },
      );
      setTags((current) =>
        current
          .map((entry) =>
            entry.id === pendingRename.id
              ? { ...entry, ...updated, item_count: entry.item_count }
              : entry,
          )
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      onChange(
        selectedTagNames.map((selected) =>
          sameName(selected, pendingRename.name) ? nextName : selected,
        ),
      );
      setPendingRename(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRenaming(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Теги</p>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {displayNames.map((name) => {
          const known = tags.find((tag) => sameName(tag.name, name));
          const selected = selectedTagNames.some((selected) =>
            sameName(selected, name),
          );
          return (
            <TagPickerChip
              key={name.toLowerCase()}
              name={name}
              known={known}
              selected={selected}
              onToggle={toggleTag}
              onRename={openRename}
              onDelete={setPendingDelete}
            />
          );
        })}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={newTagName}
          onChange={(event) => setNewTagName(event.target.value)}
          placeholder="Новый тег"
          className="flex-1 rounded-lg border border-black/10 dark:border-white/10 bg-neutral-100/20 dark:bg-neutral-700/20 px-3 py-2 text-sm"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleAddTagName();
            }
          }}
        />
        <button
          type="button"
          onClick={handleAddTagName}
          disabled={!newTagName.trim()}
          className="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 hover:bg-neutral-100/65 dark:hover:bg-neutral-700/65 text-sm disabled:opacity-50"
        >
          Добавить
        </button>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
          }
        }}
        title={pendingDelete?.name.trim() || "Тег"}
        description="Удалить тег? Он будет снят со всех элементов."
        busy={isDeleting}
        onConfirm={handleConfirmDelete}
      />

      <TagRenameDialog
        open={pendingRename !== null}
        tagName={pendingRename?.name ?? ""}
        renameValue={renameValue}
        isRenaming={isRenaming}
        onRenameValueChange={setRenameValue}
        onOpenChange={(open) => {
          if (!open) {
            setPendingRename(null);
          }
        }}
        onConfirm={() => void handleConfirmRename()}
        onCancel={() => setPendingRename(null)}
      />
    </div>
  );
}
