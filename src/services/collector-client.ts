/**
 * UI CollectorClient singleton (#169 / epic #142).
 *
 * Default implementation is {@link createLocalAdapter} (in-process).
 * Call sites should use {@link getCollectorClient} — not `collector-service`
 * / settings / snapshot modules directly. Swap via {@link setCollectorClient}
 * at cutover (#170).
 */

import type { CollectorServiceApi } from "@collector/api";
import { createLocalAdapter } from "./local-adapter";

export type CollectorClient = CollectorServiceApi;

let activeClient: CollectorClient = createLocalAdapter();

export function getCollectorClient(): CollectorClient {
  return activeClient;
}

/** Replace the active client (tests / #170 IPC cutover). */
export function setCollectorClient(client: CollectorClient): void {
  activeClient = client;
}

export function createCollectorClient(
  adapter: CollectorClient = createLocalAdapter(),
): CollectorClient {
  return adapter;
}

export { createLocalAdapter } from "./local-adapter";
export { DASHBOARD_PREFETCH_SIZE } from "@collector/api";
