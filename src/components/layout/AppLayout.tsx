import { createContext, useContext, useState } from "react";
import { Outlet } from "react-router-dom";
import { useNavState } from "../../hooks/useNavState";
import { useTheme } from "../../hooks/useTheme";
import { useViewMode } from "../../hooks/useViewMode";
import type { NavFilter, ViewMode } from "../../types/ui";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

interface ShellContextValue {
  viewMode: ViewMode;
  searchQuery: string;
  activeFilter: NavFilter;
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const {
    activeFilter,
    setActiveFilter,
    searchQuery,
    setSearchQuery,
  } = useNavState();
  const { viewMode, setViewMode } = useViewMode();
  const { theme, toggleTheme } = useTheme();

  return (
    <ShellContext.Provider value={{ viewMode, searchQuery, activeFilter }}>
      <div className="flex h-screen bg-main text-primary font-sans overflow-hidden transition-colors duration-200">
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          activeFilter={activeFilter}
          onFilterSelect={setActiveFilter}
        />

        <main className="flex-1 flex flex-col w-full overflow-hidden bg-main transition-colors duration-200 relative">
          <Header
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onOpenSidebar={() => setIsSidebarOpen(true)}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onAddClick={() => undefined}
            theme={theme}
            onToggleTheme={toggleTheme}
          />

          <div className="flex-1 overflow-y-auto main-scrollbar pt-16">
            <Outlet />
          </div>
        </main>
      </div>
    </ShellContext.Provider>
  );
}
