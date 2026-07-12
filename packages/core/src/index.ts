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
  listItemsByIds,
  listItemsOnDisk,
  syncIndexFromFilesystem,
  upsertItem,
} from "./vault/operations.js";

export { buildFtsMatchQuery } from "./search/fts-query.js";
export type { NavSearchFilter } from "./search/types.js";

export { SqlVaultIndexAdapter, SqlVaultIndexStore } from "./index/sql-index.js";
export type { SqlSelector } from "./index/sql-index.js";

export { createId, nowIso } from "./util/ids.js";
