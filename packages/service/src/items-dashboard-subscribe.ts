/**
 * Dashboard load subscription + throttled republish (#384).
 */

import {
  DASHBOARD_PREFETCH_SIZE,
  asCollectorApiError,
  subscriptionFromTeardown,
  type DashboardItemSort,
  type DashboardLoadHandlers,
  type NavFilter,
  type Subscription,
} from "@collector/api";
import {
  assertDashboardItemSort,
  queryDashboardIndexPage,
} from "./dashboard-index-page.js";
import type { ItemsSearchServiceDeps } from "./items-search.js";

export function createThrottledPublisher(
  fn: () => void,
  intervalMs: number,
): { schedule: () => void; flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRun = 0;

  const run = () => {
    lastRun = Date.now();
    fn();
  };

  return {
    schedule() {
      const elapsed = Date.now() - lastRun;
      if (elapsed >= intervalMs) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        run();
        return;
      }
      if (timer) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        run();
      }, intervalMs - elapsed);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      run();
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

export function subscribeDashboardLoad(
  deps: ItemsSearchServiceDeps,
  republishMs: number,
  filter: NavFilter,
  query: string,
  handlers: DashboardLoadHandlers,
  signal?: AbortSignal,
  sort?: DashboardItemSort,
): Subscription {
  const resolvedSort = assertDashboardItemSort(sort);
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }
  const activeSignal = controller.signal;
  void (async () => {
    const { vault, path } = await deps.resolveActiveVault();
    if (activeSignal.aborted) {
      return;
    }

    const publishPage = async (pageRequest: {
      limit: number;
      offset: number;
    }) => {
      try {
        const page = await queryDashboardIndexPage(
          deps.getIndex(),
          deps.buildSearchFtsQuery,
          vault.id,
          filter,
          query,
          pageRequest,
          resolvedSort,
        );
        if (!activeSignal.aborted) {
          handlers.onIndexPage(page);
        }
      } catch (error: unknown) {
        handlers.onError?.(
          "dashboard index page",
          asCollectorApiError(error),
        );
        if (!activeSignal.aborted) {
          handlers.onIndexPage({ itemIds: [], totalCount: 0, offset: 0 });
        }
      }
    };

    const republish = createThrottledPublisher(() => {
      const loaded = handlers.getLoadedIdCount?.() ?? DASHBOARD_PREFETCH_SIZE;
      void publishPage({
        offset: 0,
        limit: Math.max(loaded, DASHBOARD_PREFETCH_SIZE),
      });
    }, republishMs);

    const unsub = deps.addVaultSyncListener(vault.id, {
      onBatch: () => {
        republish.schedule();
      },
      onComplete: () => {
        republish.flush();
      },
    });

    const onAbort = () => {
      republish.cancel();
      unsub();
    };
    activeSignal.addEventListener("abort", onAbort, { once: true });

    deps.kickoffVaultIndexSync(vault.id, path);

    await publishPage({ offset: 0, limit: DASHBOARD_PREFETCH_SIZE });
    if (!activeSignal.aborted) {
      handlers.onLoadComplete?.();
    }
  })().catch((error: unknown) => {
    handlers.onError?.("dashboard load", asCollectorApiError(error));
  });
  return subscriptionFromTeardown(() => controller.abort());
}
