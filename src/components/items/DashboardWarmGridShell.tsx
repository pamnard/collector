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

  // Once per shell mount (#871). Controller outlives the shell in AppLayout —
  // one-shot must live here so item→list remount re-probes sticky nulls.
  const stickyNullProbeDoneRef = useRef(false);
  useEffect(() => {
    if (dashboard.isLoading || dashboard.items.length === 0) {
      return;
    }
    if (stickyNullProbeDoneRef.current) {
      return;
    }
    stickyNullProbeDoneRef.current = true;
    dashboard.probeStickyNulls(dashboard.items);
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
