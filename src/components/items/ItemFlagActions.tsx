import { Archive, Star } from "lucide-react";
import { useState } from "react";
import { updateItem } from "../../services/collector-service";

interface ItemFlagActionsProps {
  itemId: string;
  isFavorite: boolean;
  isArchived: boolean;
  onUpdated?: () => void;
  compact?: boolean;
}

export function ItemFlagActions({
  itemId,
  isFavorite,
  isArchived,
  onUpdated,
  compact = false,
}: ItemFlagActionsProps) {
  const [busy, setBusy] = useState<"favorite" | "archive" | null>(null);

  const patch = async (
    field: "favorite" | "archive",
    patchValues: { is_favorite?: boolean; is_archived?: boolean },
  ) => {
    setBusy(field);
    try {
      await updateItem(itemId, patchValues);
      onUpdated?.();
    } finally {
      setBusy(null);
    }
  };

  const buttonClass = compact
    ? "rounded-lg p-1.5 transition-colors disabled:opacity-50"
    : "rounded-lg border border-border p-1.5 transition-colors disabled:opacity-50";

  return (
    <div
      className="inline-flex items-center gap-1"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label={isFavorite ? "Убрать из избранного" : "В избранное"}
        aria-pressed={isFavorite}
        disabled={busy !== null}
        onClick={() =>
          patch("favorite", { is_favorite: !isFavorite })
        }
        className={`${buttonClass} ${
          isFavorite
            ? "text-amber-400 border-amber-500/40 bg-amber-500/10"
            : "text-secondary hover:text-amber-400 hover:bg-input/40"
        }`}
      >
        <Star size={16} fill={isFavorite ? "currentColor" : "none"} />
      </button>
      <button
        type="button"
        aria-label={isArchived ? "Вернуть из архива" : "В архив"}
        aria-pressed={isArchived}
        disabled={busy !== null}
        onClick={() =>
          patch("archive", { is_archived: !isArchived })
        }
        className={`${buttonClass} ${
          isArchived
            ? "text-indigo-400 border-indigo-500/40 bg-indigo-500/10"
            : "text-secondary hover:text-indigo-400 hover:bg-input/40"
        }`}
      >
        <Archive size={16} />
      </button>
    </div>
  );
}
