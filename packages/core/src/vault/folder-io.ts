import { foldersFileSchema, normalizeFolderPath, type FoldersFile } from "@collector/shared";
import type { FileSystemAdapter } from "../adapters/types.js";
import { legacyFoldersPath } from "./paths.js";

/**
 * Legacy `folders.json` — no longer written. Collections are real FS folders
 * (#134); this is read-only, used by schema migration to seed empty folders
 * that have no items yet, then deleted.
 */
export async function readLegacyFoldersFile(
  fs: FileSystemAdapter,
  vaultRootPath: string,
): Promise<FoldersFile> {
  const path = legacyFoldersPath(vaultRootPath);
  if (!(await fs.exists(path))) {
    return { paths: [] };
  }

  const raw = await fs.readText(path);
  const parsed = foldersFileSchema.parse(JSON.parse(raw));
  return {
    paths: [...new Set(parsed.paths.map(normalizeFolderPath).filter(Boolean))].sort(),
  };
}

export async function deleteLegacyFoldersFile(
  fs: FileSystemAdapter,
  vaultRootPath: string,
): Promise<void> {
  const path = legacyFoldersPath(vaultRootPath);
  if (await fs.exists(path)) {
    await fs.remove(path);
  }
}
