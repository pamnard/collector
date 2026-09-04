/**
 * Node FS adapter for client-side snapshot I/O (#383).
 * Kept local — avoid `@collector/core` here (stale core/dist in same process).
 */

import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

export function createNodeFileSystemAdapter() {
  return {
    join(...parts: string[]): string {
      return join(...parts);
    },
    async exists(path: string): Promise<boolean> {
      return existsSync(path);
    },
    async readText(path: string): Promise<string> {
      return readFile(path, "utf8");
    },
    async writeText(path: string, content: string): Promise<void> {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    },
    async writeTextExclusive(path: string, content: string): Promise<void> {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, { encoding: "utf8", flag: "wx" });
    },
    async readBinary(path: string): Promise<Uint8Array> {
      const buf = await readFile(path);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },
    async writeBinary(path: string, data: Uint8Array): Promise<void> {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },
    async mkdir(path: string): Promise<void> {
      await mkdir(path, { recursive: true });
    },
    async remove(
      path: string,
      options?: { recursive?: boolean },
    ): Promise<void> {
      await rm(path, {
        recursive: options?.recursive ?? true,
        force: true,
      });
    },
    async rename(from: string, to: string): Promise<void> {
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
    },
    async copyFile(from: string, to: string): Promise<void> {
      await mkdir(dirname(to), { recursive: true });
      await copyFile(from, to);
    },
    async readDir(path: string): Promise<string[]> {
      return readdir(path);
    },
    async readDirEntries(
      path: string,
    ): Promise<Array<{ name: string; isDirectory: boolean }>> {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      }));
    },
    async stat(
      path: string,
    ): Promise<{ mtimeMs: number | null; sizeBytes: number | null }> {
      try {
        const stats = await stat(path);
        return { mtimeMs: stats.mtimeMs, sizeBytes: stats.size };
      } catch {
        return { mtimeMs: null, sizeBytes: null };
      }
    },
    async touch(path: string, mtimeMs?: number): Promise<void> {
      const when = mtimeMs === undefined ? new Date() : new Date(mtimeMs);
      await utimes(path, when, when);
    },
  };
}

export type NodeFileSystemAdapter = ReturnType<
  typeof createNodeFileSystemAdapter
>;
