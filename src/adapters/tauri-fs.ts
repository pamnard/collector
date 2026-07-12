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

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    await remove(path, { recursive: options?.recursive ?? false });
  }
}
