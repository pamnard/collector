import type { CollectorApiError } from "../errors.js";
import type { DashboardIndexPage } from "./items.js";

/** Explicit unsubscribe handle for port subscriptions (#364). */
/** Tear-down handle. Prefer `.unsubscribe()`; also callable for React effect cleanup. */
export type Subscription = (() => void) & { unsubscribe(): void };

export interface DashboardLoadHandlers {
  onIndexPage: (page: DashboardIndexPage) => void;
  getLoadedIdCount?: () => number;
  onLoadComplete?: () => void;
  onError?: (scope: string, error: CollectorApiError) => void;
}

export interface ServiceSubscribeHandlers {
  onError?: (scope: string, error: CollectorApiError) => void;
}
