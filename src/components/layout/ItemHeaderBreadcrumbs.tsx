import { Folder } from "lucide-react";
import type { PanelItemHeaderState } from "./panel-header-context";
import { folderPathSegments } from "./folder-path-segments";

const UNTITLED_FALLBACK = "Без названия";

interface ItemHeaderBreadcrumbsProps {
  state: PanelItemHeaderState | null;
  onFolderSelect: (folderPath: string) => void;
}

export function ItemHeaderBreadcrumbs({
  state,
  onFolderSelect,
}: ItemHeaderBreadcrumbsProps) {
  if (!state || state.status === "loading") {
    return (
      <div
        className="flex h-10 min-w-0 flex-1 items-center gap-1.5"
        aria-hidden
      >
        <span className="size-4 shrink-0 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        <span className="h-3 w-16 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        <span className="h-3 w-3 animate-pulse rounded bg-neutral-200/70 dark:bg-neutral-700/70" />
        <span className="h-3 min-w-0 flex-1 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
      </div>
    );
  }

  const folders = folderPathSegments(state.folderPath);
  const title = state.title.trim() || UNTITLED_FALLBACK;

  return (
    <nav
      aria-label="Путь"
      className="flex h-10 min-w-0 flex-1 items-center overflow-hidden"
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
              className="min-w-0 overflow-hidden whitespace-nowrap text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
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
            className="min-w-0 flex-1 overflow-hidden whitespace-nowrap font-medium text-neutral-900 dark:text-neutral-100"
            title={title}
          >
            {title}
          </span>
        </li>
      </ol>
    </nav>
  );
}
