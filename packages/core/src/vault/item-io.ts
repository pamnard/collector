import {
  itemFileSchema,
  sourceRefSchema,
  vaultMetaSchema,
  type ItemFile,
  type SourceRef,
  type VaultMeta,
} from "@collector/shared";
import type { FileSystemAdapter } from "../adapters/types.js";
import {
  itemContentPath,
  itemMetaPath,
  itemSourcePath,
  vaultMetaPath,
} from "./paths.js";

export async function readVaultMeta(
  fs: FileSystemAdapter,
  vaultRootPath: string,
): Promise<VaultMeta> {
  const raw = await fs.readText(vaultMetaPath(vaultRootPath));
  return vaultMetaSchema.parse(JSON.parse(raw));
}

export async function writeVaultMeta(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  meta: VaultMeta,
): Promise<void> {
  const parsed = vaultMetaSchema.parse(meta);
  await fs.writeText(vaultMetaPath(vaultRootPath), JSON.stringify(parsed, null, 2));
}

export async function readItemFile(
  fs: FileSystemAdapter,
  itemRootPath: string,
): Promise<ItemFile> {
  const raw = await fs.readText(itemMetaPath(itemRootPath));
  return itemFileSchema.parse(JSON.parse(raw));
}

export async function writeItemFile(
  fs: FileSystemAdapter,
  itemRootPath: string,
  item: ItemFile,
): Promise<void> {
  const parsed = itemFileSchema.parse(item);
  await fs.writeText(itemMetaPath(itemRootPath), JSON.stringify(parsed, null, 2));
}

export async function readItemContent(
  fs: FileSystemAdapter,
  itemRootPath: string,
): Promise<string | null> {
  const path = itemContentPath(itemRootPath);
  if (!(await fs.exists(path))) {
    return null;
  }
  return fs.readText(path);
}

export async function writeItemContent(
  fs: FileSystemAdapter,
  itemRootPath: string,
  content: string,
): Promise<void> {
  await fs.writeText(itemContentPath(itemRootPath), content);
}

export async function readItemSourceRef(
  fs: FileSystemAdapter,
  itemRootPath: string,
): Promise<SourceRef | null> {
  const path = itemSourcePath(itemRootPath);
  if (!(await fs.exists(path))) {
    return null;
  }
  const raw = await fs.readText(path);
  return sourceRefSchema.parse(JSON.parse(raw));
}

export async function writeItemSourceRef(
  fs: FileSystemAdapter,
  itemRootPath: string,
  sourceRef: SourceRef,
): Promise<void> {
  const parsed = sourceRefSchema.parse(sourceRef);
  await fs.writeText(itemSourcePath(itemRootPath), JSON.stringify(parsed, null, 2));
}
