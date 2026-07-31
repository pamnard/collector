import { useCallback, useEffect, useRef, useState } from "react";
import {
  SIDEBAR_WIDTH_MIN,
  readSidebarCollapsed,
  readSidebarWidthPx,
  writeSidebarCollapsed,
  writeSidebarWidthPx,
} from "../lib/sidebar-width";
import type { SidebarMode } from "../types/sidebar-mode";
import { usePanelRef } from "../components/ui/resizable";

export type UseSidebarShellResult = {
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  sidebarWidthPx: number;
  sidebarCollapsed: boolean;
  sidebarPanelRef: ReturnType<typeof usePanelRef>;
  sidebarMode: SidebarMode;
  setSidebarMode: (mode: SidebarMode) => void;
  persistSidebarWidth: (inPixels: number) => void;
  handleToggleSidebarCollapse: () => void;
  handleExpandSidebar: () => void;
};

export function useSidebarShell(pathname: string): UseSidebarShellResult {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sidebarWidthPx, setSidebarWidthPx] = useState(() => readSidebarWidthPx());
  const sidebarWidthRef = useRef(sidebarWidthPx);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readSidebarCollapsed(),
  );
  const sidebarPanelRef = usePanelRef();
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() =>
    pathname === "/settings" ? "settings" : "collections",
  );

  useEffect(() => {
    if (pathname === "/settings") {
      setSidebarMode("settings");
    }
  }, [pathname]);

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

  return {
    isSidebarOpen,
    setIsSidebarOpen,
    sidebarWidthPx,
    sidebarCollapsed,
    sidebarPanelRef,
    sidebarMode,
    setSidebarMode,
    persistSidebarWidth,
    handleToggleSidebarCollapse,
    handleExpandSidebar,
  };
}
