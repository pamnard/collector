import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { CreateItemDialog } from "../items/CreateItemDialog";
import { useNavState } from "../../hooks/useNavState";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useTheme } from "../../hooks/useTheme";
import {
  useCheckUpdatesOnStart,
  useStartupUpdateCheck,
} from "../../hooks/useUpdaterSettings";
import { useViewMode } from "../../hooks/useViewMode";
import { useDashboardItems } from "../../hooks/useDashboardItems";
import { useVaultIndexSyncStatus } from "../../hooks/useVaultIndexSyncStatus";
import {
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  readSidebarWidthPx,
  writeSidebarWidthPx,
} from "../../lib/sidebar-width";
import { formatIndexingBannerLabel } from "@collector/core";
import type { NavFilter, ViewMode } from "../../types/ui";
import type { SidebarMode } from "../../types/sidebar-mode";
import { Alert } from "../alerts/Alert";
import { AlertStack } from "../alerts/AlertStack";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../ui/resizable";
import { TooltipProvider } from "../ui/tooltip";
import { SmokeUiReadyBeacon } from "../startup/SmokeUiReadyBeacon";
import { Header } from "./Header";
import { IndexingStatusAlert } from "./IndexingStatusAlert";
import { MainScrollArea } from "./MainScrollArea";
import { Sidebar } from "./Sidebar";

interface ShellContextValue {
  viewMode: ViewMode;
  searchQuery: string;
  activeFilter: NavFilter;
  vaultRevision: number;
  refreshVault: () => void;
  dashboardCache: ReturnType<typeof useDashboardItems>;
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
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [vaultRevision, setVaultRevision] = useState(0);
  const [sidebarWidthPx] = useState(() => readSidebarWidthPx());
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

  const mainColumn = (
    <main className="relative flex min-h-0 h-full flex-1 flex-col overflow-hidden">
      <MainScrollArea>
        <div className="box-border flex min-h-full flex-col p-2 md:pl-0">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-white shadow-sm dark:bg-neutral-800">
            <Header
              onOpenSidebar={() => setIsSidebarOpen(true)}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onAddClick={() => setIsCreateOpen(true)}
            />
            <Outlet />
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
      }}
    >
      <TooltipProvider>
        {isDesktop ? (
          <div
            data-smoke-shell
            className="h-screen overflow-hidden bg-neutral-200 font-sans text-neutral-900 transition-colors duration-200 dark:bg-neutral-900 dark:text-neutral-100"
          >
            <SmokeUiReadyBeacon />
            <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
              <ResizablePanel
                id="sidebar"
                defaultSize={sidebarWidthPx}
                minSize={`${SIDEBAR_WIDTH_MIN}px`}
                maxSize={`${SIDEBAR_WIDTH_MAX}px`}
                groupResizeBehavior="preserve-pixel-size"
                className="min-h-0"
                onResize={(panelSize) => {
                  writeSidebarWidthPx(panelSize.inPixels);
                }}
              >
                <Sidebar
                  variant="docked"
                  isOpen
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
    </ShellContext.Provider>
  );
}
