/**
 * Domain host-wire request handler (#330).
 *
 * One locality: validate params + call {@link ServiceDomainRuntime}.
 * Flat method names remain transitional wire aliases for domain ports (#366).
 *
 * Init policy: each entry that needs a ready session calls
 * `ensureInitialized` **after** param validation (validate-before-init).
 */

import type { ServiceDomainRuntime } from "../domain-runtime.js";
import {
  type DomainWireHandlerMap,
  type DomainWireMethod,
} from "./domain-methods.js";
import { assertHostPortWireCoverage } from "./domain-port-wire.js";
import { DOMAIN_DISPATCH_REGISTRY } from "./domain-dispatch/registry.js";

export { DOMAIN_DISPATCH_REGISTRY } from "./domain-dispatch/registry.js";
export type { DomainDispatchEntry } from "./domain-dispatch/types.js";

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
