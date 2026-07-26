import { Check, Code, Copy, Eye, Form, Trash2 } from "lucide-react";

export type ItemDetailMode = "view" | "form" | "source";

export interface ItemHeaderActionsModel {
  mode: ItemDetailMode;
  idCopyFeedback: "copied" | "failed" | null;
  isSaving: boolean;
  isDeleting: boolean;
  ready: boolean;
  onCopyId: () => void;
  onView: () => void;
  onForm: () => void;
  onSource: () => void;
  onDelete: () => void;
}

function modeButtonClass(active: boolean): string {
  return `inline-flex size-8 items-center justify-center rounded-md transition-all ${
    active
      ? "bg-white/70 text-neutral-900 shadow-sm dark:bg-neutral-800/70 dark:text-neutral-100"
      : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
  }`;
}

interface ItemHeaderActionsProps {
  actions: ItemHeaderActionsModel | null;
}

export function ItemHeaderActions({ actions }: ItemHeaderActionsProps) {
  if (!actions) {
    return (
      <div
        className="h-10 w-[10.5rem] shrink-0 animate-pulse rounded-lg bg-neutral-100/80 dark:bg-neutral-700/80"
        aria-hidden
      />
    );
  }

  const {
    mode,
    idCopyFeedback,
    isSaving,
    isDeleting,
    ready,
    onCopyId,
    onView,
    onForm,
    onSource,
    onDelete,
  } = actions;

  return (
    <div
      role="group"
      aria-label="Режим страницы"
      className="flex h-10 shrink-0 items-center rounded-lg bg-neutral-100/80 p-1 backdrop-blur-sm dark:bg-neutral-700/80"
    >
      <button
        type="button"
        aria-label={
          idCopyFeedback === "copied"
            ? "Id скопирован"
            : idCopyFeedback === "failed"
              ? "Не удалось скопировать id"
              : "Скопировать id элемента"
        }
        title={
          idCopyFeedback === "copied"
            ? "Id скопирован"
            : idCopyFeedback === "failed"
              ? "Не удалось скопировать id"
              : "Скопировать id элемента"
        }
        className={`inline-flex size-8 items-center justify-center rounded-md transition-all ${
          idCopyFeedback === "copied"
            ? "text-neutral-900 dark:text-neutral-100"
            : idCopyFeedback === "failed"
              ? "text-red-400"
              : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        }`}
        onClick={onCopyId}
        disabled={!ready || isSaving}
      >
        {idCopyFeedback === "copied" ? <Check size={16} /> : <Copy size={16} />}
      </button>
      <button
        type="button"
        aria-label="Просмотр"
        aria-pressed={mode === "view"}
        title="Просмотр"
        className={modeButtonClass(mode === "view")}
        onClick={onView}
        disabled={!ready || isSaving}
      >
        <Eye size={16} />
      </button>
      <button
        type="button"
        aria-label="Редактирование формы"
        aria-pressed={mode === "form"}
        title="Редактирование формы"
        className={modeButtonClass(mode === "form")}
        onClick={onForm}
        disabled={!ready || isSaving}
      >
        <Form size={16} />
      </button>
      <button
        type="button"
        aria-label="Исходный текст"
        aria-pressed={mode === "source"}
        title="Исходный текст"
        className={modeButtonClass(mode === "source")}
        onClick={onSource}
        disabled={!ready || isSaving}
      >
        <Code size={16} />
      </button>
      <button
        type="button"
        aria-label="Удалить"
        title="Удалить"
        className="inline-flex size-8 items-center justify-center rounded-md text-red-400 transition-all hover:bg-red-500/10 hover:text-red-400"
        onClick={onDelete}
        disabled={!ready || isDeleting || isSaving}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}
