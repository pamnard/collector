/**
 * Aggregate domain IPC handlers for the service host (#155+).
 *
 * Flat method names are transitional aliases for domain ports (#366).
 * Coverage vs `*_PORT_KEYS` is asserted by {@link assertHostPortWireCoverage}.
 */

import type { ServiceDomainRuntime } from "../domain-runtime.js";
import type { DomainIpcHandlerMap } from "./domain-methods.js";
import { assertHostPortWireCoverage } from "./domain-port-wire.js";
import { buildItemsReadHandlers } from "./handlers/items-read.js";
import { buildItemsWriteHandlers } from "./handlers/items-write.js";
import { buildTagsHandlers } from "./handlers/tags.js";
import { buildFoldersHandlers } from "./handlers/folders.js";
import { buildMediaHandlers } from "./handlers/media.js";
import { buildVaultsHandlers } from "./handlers/vaults.js";
import { buildSettingsSnapshotHandlers } from "./handlers/settings-snapshot.js";
import { buildIndexBootHandlers } from "./handlers/index-boot.js";
import { buildSyncStatusHandlers } from "./handlers/sync-status.js";
import { buildWatcherHandlers } from "./handlers/watcher.js";

export function buildDomainIpcHandlers(
  runtime: ServiceDomainRuntime,
): DomainIpcHandlerMap {
  // Port-grouped builders; keys remain flat camelCase wire aliases (#366).
  const handlers: DomainIpcHandlerMap = {
    ...buildIndexBootHandlers(runtime),
    ...buildItemsReadHandlers(runtime),
    ...buildItemsWriteHandlers(runtime),
    ...buildTagsHandlers(runtime),
    ...buildFoldersHandlers(runtime),
    ...buildMediaHandlers(runtime),
    ...buildVaultsHandlers(runtime),
    ...buildSettingsSnapshotHandlers(runtime),
    ...buildSyncStatusHandlers(runtime),
    ...buildWatcherHandlers(runtime),
  };
  assertHostPortWireCoverage(handlers);
  return handlers;
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
