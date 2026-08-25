import { normalizeRelativePath } from "@collector/core";
import { readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";

export type ImportFolderSourceFile = {
  absPath: string;
  relativePath: string;
  name: string;
};

export async function listImportFolderSourceFiles(
  sourceDirAbs: string,
): Promise<ImportFolderSourceFile[]> {
  const out: ImportFolderSourceFile[] = [];
  async function walk(dirAbs: string): Promise<void> {
    const entries = await readdir(dirAbs, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const absPath = join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const relativePath =
        normalizeRelativePath(
          relative(sourceDirAbs, absPath).replace(/\\/g, "/"),
        ) || entry.name;
      out.push({
        absPath,
        relativePath,
        name: basename(absPath),
      });
    }
  }
  await walk(sourceDirAbs);
  return out;
}
