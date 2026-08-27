import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { useDashboardItems } from "../../hooks/useDashboardItems";
import type { ViewMode } from "../../types/ui";
import { cn } from "../../lib/utils";
import { setDashboardGridWarmActive } from "../../lib/dashboard-grid-warm";
import { ItemGridView } from "./ItemGridView";

interface DashboardWarmGridShellProps {
  viewMode: ViewMode;
  dashboard: ReturnType<typeof useDashboardItems>;
  children: ReactNode;
  className?: string;
  onDragEnter?: React.DragEventHandler<HTMLDivElement>;
  onDragLeave?: React.DragEventHandler<HTMLDivElement>;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
}

const OFFSCREEN_LEFT_PX = -10_000;

/**
 * Keeps masonry in the DOM and laid out while table is active (#779).
 * Fixed off-screen — out of scroll flow (no table row jump), never display:none
 * (no cold remount on table→grid).
 */
export function DashboardWarmGridShell({
  viewMode,
  dashboard,
  children,
  className,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
}: DashboardWarmGridShellProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState<number | null>(null);
  const gridActive = viewMode === "grid";
  const stickyNullProbeDoneRef = useRef(false);

  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) {
      return;
    }
    const update = () => {
      setContentWidth(page.getBoundingClientRect().width);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(page);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useLayoutEffect(() => {
    setDashboardGridWarmActive(!gridActive);
    return () => {
      setDashboardGridWarmActive(false);
    };
  }, [gridActive]);

  // DashboardPage remounts on item→list. Maps can still hold sticky null while
  // cover.webp exists — one probe per mount upgrades those cards (#871).
  useEffect(() => {
    if (dashboard.isLoading || dashboard.items.length === 0) {
      return;
    }
    if (stickyNullProbeDoneRef.current) {
      return;
    }
    stickyNullProbeDoneRef.current = true;
    for (const item of dashboard.items) {
      if (dashboard.thumbnailPaths.get(item.id) === null) {
        dashboard.refreshCoverForItem(item.id);
      }
    }
  }, [dashboard]);

  return (
    <div
      ref={pageRef}
      className={cn("relative pb-20 min-h-full", className)}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        aria-hidden={!gridActive}
        className={cn(
          !gridActive &&
            "pointer-events-none invisible fixed top-0 -z-10",
        )}
        style={
          !gridActive
            ? {
                left: OFFSCREEN_LEFT_PX,
                width: contentWidth ?? undefined,
              }
            : undefined
        }
      >
        <ItemGridView dashboard={dashboard} />
      </div>
      {children}
    </div>
  );
}
