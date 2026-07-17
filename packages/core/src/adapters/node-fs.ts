import {
  access,
  constants,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
  stat,
  utimes,
} from "node:fs/promises";
import { join } from "node:path";
import type {
  FileSystemAdapter,
  VaultItemMetaRead,
  VaultItemStatMeta,
} from "./types.js";
import {
  isMarkdownItemFile,
  isReservedVaultEntry,
  itemMarkdownPath,
} from "../vault/paths.js";

export class NodeFileSystemAdapter implements FileSystemAdapter {
  join(...parts: string[]): string {
    return join(...parts);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async readText(path: string): Promise<string> {
    return readFile(path, "utf8");
  }

  async writeText(path: string, content: string): Promise<void> {
    await writeFile(path, content, "utf8");
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const buffer = await readFile(path);
    return new Uint8Array(buffer);
  }

  async writeBinary(path: string, content: Uint8Array): Promise<void> {
    await writeFile(path, content);
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  async readDir(path: string): Promise<string[]> {
    return readdir(path);
  }

  async stat(path: string): Promise<{ mtimeMs: number | null }> {
    try {
      const stats = await stat(path);
      return { mtimeMs: stats.mtimeMs };
    } catch {
      return { mtimeMs: null };
    }
  }

  async touch(path: string): Promise<void> {
    const now = new Date();
    await utimes(path, now, now);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    await rm(path, { recursive: options?.recursive ?? false, force: true });
  }

  async rename(from: string, to: string): Promise<void> {
    await rename(from, to);
  }

  private async walkItems(
    vaultPath: string,
    relDir: string,
    onItem: (relPath: string) => Promise<void>,
  ): Promise<void> {
    const absDir = relDir ? join(vaultPath, relDir) : vaultPath;
    const dirents = await readdir(absDir, { withFileTypes: true });
    for (const dirent of dirents) {
      const name = dirent.name;
      if (name.startsWith(".") || isReservedVaultEntry(name)) {
        continue;
      }
      const rel = relDir ? `${relDir}/${name}` : name;
      if (dirent.isDirectory()) {
        await this.walkItems(vaultPath, rel, onItem);
        continue;
      }
      if (isMarkdownItemFile(name)) {
        await onItem(rel);
      }
    }
  }

  async statVaultItemsMeta(vaultPath: string): Promise<VaultItemStatMeta[]> {
    if (!(await this.exists(vaultPath))) {
      return [];
    }
    const results: VaultItemStatMeta[] = [];
    await this.walkItems(vaultPath, "", async (rel) => {
      const fileStat = await this.stat(itemMarkdownPath(vaultPath, rel));
      results.push({ id: rel, mtimeMs: fileStat.mtimeMs });
    });
    return results;
  }

  async readVaultItemsMeta(
    vaultPath: string,
    itemIds: string[],
  ): Promise<VaultItemMetaRead[]> {
    const results: VaultItemMetaRead[] = [];
    for (const itemId of itemIds) {
      const markdownPath = itemMarkdownPath(vaultPath, itemId);
      if (!(await this.exists(markdownPath))) {
        continue;
      }
      const markdown = await this.readText(markdownPath);
      results.push({ id: itemId, markdown });
    }
    return results;
  }
}
