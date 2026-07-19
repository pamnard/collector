/**
 * Aggregate domain IPC handlers for the service host (#155+).
 */

import type { ServiceDomainRuntime } from "../domain-runtime.js";
import type { DomainIpcHandlerMap } from "./domain-methods.js";
import { buildItemsReadHandlers } from "./handlers/items-read.js";

export function buildDomainIpcHandlers(
  runtime: ServiceDomainRuntime,
): DomainIpcHandlerMap {
  return {
    ...buildItemsReadHandlers(runtime),
  };
}

export function createDomainIpcDispatcher(
  handlers: DomainIpcHandlerMap,
): (method: string, params?: unknown) => Promise<unknown | undefined> {
  return async (method, params) => {
    const handler = handlers[method];
    if (!handler) {
      return undefined;
    }
    return handler(params);
  };
}
