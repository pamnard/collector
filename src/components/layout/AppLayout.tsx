import {
  createContext,
  useCallback,
  useContext,
  type ReactNode,
} from "react";
import { Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Menu } from "lucide-react";
import { CreateItemDialog } from "../items/CreateItemDialog";
import { useNavState } from "../../hooks/useNavState";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useTheme } from "../../hooks/useTheme";
import { useViewMode } from "../../hooks/useViewMode";
import { useDashboardItems } from "../../hooks/useDashboardItems";
import { useSidebarShell } from "../../hooks/useSidebarShell";
import { useDashboardShellSort } from "../../hooks/useDashboardShellSort";
import { useCreateItemShell } from "../../hooks/useCreateItemShell";
import { useVaultShell } from "../../hooks/useVaultShell";
import { useShellLayoutAlerts } from "../../hooks/useShellLayoutAlerts";
import type { DashboardItemSort } from "@collector/api";
import { useAppSettings } from "../../context/AppSettingsContext";
import { useJobPermanentFailureAlerts } from "../../hooks/useJobPermanentFailureAlerts";
import { useVaultIndexSyncStatus } from "../../hooks/useVaultIndexSyncStatus";
import {
  SIDEBAR_RAIL_WIDTH_PX,
} from "../../lib/sidebar-width";
import {
  type ItemPruneSignal,
} from "../../hooks/useItemPruneEffect";
import {
  isFolderFilter,
  navFilterKey,
  type NavFilter,
  type ViewMode,
} from "../../types/ui";
import { parseSettingsSection } from "../../types/sidebar-mode";
import { cn } from "../../lib/utils";
import { AlertBusProvider } from "../alerts/AlertBusProvider";
import { AlertHost } from "../alerts/AlertHost";
import { TooltipProvider } from "../ui/tooltip";
import { SmokeUiReadyBeacon } from "../startup/SmokeUiReadyBeacon";
import { Header } from "./Header";
import { MainScrollArea } from "./MainScrollArea";
import {
  ItemChromeItemFooter,
  ItemChromeProvider,
} from "./item-chrome";
import { Sidebar } from "./Sidebar";

interface ShellContextValue {
  viewMode: ViewMode;
  searchQuery: string;
  activeFilter: NavFilter;
  vaultRevision: number;
  refreshVault: () => void;
  pruneItem: (itemId: string) => void;
  itemPruneSignal: ItemPruneSignal | null;
  openCreate: (folderPath?: string) => void;
  dashboardCache: ReturnType<typeof useDashboardItems>;
  dashboardSort: DashboardItemSort;
  setDashboardSort: (sort: DashboardItemSort) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const context = useContext(ShellContext);
  if (!context) {
    throw new Error("useShell must be used within AppLayout");
  }
  return context;
}

export function AppLayout() {
  return (
    <AlertBusProvider>
      <AppLayoutInner />
    </AlertBusProvider>
  );
}

function AppLayoutInner() {
  const navigate = useNavigate();
  const { pathname, key: locationKey } = useLocation();
  const [searchParams] = useSearchParams();
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const {
    vaultRevision,
    bumpVaultRevision,
    itemPruneSignal,
    setDashboardPrune,
    pruneItem,
  } = useVaultShell();

  const {
    isSidebarOpen,
    setIsSidebarOpen,
    sidebarWidthPx,
    sidebarCollapsed,
    sidebarPinned,
    sidebarMode,
    setSidebarMode,
    isSidebarResizing,
    handleSidebarResizePointerDown,
    handleToggleSidebarPin,
    handleExpandSidebar,
    handleCollapseAfterUse,
    markSidebarModeNavigation,
  } = useSidebarShell(pathname, locationKey);

  const {
    activeFilter,
    setActiveFilter,
    searchQuery,
    setSearchQuery,
  } = useNavState();
  const { viewMode, setViewMode } = useViewMode();
  const { theme, toggleTheme } = useTheme();
  const { settings } = useAppSettings();
  const activeVaultId = settings.active_vault_id ?? null;
  const { dashboardSort, setDashboardSort } =
    useDashboardShellSort(activeVaultId);
  const {
    isCreateOpen,
    createFolderPath,
    openCreate,
    closeCreate,
    handleCreated,
  } = useCreateItemShell({ bumpVaultRevision, navigate });

  const indexSync = useVaultIndexSyncStatus();
  const searchIndexBuilding =
    !indexSync.ftsReady &&
    (indexSync.status === "running" || indexSync.status === "rebuilding");

  // Cache dashboard items across navigation to prevent flashing empty grid.
  // Text search lives in the sidebar panel (not the main grid).
  const dashboardCache = useDashboardItems(
    activeFilter,
    "",
    vaultRevision,
    dashboardSort,
  );

  setDashboardPrune(dashboardCache.pruneItem);

  useShellLayoutAlerts({
    dashboardLoading: dashboardCache.isLoading,
    dashboardError: dashboardCache.error,
    indexSync,
    navigate,
  });
  useJobPermanentFailureAlerts();

  const sidebarProps = {
    mode: sidebarMode,
    onModeChange: setSidebarMode,
    activeFilter,
    onFilterSelect: setActiveFilter,
    vaultRevision,
    refreshVault: bumpVaultRevision,
    searchQuery,
    onSearchChange: setSearchQuery,
    searchIndexBuilding,
    theme,
    onToggleTheme: toggleTheme,
  } as const;

  const isItemRoute = pathname.startsWith("/item/");
  const isSettingsRoute = pathname === "/settings";
  const settingsSection = parseSettingsSection(searchParams.get("section"));
  const showCardHeader = pathname === "/" || isItemRoute || isSettingsRoute;

  const handleFolderSelectFromHeader = useCallback(
    (folderPath: string) => {
      void setActiveFilter({ type: "folder", folderPath });
      setSidebarMode("collections");
      navigate("/");
    },
    [navigate, setActiveFilter, setSidebarMode],
  );

  const headerVariant = pathname === "/"
    ? "list"
    : isSettingsRoute
      ? "settings"
      : "item";

  // Scroll lives OUTSIDE the card (pre-#541 UX): the whole card moves with
  // the page. Avoid overflow-hidden on a content-height shadowed card — that
  // combo forced WebKitGTK to recomposite on every wheel frame (#541 / #806d74c).
  // min-h-full + flex + footer mt-auto keeps the adjacent nav at the bottom
  // when the page is short.
  const mainColumn: ReactNode = (
    <main className="relative flex min-h-0 h-full flex-1 flex-col overflow-hidden">
      <MainScrollArea resetKey={`${locationKey}|${navFilterKey(activeFilter)}`}>
        <div className="box-border flex min-h-full flex-col p-2">
          <div className="flex min-h-full flex-1 flex-col rounded-lg bg-white dark:bg-neutral-800">
            {showCardHeader ? (
              <Header
                variant={headerVariant}
                onOpenSidebar={() => setIsSidebarOpen(true)}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onAddClick={() =>
                  openCreate(
                    isFolderFilter(activeFilter)
                      ? activeFilter.folderPath
                      : undefined,
                  )
                }
                onFolderSelect={handleFolderSelectFromHeader}
                settingsSection={settingsSection}
              />
            ) : (
              !isDesktop && (
                <div className="shrink-0 px-4 pt-4 md:px-8">
                  <button
                    type="button"
                    onClick={() => setIsSidebarOpen(true)}
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

  return (
    <ShellContext.Provider
      value={{
        viewMode,
        searchQuery,
        activeFilter,
        vaultRevision,
        refreshVault: bumpVaultRevision,
        pruneItem,
        itemPruneSignal,
        openCreate,
        dashboardCache,
        dashboardSort,
        setDashboardSort,
      }}
    >
      <ItemChromeProvider>
        <TooltipProvider>
          {isDesktop ? (
            <div
              data-smoke-shell
              className="h-screen overflow-hidden font-sans text-neutral-900 dark:text-neutral-100"
            >
              <SmokeUiReadyBeacon />
              <div className="flex h-full w-full">
                <div
                  className={cn(
                    "h-full shrink-0 overflow-hidden",
                    !isSidebarResizing &&
                      "transition-[width] duration-200 ease-linear",
                  )}
                  style={{
                    width: sidebarCollapsed
                      ? SIDEBAR_RAIL_WIDTH_PX
                      : sidebarWidthPx,
                  }}
                >
                  <div className="h-full" style={{ width: sidebarWidthPx }}>
                    <Sidebar
                      variant="docked"
                      isOpen
                      collapsed={sidebarCollapsed}
                      pinned={sidebarPinned}
                      onTogglePin={handleToggleSidebarPin}
                      onCollapseAfterUse={handleCollapseAfterUse}
                      onSidebarModeNavigation={markSidebarModeNavigation}
                      onRequestExpand={handleExpandSidebar}
                      onClose={() => setIsSidebarOpen(false)}
                      {...sidebarProps}
                    />
                  </div>
                </div>
                {!sidebarCollapsed ? (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Изменить ширину сайдбара"
                    className="relative z-10 w-px shrink-0 cursor-col-resize bg-transparent hover:bg-border data-[separator=active]:bg-border focus-visible:outline-hidden focus-visible:ring-0"
                    data-separator={isSidebarResizing ? "active" : undefined}
                    onPointerDown={handleSidebarResizePointerDown}
                  />
                ) : null}
                <div className="min-h-0 min-w-0 flex-1">{mainColumn}</div>
              </div>
            </div>
          ) : (
            <div
              data-smoke-shell
              className="flex h-screen overflow-hidden font-sans text-neutral-900 dark:text-neutral-100"
            >
              <SmokeUiReadyBeacon />
              <Sidebar
                variant="drawer"
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                {...sidebarProps}
              />
              {mainColumn}
            </div>
          )}
        </TooltipProvider>

        <AlertHost />

        <CreateItemDialog
          open={isCreateOpen}
          onOpenChange={(next) => {
            if (!next) {
              closeCreate();
            }
          }}
          onCreated={handleCreated}
          initialFolderPath={createFolderPath}
        />
      </ItemChromeProvider>
    </ShellContext.Provider>
  );
}
