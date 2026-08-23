import { Menu } from "lucide-react";
import { Outlet } from "react-router-dom";
import { navFilterKey, type NavFilter, type ViewMode } from "../../types/ui";
import { Header } from "./Header";
import { MainScrollArea } from "./MainScrollArea";
import { ItemChromeItemFooter } from "./item-chrome";
import type { AppLayoutRouteChrome } from "./app-layout-route-chrome";

export type AppLayoutMainColumnProps = {
  locationKey: string;
  activeFilter: NavFilter;
  viewMode: ViewMode;
  routeChrome: AppLayoutRouteChrome;
  isDesktop: boolean;
  onOpenSidebar: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  onAddClick: () => void;
  onFolderSelect: (folderPath: string) => void;
};

export function AppLayoutMainColumn({
  locationKey,
  activeFilter,
  viewMode,
  routeChrome,
  isDesktop,
  onOpenSidebar,
  onViewModeChange,
  onAddClick,
  onFolderSelect,
}: AppLayoutMainColumnProps) {
  // Scroll lives outside the content surface (pre-#541 UX): the whole
  // column moves with the page. Avoid overflow-hidden on a content-height
  // shadowed surface — that combo forced WebKitGTK to recomposite on every
  // wheel frame (#541 / #806d74c). min-h-full + flex + footer mt-auto keeps
  // the adjacent nav at the bottom when the page is short.
  return (
    <main className="relative flex min-h-0 h-full flex-1 flex-col overflow-hidden">
      <MainScrollArea
        resetKey={`${locationKey}|${navFilterKey(activeFilter)}|${viewMode}`}
      >
        <div className="box-border flex min-h-full flex-col">
          <div className="flex min-h-full flex-1 flex-col bg-white dark:bg-neutral-800">
            {routeChrome.showCardHeader ? (
              <Header
                variant={routeChrome.headerVariant}
                onOpenSidebar={onOpenSidebar}
                viewMode={viewMode}
                onViewModeChange={onViewModeChange}
                onAddClick={onAddClick}
                onFolderSelect={onFolderSelect}
                settingsSection={routeChrome.settingsSection}
              />
            ) : (
              !isDesktop && (
                <div className="shrink-0 px-4 pt-4 md:px-8">
                  <button
                    type="button"
                    onClick={onOpenSidebar}
                    className="text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                    aria-label="Открыть меню"
                  >
                    <Menu size={24} />
                  </button>
                </div>
              )
            )}
            <div className="flex-1 p-4 md:p-8">
              <Outlet />
            </div>
            <ItemChromeItemFooter />
          </div>
        </div>
      </MainScrollArea>
    </main>
  );
}
