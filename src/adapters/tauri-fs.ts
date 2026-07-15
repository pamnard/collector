import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { RECONCILE_TOUCH_FILE } from "@collector/core";
import type { FileSystemAdapter } from "@collector/core";

export class TauriFileSystemAdapter implements FileSystemAdapter {
  join(...parts: string[]): string {
    return parts
      .flatMap((part) => part.split(/[/\\]+/))
      .filter(Boolean)
      .join("/");
  }

  async exists(path: string): Promise<boolean> {
    return exists(path);
  }

  async readText(path: string): Promise<string> {
    return readTextFile(path);
  }

  async writeText(path: string, content: string): Promise<void> {
    await writeTextFile(path, content);
  }

  async readBinary(path: string): Promise<Uint8Array> {
    return readFile(path);
  }

  async writeBinary(path: string, content: Uint8Array): Promise<void> {
    await writeFile(path, content);
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  async readDir(path: string): Promise<string[]> {
    const entries = await readDir(path);
    return entries.map((entry) => entry.name);
  }

  async stat(path: string): Promise<{ mtimeMs: number | null }> {
    try {
      const fileInfo = await import("@tauri-apps/plugin-fs").then((m) =>
        m.stat(path)
      );
      return {
        mtimeMs: fileInfo.mtime ? fileInfo.mtime.getTime() : null,
      };
    } catch {
      return { mtimeMs: null };
    }
  }

  async touch(path: string): Promise<void> {
    const stampPath = this.join(path, RECONCILE_TOUCH_FILE);
    await writeTextFile(stampPath, String(Date.now()));
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    await remove(path, { recursive: options?.recursive ?? false });
  }
}
