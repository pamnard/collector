export type {
  CreateVaultInput,
  FileSystemAdapter,
  IndexedItem,
  SyncReport,
  UpsertItemInput,
  VaultContext,
  VaultIndexAdapter,
} from "./adapters/types.js";

export {
  itemContentPath,
  itemMediaRoot,
  itemMetaPath,
  itemRoot,
  itemSourcePath,
  itemsRoot,
  joinSegments,
  vaultMetaPath,
  vaultsRoot,
  vaultRoot,
} from "./vault/paths.js";

export {
  readItemContent,
  readItemFile,
  readItemSourceRef,
  readVaultMeta,
  writeItemContent,
  writeItemFile,
  writeItemSourceRef,
  writeVaultMeta,
} from "./vault/item-io.js";

export {
  createVault,
  deleteItem,
  listItemsOnDisk,
  syncIndexFromFilesystem,
  upsertItem,
} from "./vault/operations.js";

export { SqlVaultIndexAdapter, SqlVaultIndexStore } from "./index/sql-index.js";
export type { SqlSelector } from "./index/sql-index.js";

export { createId, nowIso } from "./util/ids.js";
