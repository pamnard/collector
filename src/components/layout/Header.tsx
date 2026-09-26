import { LayoutDashboard, Menu, Plus, Table } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import type { SettingsSection } from "../../types/sidebar-mode";
import type { ViewMode } from "../../types/ui";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ButtonGroup } from "../ui/button-group";
import { headerChromeBtn, headerChromeBtnActive } from "./header-chrome";
import { ItemHeaderActions } from "./ItemHeaderActions";
import { ItemHeaderBreadcrumbs } from "./ItemHeaderBreadcrumbs";
import { SettingsHeaderBreadcrumbs } from "./SettingsHeaderBreadcrumbs";
import { useItemChromeHeader } from "./item-chrome";

type LinksReportTab = "wanted" | "broken";

function parseLinksReportTab(raw: string | null): LinksReportTab {
  return raw === "broken" ? "broken" : "wanted";
}

interface HeaderProps {
  variant: "list" | "item" | "settings" | "wanted-links";
  onOpenSidebar: () => void;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  onAddClick?: () => void;
  onFolderSelect?: (folderPath: string) => void;
  settingsSection?: SettingsSection;
}

export function Header({
  variant,
  onOpenSidebar,
  viewMode,
  onViewModeChange,
  onAddClick,
  onFolderSelect,
  settingsSection = "general",
}: HeaderProps) {
  const { breadcrumbs: itemHeader, actions: itemActions } =
    useItemChromeHeader();
  const [searchParams, setSearchParams] = useSearchParams();
  const linksTab = parseLinksReportTab(searchParams.get("tab"));

  return (
    <header className="relative shrink-0 border-b border-neutral-200 dark:border-neutral-700">
      <div className="flex items-center gap-2 px-4 py-3 md:px-8">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="shrink-0 text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 md:hidden"
          aria-label="Открыть меню"
        >
          <Menu size={24} />
        </button>

        {variant === "list" && viewMode && onViewModeChange ? (
          <ButtonGroup aria-label="Вид списка">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="Сетка"
              title="Сетка"
              aria-pressed={viewMode === "grid"}
              className={cn(
                "border-transparent",
                viewMode === "grid" ? headerChromeBtnActive : headerChromeBtn,
              )}
              onClick={() => onViewModeChange("grid")}
            >
              <LayoutDashboard size={16} />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="Таблица"
              title="Таблица"
              aria-pressed={viewMode === "table"}
              className={cn(
                "border-transparent",
                viewMode === "table" ? headerChromeBtnActive : headerChromeBtn,
              )}
              onClick={() => onViewModeChange("table")}
            >
              <Table size={16} />
            </Button>
          </ButtonGroup>
        ) : variant === "settings" ? (
          <SettingsHeaderBreadcrumbs section={settingsSection} />
        ) : variant === "wanted-links" ? (
          <ButtonGroup aria-label="Отчёт по битым ссылкам">
            <Button
              type="button"
              variant="secondary"
              aria-pressed={linksTab === "wanted"}
              className={cn(
                headerChromeBtn,
                "h-8 border-transparent px-2.5",
                linksTab === "wanted" && headerChromeBtnActive,
              )}
              onClick={() => setSearchParams({}, { replace: true })}
            >
              Ссылки
            </Button>
            <Button
              type="button"
              variant="secondary"
              aria-pressed={linksTab === "broken"}
              className={cn(
                headerChromeBtn,
                "h-8 border-transparent px-2.5",
                linksTab === "broken" && headerChromeBtnActive,
              )}
              onClick={() =>
                setSearchParams({ tab: "broken" }, { replace: true })
              }
            >
              Страницы
            </Button>
          </ButtonGroup>
        ) : (
          onFolderSelect && (
            <ItemHeaderBreadcrumbs
              state={itemHeader}
              onFolderSelect={onFolderSelect}
            />
          )
        )}

        {variant === "list" && onAddClick && (
          <Button
            type="button"
            variant="secondary"
            // h-8 matches size-8 switcher; px-2.5 keeps side pad ≈ vertical.
            className={cn(
              headerChromeBtn,
              "ml-auto h-8 shrink-0 gap-1.5 border-transparent px-2.5",
            )}
            onClick={() => onAddClick()}
          >
            <Plus data-icon="inline-start" size={16} />
            <span className="hidden md:inline">Добавить</span>
          </Button>
        )}
        {variant === "item" && (
          <div className="shrink-0">
            <ItemHeaderActions actions={itemActions} />
          </div>
        )}
      </div>
    </header>
  );
}
