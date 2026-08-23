import {
  createContext,
  useContext,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
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
import { useAppSettings } from "../../context/AppSettingsContext";
import { useJobPermanentFailureAlerts } from "../../hooks/useJobPermanentFailureAlerts";
import { useVaultIndexSyncStatus } from "../../hooks/useVaultIndexSyncStatus";
import { useDerivedCatchUpStatus } from "../../hooks/useDerivedCatchUpStatus";
import {
  isFolderFilter,
  type NavFilter,
  type ViewMode,
} from "../../types/ui";
import { AlertBusProvider } from "../alerts/AlertBusProvider";
import { AlertHost } from "../alerts/AlertHost";
import { TooltipProvider } from "../ui/tooltip";
import {
  ItemChromeProvider,
} from "./item-chrome";
import { AppLayoutMainColumn } from "./AppLayoutMainColumn";
import { AppShellViewport } from "./AppShellViewport";
import { resolveAppLayoutRouteChrome } from "./app-layout-route-chrome";
import type { AppShellSidebarContentProps } from "./app-shell-sidebar-props";
import { useAppLayoutNav } from "./use-app-layout-nav";
import { useSidebarPanelResize } from "./use-sidebar-panel-resize";

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

  const {
    sidebarPanelRef,
    handleSidebarLayoutChanged,
    handleSidebarPanelResize,
  } = useSidebarPanelResize({
    sidebarWidthPx,
    persistSidebarWidth,
  });

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

  const {
    handleFilterSelect,
    handleViewModeChange,
    handleFolderSelectFromHeader,
  } = useAppLayoutNav({
    navigate,
    viewMode,
    activeFilter,
    setActiveFilter,
    setViewMode,
    setSidebarMode,
  });

  const routeChrome = resolveAppLayoutRouteChrome(
    pathname,
    searchParams.get("section"),
  );

  const sidebarContentProps = {
    mode: sidebarMode,
    onModeChange: setSidebarMode,
    activeFilter,
    onFilterSelect: handleFilterSelect,
    vaultRevision,
    searchQuery,
    onSearchChange: setSearchQuery,
    searchIndexBuilding,
    theme,
    onToggleTheme: toggleTheme,
  } satisfies AppShellSidebarContentProps;

  const mainColumn = (
    <AppLayoutMainColumn
      locationKey={locationKey}
      activeFilter={activeFilter}
      viewMode={viewMode}
      routeChrome={routeChrome}
      isDesktop={isDesktop}
      onOpenSidebar={() => setIsSidebarOpen(true)}
      onViewModeChange={handleViewModeChange}
      onAddClick={() =>
        openCreate(
          isFolderFilter(activeFilter) ? activeFilter.folderPath : undefined,
        )
      }
      onFolderSelect={handleFolderSelectFromHeader}
    />
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
          <AppShellViewport
            isDesktop={isDesktop}
            isSidebarOpen={isSidebarOpen}
            sidebarWidthPx={sidebarWidthPx}
            sidebarCollapsed={sidebarCollapsed}
            sidebarPinned={sidebarPinned}
            sidebarContentProps={sidebarContentProps}
            sidebarPanelRef={sidebarPanelRef}
            onSidebarLayoutChanged={handleSidebarLayoutChanged}
            onSidebarPanelResize={handleSidebarPanelResize}
            onToggleSidebarPin={handleToggleSidebarPin}
            onCollapseAfterUse={handleCollapseAfterUse}
            onSidebarModeNavigation={markSidebarModeNavigation}
            onRequestExpand={handleExpandSidebar}
            onCloseSidebar={() => setIsSidebarOpen(false)}
            mainColumn={mainColumn}
          />
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
