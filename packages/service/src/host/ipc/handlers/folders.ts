/**
 * IPC handlers: folders + move item (#158).
 */

import {
  asObject,
  requireString,
} from "./params.js";
import { DOMAIN_IPC_METHODS } from "../domain-methods.js";
import type { DomainIpcHandlerMap } from "../domain-methods.js";
import type { ServiceDomainRuntime } from "../../domain-runtime.js";

export function buildFoldersHandlers(
  runtime: ServiceDomainRuntime,
): DomainIpcHandlerMap {
  const { tagsFolders } = runtime;
  const M = DOMAIN_IPC_METHODS;

  return {
    [M.listFolderTree]: async () => {
      await runtime.ensureInitialized();
      return tagsFolders.listFolderTree();
    },
    [M.loadFolderTree]: async () => {
      await runtime.ensureInitialized();
      return tagsFolders.loadFolderTree();
    },
    [M.createFolder]: async (params) => {
      const p = asObject(params, M.createFolder);
      const folderPath = requireString(p.folderPath, "folderPath", M.createFolder);
      await runtime.ensureInitialized();
      return tagsFolders.createFolder(folderPath);
    },
    [M.renameFolder]: async (params) => {
      const p = asObject(params, M.renameFolder);
      const oldPath = requireString(p.oldPath, "oldPath", M.renameFolder);
      const newPath = requireString(p.newPath, "newPath", M.renameFolder);
      await runtime.ensureInitialized();
      return tagsFolders.renameFolder(oldPath, newPath);
    },
    [M.deleteFolder]: async (params) => {
      const p = asObject(params, M.deleteFolder);
      const folderPath = requireString(p.folderPath, "folderPath", M.deleteFolder);
      await runtime.ensureInitialized();
      await tagsFolders.deleteFolder(folderPath);
      return { ok: true };
    },
    [M.moveItemToFolderPath]: async (params) => {
      const p = asObject(params, M.moveItemToFolderPath);
      const itemId = requireString(p.itemId, "itemId", M.moveItemToFolderPath);
      const folderPath = requireString(
        p.folderPath,
        "folderPath",
        M.moveItemToFolderPath,
      );
      await runtime.ensureInitialized();
      return tagsFolders.moveItemToFolderPath(itemId, folderPath);
    },
  };
}
