import { useEffect, useState, type CSSProperties } from "react";
import { PanelLeft } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { TagWithCount } from "@collector/core";
import type { Theme } from "../../hooks/useTheme";
import type { NavFilter } from "../../types/ui";
import type { SidebarMode, SettingsSection } from "../../types/sidebar-mode";
import { parseSettingsSection } from "../../types/sidebar-mode";
import { getCollectorService } from "../../services/collector-client";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarProvider,
} from "../ui/sidebar";
import { resolveSidebarHighlightFilter } from "../../lib/sidebar-highlight-filter";
import { useItemChromeFolderPath } from "./item-chrome";
import { SidebarCollections } from "./SidebarCollections";
import { SidebarIconRail } from "./SidebarIconRail";
import { SidebarSearchPanel } from "./SidebarSearchPanel";
import { SidebarSettingsNav } from "./SidebarSettingsNav";
import { SidebarTags } from "./SidebarTags";

interface AppSidebarProps {
  variant?: "drawer" | "docked";
  isOpen: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onRequestExpand?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
  onCollapseAfterUse?: () => void;
  onSidebarModeNavigation?: () => void;
  mode: SidebarMode;
  onModeChange: (mode: SidebarMode) => void;
  activeFilter: NavFilter;
  onFilterSelect: (filter: NavFilter) => void;
  vaultRevision: number;
  refreshVault: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchIndexBuilding?: boolean;
  theme: Theme;
  onToggleTheme: () => void;
}

function panelTitle(mode: SidebarMode): string {
  switch (mode) {
    case "collections":
      return "Коллекции";
    case "tags":
      return "Теги";
    case "search":
      return "Поиск";
    case "settings":
      return "Настройки";
  }
}

export function Sidebar({
  variant = "drawer",
  isOpen,
  onClose,
  collapsed = false,
  onRequestExpand,
  pinned = false,
  onTogglePin,
  onCollapseAfterUse,
  onSidebarModeNavigation,
  mode,
  onModeChange,
  activeFilter,
  onFilterSelect,
  vaultRevision,
  refreshVault,
  searchQuery,
  onSearchChange,
  searchIndexBuilding = false,
  theme,
  onToggleTheme,
}: AppSidebarProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isSettings = pathname === "/settings";
  const isItemRoute = pathname.startsWith("/item/");
  const itemFolderPath = useItemChromeFolderPath();
  const highlightFilter = resolveSidebarHighlightFilter({
    isItemRoute,
    itemFolderPath,
    navFilter: activeFilter,
  });
  const settingsSection = parseSettingsSection(searchParams.get("section"));

  const finishSelection = () => {
    onClose();
    onCollapseAfterUse?.();
  };

  const handleSettingsSection = (section: SettingsSection) => {
    setSearchParams({ section });
    finishSelection();
  };
  const [tags, setTags] = useState<TagWithCount[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    getCollectorService().tags.subscribeTags(setTags, undefined, controller.signal);
    return () => {
      controller.abort();
    };
  }, [vaultRevision]);

  const goToDashboard = (filter: NavFilter) => {
    onFilterSelect(filter);
    navigate("/");
    finishSelection();
  };

  const handleModeChange = (next: SidebarMode) => {
    onModeChange(next);
    if (collapsed) {
      onRequestExpand?.();
    }
    if (next === "settings") {
      onSidebarModeNavigation?.();
      navigate("/settings?section=general");
      return;
    }
    if (pathname === "/settings") {
      onSidebarModeNavigation?.();
      navigate("/");
    }
  };

  const pinLabel = pinned ? "Открепить сайдбар" : "Закрепить сайдбар";

  const nested = (
    <SidebarProvider
      open
      onOpenChange={() => {}}
      className="!min-h-0 h-full w-full"
      style={
        {
          "--sidebar-width": "100%",
          "--sidebar-width-icon": "3rem",
        } as CSSProperties
      }
    >
      <ShadcnSidebar
        collapsible="none"
        className="flex h-full w-full flex-row overflow-hidden text-neutral-900 dark:text-neutral-100"
      >
        <SidebarIconRail
          mode={mode}
          onModeChange={handleModeChange}
          theme={theme}
          onToggleTheme={onToggleTheme}
        />

        {variant === "docked" || !collapsed ? (
          <div
            className="flex min-w-0 flex-1 flex-col overflow-hidden"
            inert={variant === "docked" && collapsed ? true : undefined}
          >
            <div className="box-border flex shrink-0 items-center gap-2 px-4 py-3">
              <div className="min-w-0 flex-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {panelTitle(mode)}
              </div>
              {variant === "docked" && onTogglePin ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-8 shrink-0 border-transparent shadow-none",
                    pinned
                      ? "bg-black/10 text-neutral-900 hover:bg-black/10 dark:bg-black/40 dark:text-neutral-100 dark:hover:bg-black/40"
                      : "bg-transparent text-neutral-500 hover:bg-transparent hover:text-neutral-500 dark:bg-transparent dark:text-neutral-400 dark:hover:bg-transparent dark:hover:text-neutral-400",
                  )}
                  aria-label={pinLabel}
                  title={pinLabel}
                  aria-pressed={pinned}
                  onClick={onTogglePin}
                >
                  <PanelLeft size={16} />
                </Button>
              ) : null}
            </div>
            {mode === "search" ? (
              <SidebarSearchPanel
                searchQuery={searchQuery}
                onSearchChange={onSearchChange}
                vaultRevision={vaultRevision}
                searchIndexBuilding={searchIndexBuilding}
              />
            ) : (
              <SidebarContent className="custom-scrollbar gap-0">
                {mode === "collections" ? (
                  <div className="px-2 py-2">
                    <SidebarCollections
                      activeFilter={highlightFilter}
                      isSettings={isSettings}
                      onSelect={goToDashboard}
                      vaultRevision={vaultRevision}
                      refreshVault={refreshVault}
                    />
                  </div>
                ) : null}
                {mode === "tags" ? (
                  <div className="px-2 py-2">
                    <SidebarTags
                      tags={tags}
                      activeFilter={highlightFilter}
                      isSettings={isSettings}
                      onSelect={goToDashboard}
                    />
                  </div>
                ) : null}
                {mode === "settings" ? (
                  <div className="py-2">
                    <SidebarSettingsNav
                      section={settingsSection}
                      onSectionChange={handleSettingsSection}
                    />
                  </div>
                ) : null}
              </SidebarContent>
            )}
          </div>
        ) : null}
      </ShadcnSidebar>
    </SidebarProvider>
  );

  return (
    <>
      {variant === "drawer" && isOpen && (
        <button
          type="button"
          aria-label="Закрыть меню"
          className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-xs"
          onClick={onClose}
        />
      )}

      <aside
        className={
          variant === "docked"
            ? "flex h-full w-full flex-col"
            : `fixed md:static inset-y-0 left-0 z-50 w-72 border-r border-black/10 bg-neutral-200 dark:border-white/10 dark:bg-neutral-900 flex flex-col transition-transform duration-300 ease-in-out shrink-0 ${
                isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
              }`
        }
      >
        {nested}
      </aside>
    </>
  );
}
