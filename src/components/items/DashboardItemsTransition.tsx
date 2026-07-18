import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";

interface DashboardItemsTransitionProps {
  isRefreshing: boolean;
  transitionEpoch: number;
  children: ReactNode;
}

/**
 * While refreshing: previous set stays on screen, dimmed + spinner.
 * When a new set commits (epoch bump): swap to the prepared set and fade it in.
 */
export function DashboardItemsTransition({
  isRefreshing,
  transitionEpoch,
  children,
}: DashboardItemsTransitionProps) {
  const [layer, setLayer] = useState<ReactNode>(children);
  const [opacity, setOpacity] = useState(1);

  useLayoutEffect(() => {
    if (transitionEpoch === 0) {
      setLayer(children);
      setOpacity(1);
      return;
    }

    setLayer(children);
    setOpacity(0);
    const timer = setTimeout(() => {
      setOpacity(1);
    }, 40);
    return () => clearTimeout(timer);
    // children applied on epoch bump only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transitionEpoch]);

  useEffect(() => {
    if (isRefreshing) {
      return;
    }
    setLayer(children);
    setOpacity(1);
  }, [children, isRefreshing]);

  return (
    <div className="relative">
      <div
        className={`transition-opacity duration-300 ease-out ${
          isRefreshing ? "pointer-events-none opacity-40" : ""
        }`}
        style={isRefreshing ? undefined : { opacity }}
      >
        {layer}
      </div>
      {isRefreshing && (
        <div className="pointer-events-none absolute inset-0 z-[1] flex items-start justify-center pt-24">
          <div
            className="h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-500"
            role="status"
            aria-label="Загрузка"
          />
        </div>
      )}
    </div>
  );
}
