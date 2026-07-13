import { access, constants, mkdir, readFile, readdir, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FileSystemAdapter } from "./types.js";

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

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    await rm(path, { recursive: options?.recursive ?? false, force: true });
  }
}
