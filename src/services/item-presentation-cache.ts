/**
 * Client-side copies of ItemFile presentation fields (title, …).
 * Vault/index remain source of truth; UI lists/teasers hold hydrated copies.
 *
 * Call {@link invalidateItemPresentationCache} on known mutations so every
 * surface re-reads from the host. When a second presentation cache appears
 * (e.g. related-item teasers), clear it inside this function — same seam.
 */
import { clearDashboardQueryCache } from "./dashboard-query-cache.ts";

export function invalidateItemPresentationCache(): void {
  clearDashboardQueryCache();
}
