import { useCallback, useEffect, useRef, useState } from "react";
import {
  SIDEBAR_WIDTH_MIN,
  clampSidebarWidthPx,
  readSidebarPinned,
  readSidebarWidthPx,
  writeSidebarPinned,
  writeSidebarWidthPx,
} from "../lib/sidebar-width";
import type { SidebarMode } from "../types/sidebar-mode";

export type UseSidebarShellResult = {
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  sidebarWidthPx: number;
  setSidebarWidthPx: (widthPx: number) => void;
  sidebarCollapsed: boolean;
  sidebarPinned: boolean;
  sidebarMode: SidebarMode;
  setSidebarMode: (mode: SidebarMode) => void;
  persistSidebarWidth: (inPixels: number) => void;
  handleToggleSidebarPin: () => void;
  handleExpandSidebar: () => void;
  handleCollapseAfterUse: () => void;
  /**
   * Before a rail-driven mode switch that also navigates (settings ↔ app).
   * Keeps the panel open so the user can pick an entry; any other navigation collapses.
   */
  markSidebarModeNavigation: () => void;
};

export function useSidebarShell(
  pathname: string,
  locationKey: string,
): UseSidebarShellResult {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sidebarWidthPx, setSidebarWidthPxState] = useState(() =>
    readSidebarWidthPx(),
  );
  const sidebarWidthRef = useRef(sidebarWidthPx);
  const [sidebarPinned, setSidebarPinned] = useState(() => readSidebarPinned());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => !readSidebarPinned(),
  );
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() =>
    pathname === "/settings" ? "settings" : "collections",
  );

  const pinnedRef = useRef(sidebarPinned);
  const collapsedRef = useRef(sidebarCollapsed);
  pinnedRef.current = sidebarPinned;
  collapsedRef.current = sidebarCollapsed;

  const skipNavCollapseRef = useRef(false);
  const isFirstLocationEffectRef = useRef(true);

  useEffect(() => {
    if (pathname === "/settings") {
      setSidebarMode("settings");
    }
  }, [pathname]);

  const setSidebarWidthPx = useCallback((widthPx: number) => {
    const next = clampSidebarWidthPx(widthPx);
    sidebarWidthRef.current = next;
    setSidebarWidthPxState(next);
  }, []);

  const persistSidebarWidth = useCallback((inPixels: number) => {
    if (inPixels < SIDEBAR_WIDTH_MIN) {
      return;
    }
    const next = clampSidebarWidthPx(inPixels);
    sidebarWidthRef.current = next;
    writeSidebarWidthPx(next);
    setSidebarWidthPxState(next);
  }, []);

  const collapseToRail = useCallback(() => {
    setSidebarCollapsed(true);
  }, []);

  const handleExpandSidebar = useCallback(() => {
    setSidebarWidthPxState(sidebarWidthRef.current);
    setSidebarCollapsed(false);
  }, []);

  const handleToggleSidebarPin = useCallback(() => {
    setSidebarPinned((prev) => {
      const next = !prev;
      writeSidebarPinned(next);
      if (next) {
        setSidebarWidthPxState(sidebarWidthRef.current);
        setSidebarCollapsed(false);
      }
      return next;
    });
  }, []);

  const handleCollapseAfterUse = useCallback(() => {
    if (sidebarPinned) {
      return;
    }
    collapseToRail();
  }, [collapseToRail, sidebarPinned]);

  const markSidebarModeNavigation = useCallback(() => {
    skipNavCollapseRef.current = true;
  }, []);

  // Unpinned + expanded: every router navigation collapses (any link / adjacent / search hit).
  useEffect(() => {
    if (isFirstLocationEffectRef.current) {
      isFirstLocationEffectRef.current = false;
      return;
    }
    if (skipNavCollapseRef.current) {
      skipNavCollapseRef.current = false;
      return;
    }
    if (pinnedRef.current || collapsedRef.current) {
      return;
    }
    collapseToRail();
  }, [locationKey, collapseToRail]);

  return {
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
  };
}
