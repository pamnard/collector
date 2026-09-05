/**
 * Browser UI must not use a local FS adapter (#555).
 * DevMock paths short-circuit before calling these methods.
 * Host cutover uses CollectorService RPC instead.
 */

import type { FileSystemAdapter } from "@collector/core";

const MSG =
  "UI-local filesystem adapter removed (#555); use host CollectorService";

function fail(): never {
  throw new Error(MSG);
}

export class UnsupportedBrowserFsAdapter implements FileSystemAdapter {
  exists(): Promise<boolean> {
    return fail();
  }
  readText(): Promise<string> {
    return fail();
  }
  writeText(): Promise<void> {
    return fail();
  }
  writeTextExclusive(): Promise<void> {
    return fail();
  }
  readBinary(): Promise<Uint8Array> {
    return fail();
  }
  writeBinary(): Promise<void> {
    return fail();
  }
  copyFile(): Promise<void> {
    return fail();
  }
  mkdir(): Promise<void> {
    return fail();
  }
  readDir(): Promise<string[]> {
    return fail();
  }
  readDirEntries(): Promise<never> {
    return fail();
  }
  stat(): Promise<{ mtimeMs: number | null; sizeBytes: number | null }> {
    return fail();
  }
  touch(): Promise<void> {
    return fail();
  }
  remove(): Promise<void> {
    return fail();
  }
  rename(): Promise<void> {
    return fail();
  }
  join(...parts: string[]): string {
    return parts.join("/");
  }
}
