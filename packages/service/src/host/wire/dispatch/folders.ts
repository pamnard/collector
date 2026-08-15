import { DOMAIN_WIRE_METHODS } from "../domain-methods.js";
import { asObject, requireString } from "../handlers/params.js";
import { defineDispatch } from "./types.js";

const M = DOMAIN_WIRE_METHODS;

/** Folders (#158). */
export const FOLDERS_DISPATCH = defineDispatch({
  [M.listFolderTree]: {
    handle: async (runtime) => {
      await runtime.ensureInitialized();
      return runtime.tagsFolders.listFolderTree();
    },
  },
  [M.createFolder]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.createFolder);
      const folderPath = requireString(
        p.folderPath,
        "folderPath",
        M.createFolder,
      );
      await runtime.ensureInitialized();
      return runtime.tagsFolders.createFolder(folderPath);
    },
  },
  [M.renameFolder]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.renameFolder);
      const oldPath = requireString(p.oldPath, "oldPath", M.renameFolder);
      const newPath = requireString(p.newPath, "newPath", M.renameFolder);
      await runtime.ensureInitialized();
      return runtime.tagsFolders.renameFolder(oldPath, newPath);
    },
  },
  [M.deleteFolder]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.deleteFolder);
      const folderPath = requireString(
        p.folderPath,
        "folderPath",
        M.deleteFolder,
      );
      await runtime.ensureInitialized();
      await runtime.tagsFolders.deleteFolder(folderPath);
      return { ok: true };
    },
  },
  [M.moveItemToFolderPath]: {
    handle: async (runtime, params) => {
      const p = asObject(params, M.moveItemToFolderPath);
      const itemId = requireString(p.itemId, "itemId", M.moveItemToFolderPath);
      const folderPath = requireString(
        p.folderPath,
        "folderPath",
        M.moveItemToFolderPath,
      );
      await runtime.ensureInitialized();
      return runtime.tagsFolders.moveItemToFolderPath(itemId, folderPath);
    },
  },
});
