import { useEffect, useState, type CSSProperties } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { TagWithCount } from "@collector/core";
import type { Theme } from "../../hooks/useTheme";
import type { NavFilter } from "../../types/ui";
import type { SidebarMode } from "../../types/sidebar-mode";
import { parseSettingsSection } from "../../types/sidebar-mode";
import { getCollectorClient } from "../../services/collector-client";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarProvider,
} from "../ui/sidebar";
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
  mode: SidebarMode;
  onModeChange: (mode: SidebarMode) => void;
  activeFilter: NavFilter;
  onFilterSelect: (filter: NavFilter) => void;
  vaultRevision: number;
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
  mode,
  onModeChange,
  activeFilter,
  onFilterSelect,
  vaultRevision,
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
  const settingsSection = parseSettingsSection(searchParams.get("section"));
  const [tags, setTags] = useState<TagWithCount[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    getCollectorClient().subscribeTags(setTags, undefined, controller.signal);
    return () => {
      controller.abort();
    };
  }, [vaultRevision]);

  const goToDashboard = (filter: NavFilter) => {
    onFilterSelect(filter);
    navigate("/");
    onClose();
  };

  const handleModeChange = (next: SidebarMode) => {
    onModeChange(next);
    if (collapsed) {
      onRequestExpand?.();
    }
    if (next === "settings") {
      navigate("/settings?section=general");
      onClose();
      return;
    }
    if (pathname === "/settings") {
      navigate("/");
    }
    onClose();
  };

  const handleSettingsSection = (section: "general" | "mcp") => {
    setSearchParams({ section });
  };

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

        {!collapsed ? (
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-neutral-200 dark:bg-neutral-900">
            <div className="flex h-12 shrink-0 items-center px-4 box-border">
              <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {panelTitle(mode)}
              </div>
            </div>
            {mode === "search" ? (
              <SidebarSearchPanel
                searchQuery={searchQuery}
                onSearchChange={onSearchChange}
                searchIndexBuilding={searchIndexBuilding}
              />
            ) : (
              <SidebarContent className="custom-scrollbar gap-0">
                {mode === "collections" ? (
                  <div className="px-2 py-2">
                    <SidebarCollections
                      activeFilter={activeFilter}
                      isSettings={isSettings}
                      onSelect={goToDashboard}
                      vaultRevision={vaultRevision}
                    />
                  </div>
                ) : null}
                {mode === "tags" ? (
                  <div className="px-2 py-2">
                    <SidebarTags
                      tags={tags}
                      activeFilter={activeFilter}
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
            : `fixed md:static inset-y-0 left-0 z-50 w-72 border-r border-black/10 dark:border-white/10 flex flex-col transition-all duration-300 ease-in-out shrink-0 ${
                isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
              }`
        }
      >
        {nested}
      </aside>
    </>
  );
}
