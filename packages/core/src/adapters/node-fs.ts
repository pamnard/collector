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
  VaultItemSourceRefRead,
  VaultItemStatMeta,
} from "./types.js";
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

  async statVaultItemsMeta(vaultPath: string): Promise<VaultItemStatMeta[]> {
    const itemIds = await listItemRelativePaths(this, vaultPath);
    const results: VaultItemStatMeta[] = [];
    for (const itemId of itemIds) {
      const fileStat = await this.stat(itemMarkdownPath(vaultPath, itemId));
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
      const docPath = itemMarkdownPath(vaultPath, itemId);
      if (!(await this.exists(docPath))) {
        continue;
      }
      const documentMarkdown = await this.readText(docPath);
      const fileStat = await this.stat(docPath);
      results.push({
        id: itemId,
        documentMarkdown,
        mtimeMs: fileStat.mtimeMs,
      });
    }
    return results;
  }

  async readVaultItemSourceRefs(
    vaultPath: string,
    itemIds: string[],
  ): Promise<VaultItemSourceRefRead[]> {
    const results: VaultItemSourceRefRead[] = [];
    for (const itemId of itemIds) {
      const sourcePath = itemSourcePath(vaultPath, itemId);
      const sourceJson = (await this.exists(sourcePath))
        ? await this.readText(sourcePath)
        : null;
      results.push({ id: itemId, sourceJson });
    }
    return results;
  }
}
