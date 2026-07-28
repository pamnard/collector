import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Menu } from "lucide-react";
import { CreateItemDialog } from "../items/CreateItemDialog";
import { useNavState } from "../../hooks/useNavState";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useTheme } from "../../hooks/useTheme";
import {
  useCheckUpdatesOnStart,
  useStartupUpdateCheck,
} from "../../hooks/useUpdaterSettings";
import { useViewMode } from "../../hooks/useViewMode";
import { useDashboardItems, DEFAULT_DASHBOARD_SORT } from "../../hooks/useDashboardItems";
import type { DashboardItemSort } from "@collector/api";
import { useAppSettings } from "../../context/AppSettingsContext";
import { useVaultIndexSyncStatus } from "../../hooks/useVaultIndexSyncStatus";
import {
  SIDEBAR_RAIL_WIDTH_PX,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  readSidebarCollapsed,
  readSidebarWidthPx,
  writeSidebarCollapsed,
  writeSidebarWidthPx,
} from "../../lib/sidebar-width";
import { formatIndexingBannerLabel } from "@collector/core";
import type { NavFilter, ViewMode } from "../../types/ui";
import {
  parseSettingsSection,
  type SidebarMode,
} from "../../types/sidebar-mode";
import { Alert } from "../alerts/Alert";
import { AlertStack } from "../alerts/AlertStack";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef,
} from "../ui/resizable";
import { TooltipProvider } from "../ui/tooltip";
import { SmokeUiReadyBeacon } from "../startup/SmokeUiReadyBeacon";
import { Header } from "./Header";
import { IndexingStatusAlert } from "./IndexingStatusAlert";
import { MainScrollArea } from "./MainScrollArea";
import {
  PanelHeaderProvider,
  usePanelHeader,
} from "./panel-header-context";
import { Sidebar } from "./Sidebar";
import { ItemAdjacentNav } from "../items/ItemAdjacentNav";

function ItemPanelAdjacentFooter() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { itemAdjacent } = usePanelHeader();
  const onItemRoute = pathname.startsWith("/item/");
  if (
    !onItemRoute ||
    itemAdjacent === null ||
    (!itemAdjacent.prev && !itemAdjacent.next)
  ) {
    return null;
  }

  return (
    <footer className="relative shrink-0 border-t border-neutral-200 bg-white transition-colors duration-200 dark:border-neutral-700 dark:bg-neutral-800">
      <div className="px-4 py-5 md:px-8 md:py-6">
        <ItemAdjacentNav
          adjacent={itemAdjacent}
          onNavigate={(itemId) => navigate(`/item/${itemId}`)}
        />
      </div>
    </footer>
  );
}

interface ShellContextValue {
  viewMode: ViewMode;
  searchQuery: string;
  activeFilter: NavFilter;
  vaultRevision: number;
  refreshVault: () => void;
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
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [vaultRevision, setVaultRevision] = useState(0);
  const [sidebarWidthPx, setSidebarWidthPx] = useState(() => readSidebarWidthPx());
  const sidebarWidthRef = useRef(sidebarWidthPx);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readSidebarCollapsed(),
  );
  const sidebarPanelRef = usePanelRef();
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() =>
    pathname === "/settings" ? "settings" : "collections",
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
  const [dashboardSort, setDashboardSort] = useState<DashboardItemSort>(
    DEFAULT_DASHBOARD_SORT,
  );
  const activeVaultId = settings.active_vault_id ?? null;
  const prevVaultIdRef = useRef(activeVaultId);

  useEffect(() => {
    if (prevVaultIdRef.current === activeVaultId) {
      return;
    }
    prevVaultIdRef.current = activeVaultId;
    setDashboardSort(DEFAULT_DASHBOARD_SORT);
  }, [activeVaultId]);

  const { enabled: checkUpdatesOnStart } = useCheckUpdatesOnStart();
  const [startupUpdateVersion, setStartupUpdateVersion] = useState<string | null>(
    null,
  );
  /** Dismissed dashboard error message; new/different errors show again. */
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const indexSync = useVaultIndexSyncStatus();
  const isMetadataIndexing =
    indexSync.status === "rebuilding" ||
    (indexSync.status === "running" && !indexSync.metadataReady);
  const searchIndexBuilding =
    !indexSync.ftsReady &&
    (indexSync.status === "running" || indexSync.status === "rebuilding");

  useEffect(() => {
    if (pathname === "/settings") {
      setSidebarMode("settings");
    }
  }, [pathname]);

  const handleStartupUpdateFound = useCallback((version: string) => {
    setStartupUpdateVersion(version);
  }, []);

  useStartupUpdateCheck(checkUpdatesOnStart, handleStartupUpdateFound);

  // Cache dashboard items across navigation to prevent flashing empty grid.
  // Text search lives in the sidebar panel (not the main grid).
  const dashboardCache = useDashboardItems(
    activeFilter,
    "",
    vaultRevision,
    dashboardSort,
  );

  const indexingLabel = formatIndexingBannerLabel(indexSync);
  const dashboardError = dashboardCache.error;
  const showErrorAlert =
    dashboardError !== null && dashboardError !== dismissedError;
  const showDashboardLoading = dashboardCache.isLoading;
  const showUpdateAlert = startupUpdateVersion !== null;
  const showAlertStack =
    isMetadataIndexing ||
    showErrorAlert ||
    showDashboardLoading ||
    showUpdateAlert;

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
    [navigate, setActiveFilter],
  );

  const setCollapsed = useCallback((collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    writeSidebarCollapsed(collapsed);
  }, []);

  const persistSidebarWidth = useCallback((inPixels: number) => {
    if (inPixels < SIDEBAR_WIDTH_MIN) {
      return;
    }
    sidebarWidthRef.current = inPixels;
    writeSidebarWidthPx(inPixels);
  }, []);

  const handleToggleSidebarCollapse = useCallback(() => {
    if (sidebarCollapsed) {
      // Remount uses last persisted width; sync state so defaultSize matches.
      setSidebarWidthPx(sidebarWidthRef.current);
      setCollapsed(false);
      return;
    }
    const panel = sidebarPanelRef.current;
    if (panel) {
      const { inPixels } = panel.getSize();
      if (inPixels >= SIDEBAR_WIDTH_MIN) {
        persistSidebarWidth(inPixels);
        setSidebarWidthPx(inPixels);
      }
    }
    setCollapsed(true);
  }, [persistSidebarWidth, setCollapsed, sidebarCollapsed, sidebarPanelRef]);

  const handleExpandSidebar = useCallback(() => {
    setSidebarWidthPx(sidebarWidthRef.current);
    setCollapsed(false);
  }, [setCollapsed]);

  const headerVariant = pathname === "/"
    ? "list"
    : isSettingsRoute
      ? "settings"
      : "item";

  const mainColumn = (
    <main className="relative flex min-h-0 h-full flex-1 flex-col overflow-hidden">
      <MainScrollArea>
        <div className="box-border flex min-h-full flex-col p-2">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-white shadow-xs dark:bg-neutral-800">
            {showCardHeader ? (
              <Header
                variant={headerVariant}
                onOpenSidebar={() => setIsSidebarOpen(true)}
                sidebarCollapsed={sidebarCollapsed}
                onToggleSidebarCollapse={handleToggleSidebarCollapse}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onAddClick={() => setIsCreateOpen(true)}
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
            <div
              className={`flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-4 md:px-8 ${
                showCardHeader ? "md:pt-6" : "md:pt-8"
              }`}
            >
              <Outlet />
            </div>
            <ItemPanelAdjacentFooter />
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
        refreshVault: () => setVaultRevision((value) => value + 1),
        dashboardCache,
        dashboardSort,
        setDashboardSort,
      }}
    >
      <PanelHeaderProvider>
        <TooltipProvider>
          {isDesktop ? (
            <div
              data-smoke-shell
              className="h-screen overflow-hidden bg-neutral-200 font-sans text-neutral-900 transition-colors duration-200 dark:bg-neutral-900 dark:text-neutral-100"
            >
              <SmokeUiReadyBeacon />
              {sidebarCollapsed ? (
                <div className="flex h-full w-full">
                  <div
                    className="h-full shrink-0 overflow-hidden"
                    style={{ width: SIDEBAR_RAIL_WIDTH_PX }}
                  >
                    <Sidebar
                      variant="docked"
                      isOpen
                      collapsed
                      onRequestExpand={handleExpandSidebar}
                      onClose={() => setIsSidebarOpen(false)}
                      {...sidebarProps}
                    />
                  </div>
                  <div className="min-h-0 min-w-0 flex-1">{mainColumn}</div>
                </div>
              ) : (
                <ResizablePanelGroup
                  orientation="horizontal"
                  className="h-full w-full"
                  onLayoutChanged={(_layout, meta) => {
                    if (!meta.isUserInteraction) {
                      return;
                    }
                    const panel = sidebarPanelRef.current;
                    if (!panel) {
                      return;
                    }
                    // Persist only — do not setState(defaultSize). Updating
                    // defaultSize mid-session re-registers the panel group and
                    // the first drag after expand gets eaten (library #729).
                    persistSidebarWidth(panel.getSize().inPixels);
                  }}
                >
                  <ResizablePanel
                    id="sidebar"
                    panelRef={sidebarPanelRef}
                    defaultSize={sidebarWidthPx}
                    minSize={SIDEBAR_WIDTH_MIN}
                    maxSize={SIDEBAR_WIDTH_MAX}
                    groupResizeBehavior="preserve-pixel-size"
                    className="min-h-0 overflow-hidden"
                  >
                    <Sidebar
                      variant="docked"
                      isOpen
                      collapsed={false}
                      onRequestExpand={handleExpandSidebar}
                      onClose={() => setIsSidebarOpen(false)}
                      {...sidebarProps}
                    />
                  </ResizablePanel>
                  <ResizableHandle className="bg-transparent hover:bg-border data-[separator=active]:bg-border focus-visible:ring-0" />
                  <ResizablePanel
                    id="main"
                    minSize="50%"
                    groupResizeBehavior="preserve-relative-size"
                    className="min-h-0"
                  >
                    {mainColumn}
                  </ResizablePanel>
                </ResizablePanelGroup>
              )}
            </div>
          ) : (
            <div
              data-smoke-shell
              className="flex h-screen overflow-hidden bg-neutral-200 font-sans text-neutral-900 transition-colors duration-200 dark:bg-neutral-900 dark:text-neutral-100"
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

        {showAlertStack && (
          <AlertStack>
            {showDashboardLoading && (
              <IndexingStatusAlert label="Загрузка…" />
            )}
            {isMetadataIndexing && (
              <IndexingStatusAlert label={indexingLabel} />
            )}
            {showErrorAlert && dashboardError !== null && (
              <Alert
                tone="danger"
                onDismiss={() => setDismissedError(dashboardError)}
              >
                {dashboardError}
              </Alert>
            )}
            {showUpdateAlert && startupUpdateVersion !== null && (
              <Alert
                tone="info"
                onDismiss={() => setStartupUpdateVersion(null)}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span>Доступно обновление {startupUpdateVersion}.</span>
                  <button
                    type="button"
                    onClick={() => navigate("/settings")}
                    className="rounded-lg border border-indigo-500/40 px-3 py-1 hover:bg-indigo-500/10 transition-colors"
                  >
                    Настройки
                  </button>
                </div>
              </Alert>
            )}
          </AlertStack>
        )}

        {isCreateOpen && (
          <CreateItemDialog
            onClose={() => setIsCreateOpen(false)}
            onCreated={(itemId) => {
              setIsCreateOpen(false);
              setVaultRevision((value) => value + 1);
              navigate(`/item/${itemId}`);
            }}
          />
        )}
      </PanelHeaderProvider>
    </ShellContext.Provider>
  );
}
