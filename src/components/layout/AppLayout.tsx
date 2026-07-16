import { createContext, useCallback, useContext, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { CreateItemDialog } from "../items/CreateItemDialog";
import { useNavState } from "../../hooks/useNavState";
import { useTheme } from "../../hooks/useTheme";
import {
  useCheckUpdatesOnStart,
  useStartupUpdateCheck,
} from "../../hooks/useUpdaterSettings";
import { useViewMode } from "../../hooks/useViewMode";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useDashboardItems } from "../../hooks/useDashboardItems";
import { useVaultIndexSyncStatus } from "../../hooks/useVaultIndexSyncStatus";
import { formatIndexingBannerLabel } from "@collector/core";
import type { NavFilter, ViewMode } from "../../types/ui";
import { Alert } from "../alerts/Alert";
import { AlertStack } from "../alerts/AlertStack";
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [vaultRevision, setVaultRevision] = useState(0);
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

  const handleStartupUpdateFound = useCallback((version: string) => {
    setStartupUpdateVersion(version);
  }, []);

  useStartupUpdateCheck(checkUpdatesOnStart, handleStartupUpdateFound);

  // Cache dashboard items across navigation to prevent flashing empty grid
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const dashboardCache = useDashboardItems(
    activeFilter,
    debouncedSearch,
    vaultRevision,
  );

  const indexingLabel = formatIndexingBannerLabel(indexSync);
  const dashboardError = dashboardCache.error;
  const showErrorAlert =
    dashboardError !== null && dashboardError !== dismissedError;
  const showAlertStack = isMetadataIndexing || showErrorAlert;

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
      <div className="flex h-screen overflow-hidden bg-main font-sans text-primary transition-colors duration-200">
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          activeFilter={activeFilter}
          onFilterSelect={setActiveFilter}
          vaultRevision={vaultRevision}
        />

        <main className="relative flex min-h-0 flex-1 overflow-hidden bg-main transition-colors duration-200">
          <MainScrollArea>
            <div className="sticky top-0 z-40">
              {/* Non-sticky plate: WebKit drops backdrop-filter on position:sticky (#86). */}
              <div
                aria-hidden
                className="nav-frost pointer-events-none absolute inset-0"
              />
              <div className="relative">
                <Header
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onOpenSidebar={() => setIsSidebarOpen(true)}
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  onAddClick={() => setIsCreateOpen(true)}
                  theme={theme}
                  onToggleTheme={toggleTheme}
                  searchIndexBuilding={searchIndexBuilding}
                />

                {startupUpdateVersion && (
                  <div className="flex items-center justify-between gap-3 border-b border-indigo-500/30 bg-indigo-500/10 px-4 py-2 text-sm">
                    <span>Доступно обновление {startupUpdateVersion}.</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => navigate("/settings")}
                        className="rounded-lg border border-indigo-500/40 px-3 py-1 hover:bg-indigo-500/10 transition-colors"
                      >
                        Настройки
                      </button>
                      <button
                        type="button"
                        onClick={() => setStartupUpdateVersion(null)}
                        className="text-secondary hover:text-primary transition-colors"
                        aria-label="Скрыть"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <Outlet />
          </MainScrollArea>
        </main>
      </div>

      {showAlertStack && (
        <AlertStack>
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
