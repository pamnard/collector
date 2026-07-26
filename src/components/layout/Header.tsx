import { LayoutDashboard, List, Menu, Plus } from "lucide-react";
import type { ViewMode } from "../../types/ui";
import { Button } from "../ui/button";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { ItemHeaderActions } from "./ItemHeaderActions";
import { ItemHeaderBreadcrumbs } from "./ItemHeaderBreadcrumbs";
import { usePanelHeader } from "./panel-header-context";

interface HeaderProps {
  variant: "list" | "item";
  onOpenSidebar: () => void;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  onAddClick?: () => void;
  onFolderSelect?: (folderPath: string) => void;
}

export function Header({
  variant,
  onOpenSidebar,
  viewMode,
  onViewModeChange,
  onAddClick,
  onFolderSelect,
}: HeaderProps) {
  const { itemHeader, itemActions } = usePanelHeader();

  return (
    <header className="relative shrink-0 border-b border-neutral-200 bg-white transition-colors duration-200 dark:border-neutral-700 dark:bg-neutral-800">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 md:gap-4 md:px-8">
        <div className="flex min-w-0 flex-1 items-center">
          <button
            type="button"
            onClick={onOpenSidebar}
            className="mr-3 shrink-0 text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 md:hidden"
            aria-label="Открыть меню"
          >
            <Menu size={24} />
          </button>

          {variant === "list" && viewMode && onViewModeChange ? (
            <Tabs
              value={viewMode}
              onValueChange={(next) => {
                if (next === "grid" || next === "table") {
                  onViewModeChange(next);
                }
              }}
            >
              {/*
                Icon 16 + pad to highlight 8/side (=32 trigger) + pad to track 4/side
                → list h-10. Add button matches that height.
              */}
              <TabsList
                aria-label="Вид списка"
                className="h-10 p-1 dark:bg-neutral-700 group-data-horizontal/tabs:h-10"
              >
                <TabsTrigger
                  value="grid"
                  aria-label="Сетка"
                  title="Сетка"
                  className="size-8 h-8 flex-none shrink-0 basis-auto px-0 py-0 aspect-square [&_svg]:size-4"
                >
                  <LayoutDashboard size={16} />
                </TabsTrigger>
                <TabsTrigger
                  value="table"
                  aria-label="Таблица"
                  title="Таблица"
                  className="size-8 h-8 flex-none shrink-0 basis-auto px-0 py-0 aspect-square [&_svg]:size-4"
                >
                  <List size={16} />
                </TabsTrigger>
              </TabsList>
            </Tabs>
          ) : (
            onFolderSelect && (
              <ItemHeaderBreadcrumbs
                state={itemHeader}
                onFolderSelect={onFolderSelect}
              />
            )
          )}
        </div>

        {variant === "list" && onAddClick && (
          <div className="flex shrink-0 items-center gap-3 md:gap-4">
            <Button
              type="button"
              variant="secondary"
              // h-10 matches switcher; px-4 keeps H ≥ V (default px-2.5 + icon pl-2 looked tall).
              className="h-10 gap-2 px-4 has-data-[icon=inline-start]:pl-4 has-data-[icon=inline-end]:pr-4 dark:bg-neutral-700 dark:hover:bg-neutral-600 dark:text-neutral-100"
              onClick={onAddClick}
            >
              <Plus data-icon="inline-start" size={16} />
              <span className="hidden md:inline">Добавить</span>
            </Button>
          </div>
        )}
        {variant === "item" && <ItemHeaderActions actions={itemActions} />}
      </div>
    </header>
  );
}
