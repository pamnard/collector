import {
  tagsFileSchema,
  type Tag,
  type TagsFile,
} from "@collector/shared";
import { VAULT_FILES } from "@collector/shared";
import type { FileSystemAdapter } from "../adapters/types.js";
import { joinSegments } from "./paths.js";

export function tagsFilePath(vaultRootPath: string): string {
  return joinSegments(vaultRootPath, VAULT_FILES.tags);
}

export async function readTagsFile(
  fs: FileSystemAdapter,
  vaultRootPath: string,
): Promise<TagsFile> {
  const path = tagsFilePath(vaultRootPath);
  if (!(await fs.exists(path))) {
    return { tags: [] };
  }

  const raw = await fs.readText(path);
  return tagsFileSchema.parse(JSON.parse(raw));
}

export async function writeTagsFile(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  file: TagsFile,
): Promise<void> {
  const parsed = tagsFileSchema.parse(file);
  await fs.writeText(
    tagsFilePath(vaultRootPath),
    JSON.stringify(parsed, null, 2),
  );
}

export async function listTagsOnDisk(
  fs: FileSystemAdapter,
  vaultRootPath: string,
): Promise<Tag[]> {
  const file = await readTagsFile(fs, vaultRootPath);
  return file.tags.sort((a, b) => a.name.localeCompare(b.name));
}
