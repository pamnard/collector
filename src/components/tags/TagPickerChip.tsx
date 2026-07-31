import type { TagWithCount } from "@collector/core";

interface TagPickerChipProps {
  name: string;
  known: TagWithCount | undefined;
  selected: boolean;
  onToggle: (name: string) => void;
  onRename: (tag: TagWithCount) => void;
  onDelete: (tag: TagWithCount) => void;
}

export function TagPickerChip({
  name,
  known,
  selected,
  onToggle,
  onRename,
  onDelete,
}: TagPickerChipProps) {
  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => onToggle(name)}
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
            onClick={() => onRename(known)}
            className="text-neutral-500 hover:text-neutral-500 dark:hover:text-neutral-400 text-sm px-1"
            aria-label={`Переименовать ${known.name}`}
          >
            ✎
          </button>
          <button
            type="button"
            onClick={() => onDelete(known)}
            className="text-neutral-500 hover:text-red-400 text-sm px-1"
            aria-label={`Удалить ${known.name}`}
          >
            ×
          </button>
        </>
      ) : null}
    </div>
  );
}
