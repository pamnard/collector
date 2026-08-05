import { Code, Eye, Form, Trash2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ButtonGroup } from "../ui/button-group";
import { headerChromeBtn, headerChromeBtnActive } from "./header-chrome";
import type { ItemDetailMode } from "./item-chrome/types";

export type { ItemDetailMode };

export interface ItemHeaderActionsModel {
  mode: ItemDetailMode;
  isSaving: boolean;
  isDeleting: boolean;
  ready: boolean;
  onView: () => void;
  onForm: () => void;
  onSource: () => void;
  onDelete: () => void;
}

interface ItemHeaderActionsProps {
  actions: ItemHeaderActionsModel | null;
}

/** Square hit target — do not mix with h/w overrides (fights size="icon"). */
const iconBtn = "border-transparent";

export function ItemHeaderActions({ actions }: ItemHeaderActionsProps) {
  if (!actions) {
    return (
      <div
        className="h-8 w-32 shrink-0 animate-pulse rounded-lg bg-secondary dark:bg-neutral-700"
        aria-hidden
      />
    );
  }

  const {
    mode,
    isSaving,
    isDeleting,
    ready,
    onView,
    onForm,
    onSource,
    onDelete,
  } = actions;

  return (
    <ButtonGroup aria-label="Режим страницы">
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label="Просмотр"
        aria-pressed={mode === "view"}
        title="Просмотр"
        className={cn(
          iconBtn,
          mode === "view" ? headerChromeBtnActive : headerChromeBtn,
        )}
        onClick={onView}
        disabled={!ready || isSaving}
      >
        <Eye size={16} />
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label="Редактирование формы"
        aria-pressed={mode === "form"}
        title="Редактирование формы"
        className={cn(
          iconBtn,
          mode === "form" ? headerChromeBtnActive : headerChromeBtn,
        )}
        onClick={onForm}
        disabled={!ready || isSaving}
      >
        <Form size={16} />
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label="Исходный текст"
        aria-pressed={mode === "source"}
        title="Исходный текст"
        className={cn(
          iconBtn,
          mode === "source" ? headerChromeBtnActive : headerChromeBtn,
        )}
        onClick={onSource}
        disabled={!ready || isSaving}
      >
        <Code size={16} />
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label="Удалить"
        title="Удалить"
        className={cn(
          iconBtn,
          // bg only — headerChromeBtn's text would win over red via CSS order
          "dark:bg-neutral-700 text-red-400 hover:bg-red-500/10 hover:text-red-400 dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-400",
        )}
        onClick={onDelete}
        disabled={!ready || isDeleting || isSaving}
      >
        <Trash2 size={16} />
      </Button>
    </ButtonGroup>
  );
}
