import { access, constants, mkdir, readFile, readdir, rm, writeFile, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import type {
  FileSystemAdapter,
  VaultItemMetaRead,
  VaultItemStatMeta,
} from "./types.js";
import {
  filterDiskItemIds,
  itemMetaPath,
  itemRoot,
  itemsRoot,
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

  async statVaultItemsMeta(vaultPath: string): Promise<VaultItemStatMeta[]> {
    const itemsDir = itemsRoot(vaultPath);
    if (!(await this.exists(itemsDir))) {
      return [];
    }

    const itemIds = filterDiskItemIds(await this.readDir(itemsDir));
    const results: VaultItemStatMeta[] = [];
    for (const itemId of itemIds) {
      const fileStat = await this.stat(itemMetaPath(itemRoot(vaultPath, itemId)));
      results.push({ id: itemId, mtimeMs: fileStat.mtimeMs });
    }
    return results;
  }

  async readVaultItemsMeta(
    vaultPath: string,
    itemIds: string[],
  ): Promise<VaultItemMetaRead[]> {
    const results: VaultItemMetaRead[] = [];
    for (const itemId of itemIds) {
      const metaPath = itemMetaPath(itemRoot(vaultPath, itemId));
      if (!(await this.exists(metaPath))) {
        continue;
      }
      const documentMarkdown = await this.readText(metaPath);
      results.push({ id: itemId, documentMarkdown });
    }
    return results;
  }
}
