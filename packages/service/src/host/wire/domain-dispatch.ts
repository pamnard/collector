/**
 * Domain host-wire request handler (#330 / #419).
 *
 * Thin entry: merge domain-group registries + create framed dispatcher.
 * Flat method names remain transitional wire aliases for domain ports (#366).
 *
 * Init policy: each entry that needs a ready session calls
 * `ensureInitialized` **after** param validation (validate-before-init).
 */

import type { ServiceDomainRuntime } from "../domain-runtime.js";
import {
  DOMAIN_WIRE_METHODS,
  type DomainWireHandlerMap,
  type DomainWireMethod,
} from "./domain-methods.js";
import { assertHostPortWireCoverage } from "./domain-port-wire.js";
import type { DomainDispatchEntry } from "./dispatch/types.js";
import { BOOT_DISPATCH } from "./dispatch/boot.js";
import { ITEMS_DISPATCH } from "./dispatch/items.js";
import { TAGS_DISPATCH } from "./dispatch/tags.js";
import { FOLDERS_DISPATCH } from "./dispatch/folders.js";
import { MEDIA_DISPATCH } from "./dispatch/media.js";
import { VAULTS_DISPATCH } from "./dispatch/vaults.js";
import { SETTINGS_DISPATCH } from "./dispatch/settings.js";
import { CREDENTIALS_DISPATCH } from "./dispatch/credentials.js";
import { SYNC_DISPATCH } from "./dispatch/sync.js";
import { DASHBOARD_DISPATCH } from "./dispatch/dashboard.js";
import { WATCHER_DISPATCH } from "./dispatch/watcher.js";

/** Full host registry: every {@link DomainWireMethod} has exactly one entry. */
export const DOMAIN_DISPATCH_REGISTRY: Record<
  DomainWireMethod,
  DomainDispatchEntry
> = {
  ...BOOT_DISPATCH,
  ...ITEMS_DISPATCH,
  ...TAGS_DISPATCH,
  ...FOLDERS_DISPATCH,
  ...MEDIA_DISPATCH,
  ...VAULTS_DISPATCH,
  ...SETTINGS_DISPATCH,
  ...CREDENTIALS_DISPATCH,
  ...SYNC_DISPATCH,
  ...DASHBOARD_DISPATCH,
  ...WATCHER_DISPATCH,
} as Record<DomainWireMethod, DomainDispatchEntry>;

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
    throw new Error(`host wire domain registry coverage (#330): ${parts.join("; ")}`);
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
