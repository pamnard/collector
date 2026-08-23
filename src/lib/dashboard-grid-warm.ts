/** Off-screen masonry warm decode while table view is active (#779). */

let warmActive = false;
const listeners = new Set<() => void>();

export function isDashboardGridWarmActive(): boolean {
  return warmActive;
}

/** Notify subscribers on warm transitions so useSyncExternalStore stays in sync. */
export function setDashboardGridWarmActive(active: boolean): void {
  if (warmActive === active) {
    return;
  }
  warmActive = active;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeDashboardGridWarm(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
