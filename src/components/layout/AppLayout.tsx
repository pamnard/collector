import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
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
import { useDashboardItems } from "../../hooks/useDashboardItems";
import { useSidebarShell } from "../../hooks/useSidebarShell";
import { useDashboardShellSort } from "../../hooks/useDashboardShellSort";
import { useCreateItemShell } from "../../hooks/useCreateItemShell";
import type { DashboardItemSort } from "@collector/api";
import { useAppSettings } from "../../context/AppSettingsContext";
import { useVaultIndexSyncStatus } from "../../hooks/useVaultIndexSyncStatus";
import {
  SIDEBAR_RAIL_WIDTH_PX,
  clampSidebarWidthPx,
} from "../../lib/sidebar-width";
import { formatIndexingBannerLabel } from "@collector/core";
import { navFilterKey, type NavFilter, type ViewMode } from "../../types/ui";
import { parseSettingsSection } from "../../types/sidebar-mode";
import { cn } from "../../lib/utils";
import { AlertBusProvider, useAlerts } from "../alerts/AlertBusProvider";
import { AlertHost } from "../alerts/AlertHost";
import { TooltipProvider } from "../ui/tooltip";
import { SmokeUiReadyBeacon } from "../startup/SmokeUiReadyBeacon";
import { Header } from "./Header";
import { IndexingStatusMessage } from "../alerts/IndexingStatusMessage";
import { MainScrollArea } from "./MainScrollArea";
import {
  ItemChromeAdjacentFooter,
  ItemChromeProvider,
} from "./item-chrome";
import { Sidebar } from "./Sidebar";

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
  const [vaultRevision, setVaultRevision] = useState(0);
  const bumpVaultRevision = useCallback(() => {
    setVaultRevision((value) => value + 1);
  }, []);

  const {
    isSidebarOpen,
    setIsSidebarOpen,
    sidebarWidthPx,
    setSidebarWidthPx,
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

  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const sidebarResizeStartRef = useRef<{ x: number; width: number } | null>(
    null,
  );

  const handleSidebarResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (sidebarCollapsed) {
        return;
      }
      event.preventDefault();
      sidebarResizeStartRef.current = {
        x: event.clientX,
        width: sidebarWidthPx,
      };
      setIsSidebarResizing(true);
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      const onMove = (moveEvent: PointerEvent) => {
        const start = sidebarResizeStartRef.current;
        if (!start) {
          return;
        }
        setSidebarWidthPx(start.width + (moveEvent.clientX - start.x));
      };

      const onUp = (upEvent: PointerEvent) => {
        const start = sidebarResizeStartRef.current;
        sidebarResizeStartRef.current = null;
        setIsSidebarResizing(false);
        target.releasePointerCapture(upEvent.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (!start) {
          return;
        }
        persistSidebarWidth(
          clampSidebarWidthPx(start.width + (upEvent.clientX - start.x)),
        );
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [
      persistSidebarWidth,
      setSidebarWidthPx,
      sidebarCollapsed,
      sidebarWidthPx,
    ],
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
  const { isCreateOpen, openCreate, closeCreate, handleCreated } =
    useCreateItemShell({ bumpVaultRevision, navigate });

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
  const alerts = useAlerts();

  useEffect(() => {
    if (showDashboardLoading) {
      alerts.upsert("layout-dashboard-loading", {
        tone: "warning",
        dismissible: false,
        message: <IndexingStatusMessage label="Загрузка…" />,
      });
    } else {
      alerts.dismiss("layout-dashboard-loading");
    }
  }, [alerts, showDashboardLoading]);

  useEffect(() => {
    if (isMetadataIndexing) {
      alerts.upsert("layout-indexing", {
        tone: "warning",
        dismissible: false,
        message: <IndexingStatusMessage label={indexingLabel} />,
      });
    } else {
      alerts.dismiss("layout-indexing");
    }
  }, [alerts, indexingLabel, isMetadataIndexing]);

  useEffect(() => {
    if (showErrorAlert && dashboardError !== null) {
      alerts.upsert("layout-dashboard-error", {
        tone: "danger",
        message: dashboardError,
        onDismiss: () => setDismissedError(dashboardError),
      });
    } else {
      alerts.dismiss("layout-dashboard-error");
    }
  }, [alerts, dashboardError, showErrorAlert]);

  useEffect(() => {
    if (!showUpdateAlert || startupUpdateVersion === null) {
      alerts.dismiss("layout-update");
      return;
    }
    alerts.upsert("layout-update", {
      tone: "info",
      message: (
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
      ),
      onDismiss: () => setStartupUpdateVersion(null),
    });
  }, [alerts, navigate, showUpdateAlert, startupUpdateVersion]);

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
  const mainColumn = (
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
                onAddClick={openCreate}
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
              className={`flex-1 px-4 pt-4 md:px-8 ${
                showCardHeader ? "md:pt-6" : "md:pt-8"
              }`}
            >
              <Outlet />
            </div>
            <ItemChromeAdjacentFooter />
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
        />
      </ItemChromeProvider>
    </ShellContext.Provider>
  );
}
