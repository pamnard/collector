import {
  access,
  constants,
  copyFile,
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
  VaultDirEntry,
  VaultItemMetaRead,
  VaultItemSourceRefRead,
  VaultItemStatMeta,
} from "./types.js";
import {
  DISK_ITEM_READ_CONCURRENCY,
  INDEX_SYNC_WRITE_BATCH,
  INDEX_SYNC_YIELD_MS,
  runWithConcurrencyYielding,
} from "../util/concurrency.js";
import { itemMarkdownPath, itemSourcePath } from "../vault/paths.js";
import { listItemRelativePaths } from "../vault/scan.js";

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

  async writeTextExclusive(path: string, content: string): Promise<void> {
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const buffer = await readFile(path);
    return new Uint8Array(buffer);
  }

  async writeBinary(path: string, content: Uint8Array): Promise<void> {
    await writeFile(path, content);
  }

  async copyFile(from: string, to: string): Promise<void> {
    await copyFile(from, to);
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  async readDir(path: string): Promise<string[]> {
    return readdir(path);
  }

  async readDirEntries(path: string): Promise<VaultDirEntry[]> {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    }));
  }

  async stat(
    path: string,
  ): Promise<{ mtimeMs: number | null; sizeBytes: number | null }> {
    try {
      const stats = await stat(path);
      return { mtimeMs: stats.mtimeMs, sizeBytes: stats.size };
    } catch {
      return { mtimeMs: null, sizeBytes: null };
    }
  }

  async touch(path: string, mtimeMs?: number): Promise<void> {
    const when = mtimeMs === undefined ? new Date() : new Date(mtimeMs);
    await utimes(path, when, when);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    await rm(path, { recursive: options?.recursive ?? false, force: true });
  }

  async rename(from: string, to: string): Promise<void> {
    await rename(from, to);
  }

  async statVaultItemsMeta(vaultPath: string): Promise<VaultItemStatMeta[]> {
    const itemIds = await listItemRelativePaths(this, vaultPath);
    return runWithConcurrencyYielding(
      itemIds.length,
      DISK_ITEM_READ_CONCURRENCY,
      async (index) => {
        const itemId = itemIds[index]!;
        const fileStat = await this.stat(itemMarkdownPath(vaultPath, itemId));
        return { id: itemId, mtimeMs: fileStat.mtimeMs };
      },
      { yieldEvery: INDEX_SYNC_WRITE_BATCH, yieldMs: INDEX_SYNC_YIELD_MS },
    );
  }

  async readVaultItemsMeta(
    vaultPath: string,
    itemIds: string[],
  ): Promise<VaultItemMetaRead[]> {
    const results: VaultItemMetaRead[] = [];
    const reads = await runWithConcurrencyYielding(
      itemIds.length,
      DISK_ITEM_READ_CONCURRENCY,
      async (index) => {
        const itemId = itemIds[index]!;
        const docPath = itemMarkdownPath(vaultPath, itemId);
        if (!(await this.exists(docPath))) {
          return null;
        }
        const documentMarkdown = await this.readText(docPath);
        const fileStat = await this.stat(docPath);
        return {
          id: itemId,
          documentMarkdown,
          mtimeMs: fileStat.mtimeMs,
        };
      },
      { yieldEvery: INDEX_SYNC_WRITE_BATCH, yieldMs: INDEX_SYNC_YIELD_MS },
    );
    for (const entry of reads) {
      if (entry) {
        results.push(entry);
      }
    }
    return results;
  }

  async readVaultItemSourceRefs(
    vaultPath: string,
    itemIds: string[],
  ): Promise<VaultItemSourceRefRead[]> {
    return runWithConcurrencyYielding(
      itemIds.length,
      DISK_ITEM_READ_CONCURRENCY,
      async (index) => {
        const itemId = itemIds[index]!;
        const sourcePath = itemSourcePath(vaultPath, itemId);
        const sourceJson = (await this.exists(sourcePath))
          ? await this.readText(sourcePath)
          : null;
        return { id: itemId, sourceJson };
      },
      { yieldEvery: INDEX_SYNC_WRITE_BATCH, yieldMs: INDEX_SYNC_YIELD_MS },
    );
  }
}
