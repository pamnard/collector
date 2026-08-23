import type { ReactNode, RefObject } from "react";
import type {
  Layout,
  LayoutChangedMeta,
  PanelImperativeHandle,
} from "react-resizable-panels";
import {
  SIDEBAR_RAIL_WIDTH_PX,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from "../../lib/sidebar-width";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../ui/resizable";
import { SmokeUiReadyBeacon } from "../startup/SmokeUiReadyBeacon";
import { Sidebar } from "./Sidebar";
import type { AppShellSidebarContentProps } from "./app-shell-sidebar-props";

export type AppShellViewportProps = {
  isDesktop: boolean;
  isSidebarOpen: boolean;
  sidebarWidthPx: number;
  sidebarCollapsed: boolean;
  sidebarPinned: boolean;
  sidebarContentProps: AppShellSidebarContentProps;
  sidebarPanelRef: RefObject<PanelImperativeHandle | null>;
  onSidebarLayoutChanged: (layout: Layout, meta: LayoutChangedMeta) => void;
  onSidebarPanelResize: (panelSize: { inPixels: number }) => void;
  onToggleSidebarPin: () => void;
  onCollapseAfterUse: () => void;
  onSidebarModeNavigation: () => void;
  onRequestExpand: () => void;
  onCloseSidebar: () => void;
  mainColumn: ReactNode;
};

export function AppShellViewport({
  isDesktop,
  isSidebarOpen,
  sidebarWidthPx,
  sidebarCollapsed,
  sidebarPinned,
  sidebarContentProps,
  sidebarPanelRef,
  onSidebarLayoutChanged,
  onSidebarPanelResize,
  onToggleSidebarPin,
  onCollapseAfterUse,
  onSidebarModeNavigation,
  onRequestExpand,
  onCloseSidebar,
  mainColumn,
}: AppShellViewportProps) {
  if (!isDesktop) {
    return (
      <div
        data-smoke-shell
        className="flex h-screen overflow-hidden font-sans text-neutral-900 dark:text-neutral-100"
      >
        <SmokeUiReadyBeacon />
        <Sidebar
          variant="drawer"
          isOpen={isSidebarOpen}
          onClose={onCloseSidebar}
          {...sidebarContentProps}
        />
        {mainColumn}
      </div>
    );
  }

  return (
    <div
      data-smoke-shell
      className="h-screen overflow-hidden font-sans text-neutral-900 dark:text-neutral-100"
    >
      <SmokeUiReadyBeacon />
      {sidebarCollapsed ? (
        <div className="flex h-full w-full">
          <div
            className="h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-linear"
            style={{ width: SIDEBAR_RAIL_WIDTH_PX }}
          >
            <div className="h-full" style={{ width: sidebarWidthPx }}>
              <Sidebar
                variant="docked"
                isOpen
                collapsed
                pinned={sidebarPinned}
                onTogglePin={onToggleSidebarPin}
                onCollapseAfterUse={onCollapseAfterUse}
                onSidebarModeNavigation={onSidebarModeNavigation}
                onRequestExpand={onRequestExpand}
                onClose={onCloseSidebar}
                {...sidebarContentProps}
              />
            </div>
          </div>
          <div className="min-h-0 min-w-0 flex-1">{mainColumn}</div>
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          className="h-full w-full"
          resizeTargetMinimumSize={{ fine: 16, coarse: 24 }}
          onLayoutChanged={onSidebarLayoutChanged}
        >
          <ResizablePanel
            id="app-sidebar"
            panelRef={sidebarPanelRef}
            defaultSize={sidebarWidthPx}
            minSize={SIDEBAR_WIDTH_MIN}
            maxSize={SIDEBAR_WIDTH_MAX}
            groupResizeBehavior="preserve-pixel-size"
            className="h-full min-h-0 overflow-hidden"
            onResize={onSidebarPanelResize}
          >
            <Sidebar
              variant="docked"
              isOpen
              collapsed={false}
              pinned={sidebarPinned}
              onTogglePin={onToggleSidebarPin}
              onCollapseAfterUse={onCollapseAfterUse}
              onSidebarModeNavigation={onSidebarModeNavigation}
              onRequestExpand={onRequestExpand}
              onClose={onCloseSidebar}
              {...sidebarContentProps}
            />
          </ResizablePanel>
          <ResizableHandle aria-label="Изменить ширину сайдбара" />
          <ResizablePanel id="app-main" className="min-h-0 min-w-0">
            {mainColumn}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}
