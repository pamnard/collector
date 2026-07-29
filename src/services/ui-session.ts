/**
 * App UiSession singleton (#368 / #363) — snapshot, sync settings, thumbnails.
 * Not the sole-writer host contract.
 *
 * Initialized from {@link setCollectorService} / module bootstrap in collector-client.
 */

import type { CollectorServiceApi, UiSession } from "@collector/api";
import { toUiSession } from "@collector/api";

let activeSession: UiSession | null = null;

export function getUiSession(): UiSession {
  if (!activeSession) {
    throw new Error("UiSession not initialized; call setCollectorService first");
  }
  return activeSession;
}

/** Replace the active session (tests / #170 IPC cutover). */
export function setUiSession(session: UiSession): void {
  activeSession = session;
}

export function createUiSessionFromFlat(flat: CollectorServiceApi): UiSession {
  return toUiSession(flat);
}
