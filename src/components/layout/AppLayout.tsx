import {
  createContext,
  useCallback,
  useContext,
  useRef,
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
import {
  type ItemPruneSignal,
} from "../../hooks/useItemPruneEffect";
import {
  useVaultShell,
  type ItemLiveSignal,
} from "../../hooks/useVaultShell";
import { useShellLayoutAlerts } from "../../hooks/useShellLayoutAlerts";
import type { DashboardItemSort } from "@collector/api";
import type {
  Layout,
  LayoutChangedMeta,
} from "react-resizable-panels";
import { useAppSettings } from "../../context/AppSettingsContext";
import { useJobPermanentFailureAlerts } from "../../hooks/useJobPermanentFailureAlerts";
import { useVaultIndexSyncStatus } from "../../hooks/useVaultIndexSyncStatus";
import { useDerivedCatchUpStatus } from "../../hooks/useDerivedCatchUpStatus";
import {
  SIDEBAR_RAIL_WIDTH_PX,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from "../../lib/sidebar-width";
import {
  isFolderFilter,
  navFilterKey,
  type NavFilter,
  type ViewMode,
} from "../../types/ui";
import { parseSettingsSection } from "../../types/sidebar-mode";
import { AlertBusProvider } from "../alerts/AlertBusProvider";
import { AlertHost } from "../alerts/AlertHost";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef,
} from "../ui/resizable";
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
  itemLiveSignal: ItemLiveSignal | null;
  sidebarSearchLiveSeq: number;
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
    itemLiveSignal,
    sidebarSearchLiveSeq,
    setDashboardPrune,
    setDashboardLiveHandler,
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
    persistSidebarWidth,
    handleToggleSidebarPin,
    handleExpandSidebar,
    handleCollapseAfterUse,
    markSidebarModeNavigation,
  } = useSidebarShell(pathname, locationKey);

  const sidebarSizePxRef = useRef(sidebarWidthPx);
  sidebarSizePxRef.current = sidebarWidthPx;
  const sidebarPanelRef = usePanelRef();

  const handleSidebarLayoutChanged = useCallback(
    (_layout: Layout, meta: LayoutChangedMeta) => {
      if (!meta.isUserInteraction) {
        return;
      }
      requestAnimationFrame(() => {
        const measured = sidebarPanelRef.current?.getSize().inPixels;
        const next =
          typeof measured === "number" && Number.isFinite(measured)
            ? measured
            : sidebarSizePxRef.current;
        persistSidebarWidth(next);
      });
    },
    [persistSidebarWidth, sidebarPanelRef],
  );

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
  } = useCreateItemShell({ navigate });

  const indexSync = useVaultIndexSyncStatus();
  const derivedCatchUp = useDerivedCatchUpStatus();
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
  setDashboardLiveHandler(dashboardCache.applyPresentationEvents);

  useShellLayoutAlerts({
    dashboardLoading: dashboardCache.isLoading,
    dashboardError: dashboardCache.error,
    indexSync,
    derivedCatchUp,
    navigate,
  });
  useJobPermanentFailureAlerts();

  const sidebarProps = {
    mode: sidebarMode,
    onModeChange: setSidebarMode,
    activeFilter,
    onFilterSelect: setActiveFilter,
    vaultRevision,
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

  // Scroll lives outside the content surface (pre-#541 UX): the whole
  // column moves with the page. Avoid overflow-hidden on a content-height
  // shadowed surface — that combo forced WebKitGTK to recomposite on every
  // wheel frame (#541 / #806d74c). min-h-full + flex + footer mt-auto keeps
  // the adjacent nav at the bottom when the page is short.
  const mainColumn: ReactNode = (
    <main className="relative flex min-h-0 h-full flex-1 flex-col overflow-hidden">
      <MainScrollArea resetKey={`${locationKey}|${navFilterKey(activeFilter)}`}>
        <div className="box-border flex min-h-full flex-col">
          <div className="flex min-h-full flex-1 flex-col bg-white dark:bg-neutral-800">
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
        itemLiveSignal,
        sidebarSearchLiveSeq,
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
              {sidebarCollapsed ? (
                <div className="flex h-full w-full">
                  <div
                    className="h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-linear"
                    style={{ width: SIDEBAR_RAIL_WIDTH_PX }}
                  >
                    <div className="h-full" style={{ width: sidebarWidthPx }}>
                      <Sidebar
                        variant="docked"
                        isOpen
                        collapsed
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
                  <div className="min-h-0 min-w-0 flex-1">{mainColumn}</div>
                </div>
              ) : (
                <ResizablePanelGroup
                  orientation="horizontal"
                  className="h-full w-full"
                  resizeTargetMinimumSize={{ fine: 16, coarse: 24 }}
                  onLayoutChanged={handleSidebarLayoutChanged}
                >
                  <ResizablePanel
                    id="app-sidebar"
                    panelRef={sidebarPanelRef}
                    defaultSize={sidebarWidthPx}
                    minSize={SIDEBAR_WIDTH_MIN}
                    maxSize={SIDEBAR_WIDTH_MAX}
                    groupResizeBehavior="preserve-pixel-size"
                    className="h-full min-h-0 overflow-hidden"
                    onResize={(panelSize) => {
                      sidebarSizePxRef.current = panelSize.inPixels;
                    }}
                  >
                    <Sidebar
                      variant="docked"
                      isOpen
                      collapsed={false}
                      pinned={sidebarPinned}
                      onTogglePin={handleToggleSidebarPin}
                      onCollapseAfterUse={handleCollapseAfterUse}
                      onSidebarModeNavigation={markSidebarModeNavigation}
                      onRequestExpand={handleExpandSidebar}
                      onClose={() => setIsSidebarOpen(false)}
                      {...sidebarProps}
                    />
                  </ResizablePanel>
                  <ResizableHandle aria-label="Изменить ширину сайдбара" />
                  <ResizablePanel
                    id="app-main"
                    className="min-h-0 min-w-0"
                  >
                    {mainColumn}
                  </ResizablePanel>
                </ResizablePanelGroup>
              )}
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
