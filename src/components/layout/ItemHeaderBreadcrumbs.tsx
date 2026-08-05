import { Check, Copy, Folder } from "lucide-react";
import { cn } from "../../lib/utils";
import type { ItemChromeBreadcrumbState } from "./item-chrome/types";
import { folderPathSegments } from "./folder-path-segments";
import { headerPathChrome } from "./header-chrome";

const UNTITLED_FALLBACK = "Без названия";

interface ItemHeaderBreadcrumbsProps {
  state: ItemChromeBreadcrumbState | null;
  onFolderSelect: (folderPath: string) => void;
}

function BreadcrumbCopyButton({
  feedback,
  disabled,
  onCopy,
}: {
  feedback: "copied" | "failed" | null;
  disabled: boolean;
  onCopy: () => void;
}) {
  const label =
    feedback === "copied"
      ? "Id скопирован"
      : feedback === "failed"
        ? "Не удалось скопировать id"
        : "Скопировать id заметки";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onCopy}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors",
        "hover:text-neutral-900 disabled:pointer-events-none disabled:opacity-40",
        "dark:text-neutral-400 dark:hover:text-neutral-100",
        feedback === "copied" && "text-neutral-900 dark:text-neutral-100",
        feedback === "failed" && "text-red-400 dark:text-red-400",
      )}
    >
      {feedback === "copied" ? (
        <Check size={16} aria-hidden />
      ) : (
        <Copy size={16} aria-hidden />
      )}
    </button>
  );
}

export function ItemHeaderBreadcrumbs({
  state,
  onFolderSelect,
}: ItemHeaderBreadcrumbsProps) {
  if (!state || state.status === "loading") {
    return (
      <div
        className={cn(
          headerPathChrome,
          // pr-1 + size-8: glyph inset ~12px, matches left pl-3
          "flex h-8 min-w-0 flex-1 items-center gap-1.5 pr-1",
        )}
        aria-hidden
      >
        <span className="size-4 shrink-0 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        <span className="h-3 w-16 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        <span className="h-3 w-3 animate-pulse rounded bg-neutral-200/70 dark:bg-neutral-700/70" />
        <span className="h-3 min-w-0 flex-1 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        <span className="size-8 shrink-0 animate-pulse rounded-md bg-neutral-200/70 dark:bg-neutral-700/70" />
      </div>
    );
  }

  const folders = folderPathSegments(state.folderPath);
  const title = state.title.trim() || UNTITLED_FALLBACK;

  return (
    <nav
      aria-label="Путь"
      className={cn(
        headerPathChrome,
        // pr-1 + size-8: glyph inset ~12px, matches left pl-3
        "flex h-8 min-w-0 flex-1 items-center overflow-hidden pr-1",
      )}
    >
      <ol className="flex min-w-0 flex-1 items-center overflow-hidden text-sm">
        {folders.map((segment, index) => (
          <li
            key={segment.path}
            className="flex max-w-[min(12rem,35%)] shrink-0 items-center overflow-hidden"
          >
            {index === 0 ? (
              <Folder
                size={16}
                className="mr-3 shrink-0 text-neutral-500 dark:text-neutral-400"
                aria-hidden
              />
            ) : (
              <span
                className="mx-[1em] shrink-0 text-neutral-400 dark:text-neutral-500"
                aria-hidden
              >
                /
              </span>
            )}
            <button
              type="button"
              onClick={() => onFolderSelect(segment.path)}
              className="min-w-0 truncate text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              title={segment.name}
            >
              {segment.name}
            </button>
          </li>
        ))}
        {/* Fills leftover width up to whatever sits on the right; no artificial max-width. */}
        <li className="flex min-w-0 flex-1 items-center overflow-hidden">
          {folders.length > 0 && (
            <span
              className="mx-[1em] shrink-0 text-neutral-400 dark:text-neutral-500"
              aria-hidden
            >
              /
            </span>
          )}
          <span
            className="min-w-0 flex-1 truncate font-medium text-neutral-900 dark:text-neutral-100"
            title={title}
          >
            {title}
          </span>
        </li>
      </ol>
      <BreadcrumbCopyButton
        feedback={state.idCopyFeedback}
        disabled={!state.copyReady || state.isSaving}
        onCopy={state.onCopyId}
      />
    </nav>
  );
}
