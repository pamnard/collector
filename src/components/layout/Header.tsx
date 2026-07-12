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
}: HeaderProps) {
  return (
    <header className="absolute top-0 left-0 right-0 z-30 h-16 bg-header/60 backdrop-blur-md border-b border-border flex items-center justify-between px-4 md:px-8 gap-4 transition-colors duration-200">
      <div className="flex items-center flex-1">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="md:hidden text-secondary hover:text-primary mr-4"
          aria-label="Открыть меню"
        >
          <Menu size={24} />
        </button>
      </div>

      <div className="flex items-center gap-3 md:gap-4">
        <SearchBar searchQuery={searchQuery} onSearchChange={onSearchChange} />

        <button
          type="button"
          onClick={onToggleTheme}
          className="p-2 rounded-lg text-secondary hover:bg-input/40 hover:text-primary transition-colors"
          title={
            theme === "dark"
              ? "Включить светлую тему"
              : "Включить тёмную тему"
          }
        >
          {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
        </button>

        <div className="flex items-center bg-input/40 backdrop-blur-sm rounded-lg p-1 border border-border">
          <button
            type="button"
            onClick={() => onViewModeChange("grid")}
            className={`p-1.5 rounded-md transition-all ${
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
            className={`p-1.5 rounded-md transition-all ${
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
          className="flex items-center gap-2 bg-emerald-600/90 backdrop-blur-sm hover:bg-emerald-700/90 text-white px-3 md:px-4 py-2 rounded-lg font-medium transition-colors shrink-0"
        >
          <Plus size={20} />
          <span className="hidden md:inline">Добавить</span>
        </button>
      </div>
    </header>
  );
}
