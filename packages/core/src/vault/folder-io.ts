import {
  foldersFileSchema,
  normalizeFolderPath,
  VAULT_FILES,
  type FoldersFile,
} from "@collector/shared";
import type { FileSystemAdapter } from "../adapters/types.js";
import { joinSegments } from "./paths.js";

export function foldersFilePath(vaultRootPath: string): string {
  return joinSegments(vaultRootPath, VAULT_FILES.folders);
}

export async function readFoldersFile(
  fs: FileSystemAdapter,
  vaultRootPath: string,
): Promise<FoldersFile> {
  const path = foldersFilePath(vaultRootPath);
  if (!(await fs.exists(path))) {
    return { paths: [] };
  }

  const raw = await fs.readText(path);
  const parsed = foldersFileSchema.parse(JSON.parse(raw));
  return {
    paths: [...new Set(parsed.paths.map(normalizeFolderPath).filter(Boolean))].sort(),
  };
}

export async function writeFoldersFile(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  file: FoldersFile,
): Promise<void> {
  const parsed = foldersFileSchema.parse({
    paths: [...new Set(file.paths.map(normalizeFolderPath).filter(Boolean))].sort(),
  });
  await fs.writeText(
    foldersFilePath(vaultRootPath),
    JSON.stringify(parsed, null, 2),
  );
}
