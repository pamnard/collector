/**
 * Domain host-wire request handler (#330).
 *
 * Thin entry: merge domain-group registries, then dispatch.
 * Flat method names remain transitional wire aliases for domain ports (#366).
 *
 * Init policy: each entry that needs a ready session calls
 * `ensureInitialized` **after** param validation (validate-before-init).
 */

import type { ServiceDomainRuntime } from "../domain-runtime.js";
import {
  type DomainWireHandlerMap,
  type DomainWireMethod,
  DOMAIN_WIRE_METHODS,
} from "./domain-methods.js";
import { assertHostPortWireCoverage } from "./domain-port-wire.js";
import { BOOT_DISPATCH } from "./dispatch/boot.js";
import { CREDENTIALS_DISPATCH } from "./dispatch/credentials.js";
import { DASHBOARD_DISPATCH } from "./dispatch/dashboard.js";
import { FOLDERS_DISPATCH } from "./dispatch/folders.js";
import { ITEMS_DISPATCH } from "./dispatch/items.js";
import { MEDIA_DISPATCH } from "./dispatch/media.js";
import { PLUGINS_DISPATCH } from "./dispatch/plugins.js";
import { SETTINGS_DISPATCH } from "./dispatch/settings.js";
import { STATUS_DISPATCH } from "./dispatch/status.js";
import { TAGS_DISPATCH } from "./dispatch/tags.js";
import type { DomainDispatchEntry } from "./dispatch/types.js";
import { VAULTS_DISPATCH } from "./dispatch/vaults.js";
import { WATCHER_DISPATCH } from "./dispatch/watcher.js";

const DISPATCH_GROUPS: ReadonlyArray<Record<string, DomainDispatchEntry>> = [
  BOOT_DISPATCH,
  ITEMS_DISPATCH,
  TAGS_DISPATCH,
  FOLDERS_DISPATCH,
  MEDIA_DISPATCH,
  VAULTS_DISPATCH,
  SETTINGS_DISPATCH,
  CREDENTIALS_DISPATCH,
  PLUGINS_DISPATCH,
  STATUS_DISPATCH,
  DASHBOARD_DISPATCH,
  WATCHER_DISPATCH,
];

function assertDispatchGroupsDisjoint(): void {
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  for (const [index, group] of DISPATCH_GROUPS.entries()) {
    for (const key of Object.keys(group)) {
      const previous = seen.get(key);
      if (previous !== undefined) {
        duplicates.push(`${key} (groups ${previous} and ${index})`);
      } else {
        seen.set(key, index);
      }
    }
  }
  if (duplicates.length > 0) {
    throw new Error(
      `host wire domain registry overlap (#419): ${duplicates.join(", ")}`,
    );
  }
}

assertDispatchGroupsDisjoint();

/** Full host registry: every {@link DomainWireMethod} has exactly one entry. */
export const DOMAIN_DISPATCH_REGISTRY: Record<
  DomainWireMethod,
  DomainDispatchEntry
> = Object.assign({}, ...DISPATCH_GROUPS);

function assertDomainRegistryCoverage(): void {
  const catalog = new Set<string>(Object.values(DOMAIN_WIRE_METHODS));
  const registryKeys = Object.keys(DOMAIN_DISPATCH_REGISTRY);
  const missingFromRegistry: string[] = [];
  const extraInRegistry: string[] = [];

  for (const method of catalog) {
    if (!(method in DOMAIN_DISPATCH_REGISTRY)) {
      missingFromRegistry.push(method);
    }
  }
  for (const method of registryKeys) {
    if (!catalog.has(method)) {
      extraInRegistry.push(method);
    }
  }

  if (missingFromRegistry.length > 0 || extraInRegistry.length > 0) {
    const parts: string[] = [];
    if (missingFromRegistry.length > 0) {
      parts.push(`missing from registry: ${missingFromRegistry.join(", ")}`);
    }
    if (extraInRegistry.length > 0) {
      parts.push(`extra in registry: ${extraInRegistry.join(", ")}`);
    }
    throw new Error(
      `host wire domain registry coverage (#330): ${parts.join("; ")}`,
    );
  }
}

assertDomainRegistryCoverage();

function handlersFromRegistry(
  runtime: ServiceDomainRuntime,
): DomainWireHandlerMap {
  const handlers: DomainWireHandlerMap = {};
  for (const method of Object.keys(
    DOMAIN_DISPATCH_REGISTRY,
  ) as DomainWireMethod[]) {
    const entry = DOMAIN_DISPATCH_REGISTRY[method];
    handlers[method] = async (params?: unknown) =>
      entry.handle(runtime, params);
  }
  return handlers;
}

/**
 * Host request entry: DomainRuntime in → framed dispatch out (#330).
 * Unknown methods return `undefined` (server maps to unknown_method).
 */
export function createDomainWireRequestHandler(
  runtime: ServiceDomainRuntime,
): (method: string, params?: unknown) => Promise<unknown | undefined> {
  assertHostPortWireCoverage(handlersFromRegistry(runtime));

  return async (method, params) => {
    const entry = DOMAIN_DISPATCH_REGISTRY[method as DomainWireMethod];
    if (!entry) {
      return undefined;
    }
    return entry.handle(runtime, params);
  };
}

/**
 * Thin map lookup for tests that inject a custom handler map.
 * Production host uses {@link createDomainWireRequestHandler}.
 */
export function createDomainWireDispatcher(
  handlers: DomainWireHandlerMap,
): (method: string, params?: unknown) => Promise<unknown | undefined> {
  return async (method, params) => {
    const handler = handlers[method];
    if (!handler) {
      return undefined;
    }
    return handler(params);
  };
}
