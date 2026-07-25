import { LayoutGrid, List, Menu, Plus } from "lucide-react";
import type { ViewMode } from "../../types/ui";

interface HeaderProps {
  onOpenSidebar: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onAddClick: () => void;
}

export function Header({
  onOpenSidebar,
  viewMode,
  onViewModeChange,
  onAddClick,
}: HeaderProps) {
  return (
    <header className="relative shrink-0 transition-colors duration-200">
      <div className="flex items-center justify-between gap-4 px-4 pt-4 md:px-8 md:pt-8">
        <div className="flex flex-1 items-center">
          <button
            type="button"
            onClick={onOpenSidebar}
            className="mr-4 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 md:hidden"
            aria-label="Открыть меню"
          >
            <Menu size={24} />
          </button>
          <div className="flex items-center rounded-lg bg-neutral-100/80 dark:bg-neutral-700/80 p-1 backdrop-blur-sm">
            <button
              type="button"
              onClick={() => onViewModeChange("grid")}
              className={`rounded-md p-1.5 transition-all ${
                viewMode === "grid"
                  ? "bg-white/70 text-neutral-900 dark:bg-neutral-800/70 dark:text-neutral-100 shadow-sm"
                  : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              }`}
              title="Сетка"
            >
              <LayoutGrid size={18} />
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("table")}
              className={`rounded-md p-1.5 transition-all ${
                viewMode === "table"
                  ? "bg-white/70 text-neutral-900 dark:bg-neutral-800/70 dark:text-neutral-100 shadow-sm"
                  : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              }`}
              title="Таблица"
            >
              <List size={18} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 md:gap-4">
          <button
            type="button"
            onClick={onAddClick}
            className="flex shrink-0 items-center gap-2 rounded-lg border border-emerald-600 px-3 py-2 font-medium text-emerald-600 transition-colors hover:bg-emerald-600/10 md:px-4 dark:border-emerald-500 dark:text-emerald-500 dark:hover:bg-emerald-500/10"
          >
            <Plus size={20} />
            <span className="hidden md:inline">Добавить</span>
          </button>
        </div>
      </div>
    </header>
  );
}
