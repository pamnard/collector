import { LayoutGrid, List, Menu, Moon, Plus, Sun } from "lucide-react";
import type { ViewMode } from "../../types/ui";
import type { Theme } from "../../hooks/useTheme";
import { SearchBar } from "./SearchBar";

interface HeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onOpenSidebar: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onAddClick: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  searchIndexBuilding?: boolean;
}

export function Header({
  searchQuery,
  onSearchChange,
  onOpenSidebar,
  viewMode,
  onViewModeChange,
  onAddClick,
  theme,
  onToggleTheme,
  searchIndexBuilding,
}: HeaderProps) {
  return (
    <header className="relative h-16 border-b border-border transition-colors duration-200">
      <div className="flex h-full items-center justify-between gap-4 px-4 md:px-8">
        <div className="flex flex-1 items-center">
          <button
            type="button"
            onClick={onOpenSidebar}
            className="mr-4 text-secondary hover:text-primary md:hidden"
            aria-label="Открыть меню"
          >
            <Menu size={24} />
          </button>
        </div>

        <div className="flex items-center gap-3 md:gap-4">
          <SearchBar
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
            searchIndexBuilding={searchIndexBuilding}
          />

          <button
            type="button"
            onClick={onToggleTheme}
            className="rounded-lg p-2 text-secondary transition-colors hover:bg-input/65 hover:text-primary"
            title={
              theme === "dark"
                ? "Включить светлую тему"
                : "Включить тёмную тему"
            }
          >
            {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
          </button>

          <div className="flex items-center rounded-lg bg-input/80 p-1 backdrop-blur-sm">
            <button
              type="button"
              onClick={() => onViewModeChange("grid")}
              className={`rounded-md p-1.5 transition-all ${
                viewMode === "grid"
                  ? "bg-header/70 text-primary shadow-sm"
                  : "text-secondary hover:text-primary"
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
                  ? "bg-header/70 text-primary shadow-sm"
                  : "text-secondary hover:text-primary"
              }`}
              title="Таблица"
            >
              <List size={18} />
            </button>
          </div>

          <button
            type="button"
            onClick={onAddClick}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-emerald-600/90 px-3 py-2 font-medium text-white backdrop-blur-sm transition-colors hover:bg-emerald-700/90 md:px-4"
          >
            <Plus size={20} />
            <span className="hidden md:inline">Добавить</span>
          </button>
        </div>
      </div>
    </header>
  );
}
