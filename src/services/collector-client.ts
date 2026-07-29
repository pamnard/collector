/**
 * UI CollectorClient singleton (#169 / epic #142).
 *
 * Default: LocalAdapter (web/dev-mock / tests). Tauri service mode (#170)
 * swaps to IPC before React mounts. LocalAdapter cannot open SQLite (#171).
 * Call sites should use {@link getCollectorClient}.
 * UI-only slices: {@link getUiSession} (#368).
 */

import type { CollectorServiceApi } from "@collector/api";
import { toUiSession } from "@collector/api";
import { createLocalAdapter } from "./local-adapter";
import { setUiSession } from "./ui-session";

export type CollectorClient = CollectorServiceApi;

let activeClient: CollectorClient = createLocalAdapter();
setUiSession(toUiSession(activeClient));

export function getCollectorClient(): CollectorClient {
  return activeClient;
}

/** Replace the active client (tests / #170 IPC cutover). Keeps UiSession in sync. */
export function setCollectorClient(client: CollectorClient): void {
  activeClient = client;
  setUiSession(toUiSession(client));
}

export function createCollectorClient(
  adapter: CollectorClient = createLocalAdapter(),
): CollectorClient {
  return adapter;
}

export {
  createLocalAdapter,
  createLocalCollectorService,
  createLocalDashboardSnapshotPort,
} from "./local-adapter";
export {
  createIpcAdapter,
  createIpcCollectorService,
  createIpcDashboardSnapshotPort,
} from "./ipc-adapter";
export { getUiSession, setUiSession, createUiSessionFromFlat } from "./ui-session";
export { DASHBOARD_PREFETCH_SIZE } from "@collector/api";
