/**
 * Aggregate domain IPC handlers for the service host (#155+).
 */

import type { ServiceDomainRuntime } from "../domain-runtime.js";
import type { DomainIpcHandlerMap } from "./domain-methods.js";
import { buildItemsReadHandlers } from "./handlers/items-read.js";
import { buildItemsWriteHandlers } from "./handlers/items-write.js";
import { buildTagsHandlers } from "./handlers/tags.js";
import { buildFoldersHandlers } from "./handlers/folders.js";
import { buildMediaHandlers } from "./handlers/media.js";
import { buildVaultsHandlers } from "./handlers/vaults.js";
import { buildSettingsSnapshotHandlers } from "./handlers/settings-snapshot.js";
import { buildIndexBootHandlers } from "./handlers/index-boot.js";

export function buildDomainIpcHandlers(
  runtime: ServiceDomainRuntime,
): DomainIpcHandlerMap {
  return {
    ...buildIndexBootHandlers(runtime),
    ...buildItemsReadHandlers(runtime),
    ...buildItemsWriteHandlers(runtime),
    ...buildTagsHandlers(runtime),
    ...buildFoldersHandlers(runtime),
    ...buildMediaHandlers(runtime),
    ...buildVaultsHandlers(runtime),
    ...buildSettingsSnapshotHandlers(runtime),
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
