import { useEffect, useMemo, useState } from "react";
import type { TagWithCount } from "@collector/core";
import { getCollectorService } from "../../services/collector-client";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

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
    getCollectorService().tags
      .listTags()
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
            <div key={name.toLowerCase()} className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => toggleTag(name)}
                className={`rounded-full px-3 py-1 text-sm border transition-colors ${
                  selected
                    ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-300"
                    : "border-black/10 dark:border-white/10 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100/65 dark:hover:bg-neutral-700/65"
                }`}
                style={
                  known?.color
                    ? { borderColor: known.color, color: known.color }
                    : undefined
                }
              >
                {name}
              </button>
              {known ? (
                <>
                  <button
                    type="button"
                    onClick={() => openRename(known)}
                    className="text-neutral-500 hover:text-neutral-500 dark:hover:text-neutral-400 text-sm px-1"
                    aria-label={`Переименовать ${known.name}`}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(known)}
                    className="text-neutral-500 hover:text-red-400 text-sm px-1"
                    aria-label={`Удалить ${known.name}`}
                  >
                    ×
                  </button>
                </>
              ) : null}
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

      <Dialog
        open={pendingRename !== null}
        onOpenChange={(open) => {
          if (isRenaming) {
            return;
          }
          if (!open) {
            setPendingRename(null);
          }
        }}
      >
        <DialogContent showCloseButton={!isRenaming}>
          <DialogHeader>
            <DialogTitle>Переименовать тег</DialogTitle>
            <DialogDescription>
              Новое имя для «{pendingRename?.name ?? ""}».
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            disabled={isRenaming}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleConfirmRename();
              }
            }}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isRenaming}
              onClick={() => setPendingRename(null)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              disabled={isRenaming || !renameValue.trim()}
              onClick={() => void handleConfirmRename()}
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
