/**
 * UI CollectorService singleton (#169 / epic #142 / #369).
 *
 * Default: LocalAdapter ports (web/dev-mock / tests). Tauri service mode (#170)
 * swaps to IPC before React mounts. LocalAdapter cannot open SQLite (#171).
 * Call sites should use {@link getCollectorService} (+ {@link getUiSession}).
 * Flat {@link getCollectorClient} remains a transitional shim until #370.
 */

import type { CollectorService, CollectorServiceApi, UiSession } from "@collector/api";
import { toCollectorService, toCollectorServiceApi, toUiSession } from "@collector/api";
import {
  createLocalAdapter,
  createLocalCollectorService,
  createLocalUiSession,
} from "./local-adapter";
import { setUiSession } from "./ui-session";

export type CollectorClient = CollectorServiceApi;

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

/**
 * @deprecated Prefer {@link getCollectorService} (#369). Flat mega-interface
 * until #370.
 */
export function getCollectorClient(): CollectorClient {
  return toCollectorServiceApi(activeService, activeSession.snapshot);
}

/**
 * @deprecated Prefer {@link setCollectorService} (#369).
 * Lifts a flat facade into ports + UiSession.
 */
export function setCollectorClient(client: CollectorClient): void {
  setCollectorService(toCollectorService(client), toUiSession(client));
}

/** @deprecated Prefer {@link createLocalCollectorService} (#369). */
export function createCollectorClient(
  adapter: CollectorClient = createLocalAdapter(),
): CollectorClient {
  return adapter;
}

export {
  createLocalAdapter,
  createLocalCollectorService,
  createLocalDashboardSnapshotPort,
  createLocalUiSession,
} from "./local-adapter";
export {
  createIpcAdapter,
  createIpcCollectorService,
  createIpcDashboardSnapshotPort,
  createIpcUiSession,
} from "./ipc-adapter";
export { getUiSession, setUiSession, createUiSessionFromFlat } from "./ui-session";
export { DASHBOARD_PREFETCH_SIZE } from "@collector/api";
