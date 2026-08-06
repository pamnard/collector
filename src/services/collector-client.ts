/**
 * UI CollectorService singleton (#169 / epic #142 / #332 / #369 / #370).
 *
 * No default adapter at module load. {@link main} installs DevMock (web) or
 * IPC (Tauri service mode) via bootstrap before React mounts.
 * Call sites use {@link getCollectorService} (+ {@link getUiSession}).
 */

import type { CollectorService, UiSession } from "@collector/api";
import {
  createDevMockCollectorService,
  createDevMockUiSession,
} from "../dev/mock-collector-service";
import { setUiSession } from "./ui-session";

let activeService: CollectorService | null = null;

const NOT_INSTALLED = "CollectorService not installed (#332)";

/** Domain ports — primary UI contract (#369). */
export function getCollectorService(): CollectorService {
  if (!activeService) {
    throw new Error(NOT_INSTALLED);
  }
  return activeService;
}

/** Replace active ports + UiSession (tests / #170 IPC cutover). */
export function setCollectorService(
  service: CollectorService,
  session: UiSession,
): void {
  activeService = service;
  setUiSession(session);
}

/** Web/:1420 + unit-test default (#332). */
export function installDevMockCollectorService(): void {
  const service = createDevMockCollectorService();
  setCollectorService(service, createDevMockUiSession(service));
}

export {
  createDevMockCollectorService,
  createDevMockUiSession,
} from "../dev/mock-collector-service";
export { createUiDashboardSnapshotPort } from "./ui-dashboard-snapshot-port";
export {
  createTauriDesktopCollectorService,
  createTauriDesktopDashboardSnapshotPort,
  createTauriDesktopUiSession,
} from "./tauri-desktop-adapter";
export { getUiSession, setUiSession } from "./ui-session";
export { DASHBOARD_PREFETCH_SIZE } from "@collector/api";
