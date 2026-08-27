import type { TagWithCount } from "@collector/core";

interface TagPickerChipProps {
  name: string;
  known: TagWithCount | undefined;
  selected: boolean;
  onToggle: (name: string) => void;
}

export function TagPickerChip({
  name,
  known,
  selected,
  onToggle,
}: TagPickerChipProps) {
  return (
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
  );
}
