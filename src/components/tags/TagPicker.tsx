import { ConfirmDialog } from "../ui/confirm-dialog";
import { TagPickerChip } from "./TagPickerChip";
import { TagRenameDialog } from "./TagRenameDialog";
import { useTagPicker } from "./use-tag-picker";

interface TagPickerProps {
  selectedTagNames: string[];
  onChange: (tagNames: string[]) => void;
}

export function TagPicker({ selectedTagNames, onChange }: TagPickerProps) {
  const {
    displayNames,
    newTagName,
    setNewTagName,
    pendingDelete,
    setPendingDelete,
    isDeleting,
    pendingRename,
    setPendingRename,
    renameValue,
    setRenameValue,
    isRenaming,
    toggleTag,
    handleAddTagName,
    handleConfirmDelete,
    openRename,
    handleConfirmRename,
    findKnownTag,
    isSelected,
  } = useTagPicker({ selectedTagNames, onChange });

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Теги</p>

      <div className="flex flex-wrap gap-2">
        {displayNames.map((name) => (
          <TagPickerChip
            key={name.toLowerCase()}
            name={name}
            known={findKnownTag(name)}
            selected={isSelected(name)}
            onToggle={toggleTag}
            onRename={openRename}
            onDelete={setPendingDelete}
          />
        ))}
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
