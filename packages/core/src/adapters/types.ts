import type { ItemFile, SourceRef, VaultMeta } from "@collector/shared";

export interface FileSystemAdapter {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>;
  writeBinary(path: string, content: Uint8Array): Promise<void>;
  mkdir(path: string): Promise<void>;
  readDir(path: string): Promise<string[]>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  join(...parts: string[]): string;
}

export interface IndexedItem {
  item: ItemFile;
  content: string | null;
  sourceRef: SourceRef | null;
}

export interface VaultIndexAdapter {
  upsertVault(meta: VaultMeta, vaultPath: string): Promise<void>;
  deleteVault(vaultId: string): Promise<void>;
  upsertItem(record: IndexedItem, vaultId: string): Promise<void>;
  deleteItem(itemId: string): Promise<void>;
  listVaultItemIds(vaultId: string): Promise<string[]>;
}

export interface VaultContext {
  fs: FileSystemAdapter;
  index: VaultIndexAdapter;
}

export interface CreateVaultInput {
  name: string;
  description?: string;
  isDefault?: boolean;
}

export interface UpsertItemInput {
  item: ItemFile;
  content?: string | null;
  sourceRef?: SourceRef | null;
}

export interface SyncReport {
  indexed: number;
  removed: number;
  errors: Array<{ itemId: string; message: string }>;
}
