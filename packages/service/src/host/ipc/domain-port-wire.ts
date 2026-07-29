/**
 * Port → flat wire method map for the IPC host (#366).
 *
 * Flat camelCase names in {@link DOMAIN_IPC_METHODS} are transitional aliases
 * for domain port methods. Source of truth for method names is `*_PORT_KEYS`
 * from `@collector/api` — not the app flat mega-checklist.
 */

import {
  BOOT_PORT_KEYS,
  DASHBOARD_SNAPSHOT_PORT_KEYS,
  FOLDERS_PORT_KEYS,
  INDEX_PORT_KEYS,
  ITEMS_PORT_KEYS,
  MEDIA_PORT_KEYS,
  SETTINGS_PORT_KEYS,
  TAGS_PORT_KEYS,
  VAULTS_PORT_KEYS,
} from "@collector/api";
import { DOMAIN_IPC_METHODS, type DomainIpcHandlerMap } from "./domain-methods.js";

/**
 * Port methods implemented only on the IPC client (orchestration / sync cache).
 * They must not be required as host handlers.
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
  ...DASHBOARD_SNAPSHOT_PORT_KEYS,
] as const;

/**
 * Port methods that must have a flat host handler (wire RPC).
 * = port keys minus client-orchestrated methods.
 */
export const HOST_WIRE_PORT_METHODS = ALL_PORT_METHOD_KEYS.filter(
  (key) => !CLIENT_ORCHESTRATED.has(key),
);

export type HostWirePortMethod = (typeof HOST_WIRE_PORT_METHODS)[number];

const DOMAIN_METHOD_SET = new Set<string>(Object.values(DOMAIN_IPC_METHODS));

/**
 * Assert every host-wire port method is registered in DOMAIN_IPC_METHODS
 * and (when handlers are provided) in the handler map.
 */
export function assertHostPortWireCoverage(
  handlers?: DomainIpcHandlerMap,
): void {
  const missingFromCatalog: string[] = [];
  const missingFromHandlers: string[] = [];

  for (const method of HOST_WIRE_PORT_METHODS) {
    if (!DOMAIN_METHOD_SET.has(method)) {
      missingFromCatalog.push(method);
    }
    if (handlers && typeof handlers[method] !== "function") {
      missingFromHandlers.push(method);
    }
  }

  if (missingFromCatalog.length > 0 || missingFromHandlers.length > 0) {
    const parts: string[] = [];
    if (missingFromCatalog.length > 0) {
      parts.push(
        `missing from DOMAIN_IPC_METHODS: ${missingFromCatalog.join(", ")}`,
      );
    }
    if (missingFromHandlers.length > 0) {
      parts.push(
        `missing host handlers: ${missingFromHandlers.join(", ")}`,
      );
    }
    throw new Error(`IPC host port→wire coverage (#366): ${parts.join("; ")}`);
  }
}
