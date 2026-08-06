/**
 * Port → flat wire method map for the host wire (#366 / #330).
 *
 * Flat camelCase names in {@link DOMAIN_WIRE_METHODS} are transitional aliases
 * for domain port methods. Source of truth for method names is `*_PORT_KEYS`
 * from `@collector/api` — not a hand-maintained mega-checklist.
 */

import {
  BOOT_PORT_KEYS,
  CREDENTIALS_PORT_KEYS,
  DASHBOARD_SNAPSHOT_PORT_KEYS,
  FOLDERS_PORT_KEYS,
  INDEX_PORT_KEYS,
  ITEMS_PORT_KEYS,
  MEDIA_PORT_KEYS,
  SETTINGS_PORT_KEYS,
  SYNC_PLUGINS_PORT_KEYS,
  TAGS_PORT_KEYS,
  TELEGRAM_SYNC_PORT_KEYS,
  VAULTS_PORT_KEYS,
} from "@collector/api";
import type { DomainWireHandlerMap } from "./domain-methods.js";

/**
 * Port methods implemented only on the client (orchestration / sync cache).
 * They must not be required as host handlers.
 * Snapshot peek/build stay client-side; ensure/persist/clear + thumb resolve
 * are host wire (#552).
 */
export const CLIENT_ORCHESTRATED_PORT_METHODS = [
  "hydrate",
  "streamDashboardItems",
  "subscribeDashboardLoad",
  "subscribeTags",
  "subscribeFolderTree",
  "subscribeAppSettings",
  "subscribeVaultIndexSyncStatus",
  "getAppSettingsSync",
  "peekMatchingDashboardSnapshot",
  "buildDashboardSnapshot",
] as const;

export type ClientOrchestratedPortMethod =
  (typeof CLIENT_ORCHESTRATED_PORT_METHODS)[number];

const CLIENT_ORCHESTRATED = new Set<string>(CLIENT_ORCHESTRATED_PORT_METHODS);

/** All domain + snapshot port method names from the API contract. */
export const ALL_PORT_METHOD_KEYS = [
  ...BOOT_PORT_KEYS,
  ...ITEMS_PORT_KEYS,
  ...TAGS_PORT_KEYS,
  ...FOLDERS_PORT_KEYS,
  ...MEDIA_PORT_KEYS,
  ...VAULTS_PORT_KEYS,
  ...INDEX_PORT_KEYS,
  ...SETTINGS_PORT_KEYS,
  ...CREDENTIALS_PORT_KEYS,
  ...SYNC_PLUGINS_PORT_KEYS,
  ...TELEGRAM_SYNC_PORT_KEYS,
  ...DASHBOARD_SNAPSHOT_PORT_KEYS,
] as const;

/** Port methods that must have a flat host handler (wire RPC). */
export type HostWirePortMethod = Exclude<
  (typeof ALL_PORT_METHOD_KEYS)[number],
  ClientOrchestratedPortMethod
>;

/**
 * Port methods that must have a flat host handler (wire RPC).
 * = port keys minus client-orchestrated methods.
 */
export const HOST_WIRE_PORT_METHODS = ALL_PORT_METHOD_KEYS.filter(
  (key): key is HostWirePortMethod => !CLIENT_ORCHESTRATED.has(key),
);
/**
 * Assert every host-wire port method is registered in the handler map.
 * Catalog membership of host-wire keys is guaranteed by derivation in
 * {@link DOMAIN_WIRE_METHODS} (#330).
 */
export function assertHostPortWireCoverage(
  handlers?: DomainWireHandlerMap,
): void {
  if (!handlers) {
    return;
  }
  const missingFromHandlers: string[] = [];

  for (const method of HOST_WIRE_PORT_METHODS) {
    if (typeof handlers[method] !== "function") {
      missingFromHandlers.push(method);
    }
  }

  if (missingFromHandlers.length > 0) {
    throw new Error(
      `host port→wire coverage (#366): missing host handlers: ${missingFromHandlers.join(", ")}`,
    );
  }
}
