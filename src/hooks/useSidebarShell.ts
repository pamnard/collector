import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
  isSidebarResizing: boolean;
  handleSidebarResizePointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
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
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const sidebarResizeStartRef = useRef<{ x: number; width: number } | null>(
    null,
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
    isSidebarResizing,
    handleSidebarResizePointerDown,
    handleToggleSidebarPin,
    handleExpandSidebar,
    handleCollapseAfterUse,
    markSidebarModeNavigation,
  };
}
