/**
 * UI CollectorClient singleton (#169 / epic #142).
 *
 * Default: LocalAdapter (web / service mode off).
 * Tauri cutover (#170) swaps to IPC via {@link setCollectorClient} in
 * `bootstrapServiceModeCutover` before React mounts.
 * Call sites should use {@link getCollectorClient}.
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
export { createIpcAdapter } from "./ipc-adapter";
export { DASHBOARD_PREFETCH_SIZE } from "@collector/api";
