/**
 * Node dialer for Collector IPC client (#154/#240/#366 / #368).
 * Snapshot + thumbnail resolution use Node FS (not host IPC).
 *
 * Avoids importing `@collector/core` here — a top-level client→core edge can
 * resolve stale `core/dist` and break host media ops in the same process.
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
import type {
  ActiveVaultResult,
  DashboardSnapshotPort,
  UiSessionThumbnailPaths,
} from "@collector/api";
import { createDashboardSnapshotService } from "@collector/service";
import type { ItemFile } from "@collector/shared";
import {
  connectServiceIpc,
  type ServiceIpcClientOptions,
} from "@collector/service/host";
import type { ServiceIpcClient } from "@collector/service/ipc";
import {
  createCollectorIpcDashboardSnapshotPort,
  createCollectorIpcService,
  createCollectorIpcServiceClient,
  type CollectorIpcClientOptions,
  type CollectorIpcServiceClient,
  type ServiceIpcHealthResult,
} from "./ipc-collector-client.js";

export {
  createCollectorIpcDashboardSnapshotPort,
  createCollectorIpcService,
  createCollectorIpcServiceClient,
  type CollectorIpcClientOptions,
  type CollectorIpcServiceClient,
  type ServiceIpcHealthResult,
};

function createNodeFileSystemAdapter() {
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
    async stat(path: string): Promise<{ mtimeMs: number | null }> {
      try {
        const stats = await stat(path);
        return { mtimeMs: stats.mtimeMs };
      } catch {
        return { mtimeMs: null };
      }
    },
    async touch(path: string): Promise<void> {
      const now = new Date();
      await utimes(path, now, now);
    },
  };
}

const nodeSnapshotByTransport = new WeakMap<
  ServiceIpcClient,
  Promise<DashboardSnapshotPort>
>();

const pureSnapshot = createCollectorIpcDashboardSnapshotPort();

function createNodeSnapshotPort(
  transport: ServiceIpcClient,
): DashboardSnapshotPort {
  const getService = (): Promise<DashboardSnapshotPort> => {
    let pending = nodeSnapshotByTransport.get(transport);
    if (!pending) {
      pending = (async () => {
        const fs = createNodeFileSystemAdapter();
        let configDir = "";
        return createDashboardSnapshotService({
          fs,
          ensureConfigDir: async () => {
            if (!configDir) {
              configDir = (await transport.request(
                "getAppConfigDirectory",
              )) as string;
            }
            return configDir;
          },
          isDevMock: () => false,
          readDevMockSnapshot: () => null,
          writeDevMockSnapshot: () => {},
        });
      })();
      nodeSnapshotByTransport.set(transport, pending);
    }
    return pending;
  };

  let syncService: DashboardSnapshotPort | null = null;

  return {
    async ensureDashboardSnapshot() {
      syncService = await getService();
      return syncService.ensureDashboardSnapshot();
    },
    peekMatchingDashboardSnapshot(input) {
      return syncService?.peekMatchingDashboardSnapshot(input) ?? null;
    },
    async persistDashboardSnapshot(snapshot) {
      syncService = await getService();
      return syncService.persistDashboardSnapshot(snapshot);
    },
    async clearDashboardSnapshot() {
      syncService = await getService();
      return syncService.clearDashboardSnapshot();
    },
    buildDashboardSnapshot(input) {
      return (syncService ?? pureSnapshot).buildDashboardSnapshot(input);
    },
  };
}

function resolveThumbnailCandidate(
  vaultPath: string,
  itemId: string,
  thumbnail: string | null,
): string | null {
  if (!thumbnail) {
    return null;
  }
  if (thumbnail.startsWith("/") || /^[A-Za-z]:/.test(thumbnail)) {
    return existsSync(thumbnail) ? thumbnail : null;
  }
  const folder = dirname(itemId);
  const candidate =
    folder && folder !== "."
      ? join(vaultPath, folder, thumbnail)
      : join(vaultPath, thumbnail);
  return existsSync(candidate) ? candidate : null;
}

function createNodeThumbnailPaths(
  transport: ServiceIpcClient,
): UiSessionThumbnailPaths {
  const resolveItemThumbnailPaths = async (
    items: ItemFile[],
  ): Promise<Map<string, string | null>> => {
    if (items.length === 0) {
      return new Map();
    }
    const active = (await transport.request(
      "ensureActiveVault",
    )) as ActiveVaultResult;
    const resolved = new Map<string, string | null>();
    for (const item of items) {
      resolved.set(
        item.id,
        resolveThumbnailCandidate(
          active.path,
          item.id,
          item.thumbnail ?? null,
        ),
      );
    }
    return resolved;
  };

  return {
    resolveItemThumbnailPaths,
    async resolveItemThumbnailPath(item: ItemFile): Promise<string | null> {
      const paths = await resolveItemThumbnailPaths([item]);
      return paths.get(item.id) ?? null;
    },
  };
}

function createNodeUiSessionOptions(
  transport: ServiceIpcClient,
): CollectorIpcClientOptions {
  return {
    snapshot: createNodeSnapshotPort(transport),
    thumbnails: createNodeThumbnailPaths(transport),
  };
}

/** Dial the service host and return domain ports + transport extras (#369). */
export async function connectCollectorIpcService(
  path: string,
  options?: ServiceIpcClientOptions,
): Promise<CollectorIpcServiceClient> {
  const transport = await connectServiceIpc(path, options);
  return createCollectorIpcServiceClient(
    transport,
    createNodeUiSessionOptions(transport),
  );
}
