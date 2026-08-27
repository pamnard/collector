import { TagPickerChip } from "./TagPickerChip";
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
    toggleTag,
    handleAddTagName,
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
            selected={isSelected(name)}
            onToggle={toggleTag}
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
    </div>
  );
}
