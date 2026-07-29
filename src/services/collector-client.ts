/**
 * UI CollectorService singleton (#169 / epic #142 / #369 / #370).
 *
 * Default: LocalAdapter ports (web/dev-mock / tests). Tauri service mode (#170)
 * swaps to IPC before React mounts. LocalAdapter cannot open SQLite (#171).
 * Call sites use {@link getCollectorService} (+ {@link getUiSession}).
 */

import type { CollectorService, UiSession } from "@collector/api";
import {
  createLocalCollectorService,
  createLocalUiSession,
} from "./local-adapter";
import { setUiSession } from "./ui-session";

let activeService: CollectorService = createLocalCollectorService();
let activeSession: UiSession = createLocalUiSession(activeService);
setUiSession(activeSession);

/** Domain ports — primary UI contract (#369). */
export function getCollectorService(): CollectorService {
  return activeService;
}

/** Replace active ports + UiSession (tests / #170 IPC cutover). */
export function setCollectorService(
  service: CollectorService,
  session: UiSession,
): void {
  activeService = service;
  activeSession = session;
  setUiSession(session);
}

export {
  createLocalCollectorService,
  createLocalDashboardSnapshotPort,
  createLocalUiSession,
} from "./local-adapter";
export {
  createIpcCollectorService,
  createIpcDashboardSnapshotPort,
  createIpcUiSession,
} from "./ipc-adapter";
export { getUiSession, setUiSession } from "./ui-session";
export { DASHBOARD_PREFETCH_SIZE } from "@collector/api";
