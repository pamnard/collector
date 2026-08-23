import { useCallback, useRef, type RefObject } from "react";
import type {
  Layout,
  LayoutChangedMeta,
  PanelImperativeHandle,
} from "react-resizable-panels";
import { usePanelRef } from "../ui/resizable";

export type UseSidebarPanelResizeInput = {
  sidebarWidthPx: number;
  persistSidebarWidth: (inPixels: number) => void;
};

export type UseSidebarPanelResizeResult = {
  sidebarPanelRef: RefObject<PanelImperativeHandle | null>;
  handleSidebarLayoutChanged: (
    layout: Layout,
    meta: LayoutChangedMeta,
  ) => void;
  handleSidebarPanelResize: (panelSize: { inPixels: number }) => void;
};

export function useSidebarPanelResize({
  sidebarWidthPx,
  persistSidebarWidth,
}: UseSidebarPanelResizeInput): UseSidebarPanelResizeResult {
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

  const handleSidebarPanelResize = useCallback(
    (panelSize: { inPixels: number }) => {
      sidebarSizePxRef.current = panelSize.inPixels;
    },
    [],
  );

  return {
    sidebarPanelRef,
    handleSidebarLayoutChanged,
    handleSidebarPanelResize,
  };
}
