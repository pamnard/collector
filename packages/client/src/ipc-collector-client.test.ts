import { selfContainedCollectorProfileLayout } from "@collector/shared";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  NodeSqliteExecutor,
  SERVICE_IPC_EVENTS,
  connectServiceIpc,
  createDomainIpcRequestHandler,
  createServiceDomainRuntime,
  startServiceHost,
  startServiceIpcServer,
  type ServiceIpcClient,
} from "@collector/service/host";
import type { DashboardIndexPage, VaultIndexSyncStatus } from "@collector/api";
import {
  BOOT_PORT_KEYS,
  CREDENTIALS_PORT_KEYS,
  DASHBOARD_SNAPSHOT_PORT_KEYS,
  FOLDERS_PORT_KEYS,
  INDEX_PORT_KEYS,
  ITEMS_PORT_KEYS,
  MEDIA_PORT_KEYS,
  SETTINGS_PORT_KEYS,
  SYNC_PLUGINS_PORT_KEYS,
  TAGS_PORT_KEYS,
  TELEGRAM_SYNC_PORT_KEYS,
  VAULTS_PORT_KEYS,
} from "@collector/api";
import type { AppSettings } from "@collector/shared";
import {
  createCollectorIpcDashboardSnapshotPort,
  createCollectorIpcService,
  createCollectorIpcServiceClient,
  type CollectorIpcServiceClient,
} from "./ipc-collector-client.js";
import { connectCollectorIpcService } from "./ipc-collector-client-node.js";

/** Legacy incomplete schema — migrate leaves it unhealthy until rebuild. */
async function writeLegacyBrokenIndexDb(dbPath: string): Promise<void> {
  const db = NodeSqliteExecutor.open(dbPath);
  await db.execute(`CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  await db.execute(
    "INSERT INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'))",
  );
  await db.execute(`CREATE TABLE items (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    title TEXT NOT NULL
  )`);
  await db.execute(`CREATE VIRTUAL TABLE items_fts USING fts5(
    item_id UNINDEXED,
    title,
    description,
    content,
    tokenize = 'unicode61'
  )`);
  await db.execute(`CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT,
    created_at TEXT NOT NULL
  )`);
  await db.execute(`CREATE TABLE item_tags (
    item_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (item_id, tag_id)
  )`);
  await db.close();
}

async function waitForVaultIndexSyncDone(
  client: CollectorIpcServiceClient,
  timeoutMs = 5_000,
): Promise<VaultIndexSyncStatus> {
  if (client.index.getVaultIndexSyncStatus().status === "done") {
    return client.index.getVaultIndexSyncStatus();
  }
  return new Promise<VaultIndexSyncStatus>((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.unsubscribe();
      reject(
        new Error(
          `vault index sync did not reach done within ${timeoutMs}ms (status=${client.index.getVaultIndexSyncStatus().status})`,
        ),
      );
    }, timeoutMs);
    const sub = client.index.subscribeVaultIndexSyncStatus((status) => {
      if (status.status === "done") {
        clearTimeout(timer);
        sub.unsubscribe();
        resolve(status);
      }
    });
  });
}

describe("CollectorIpcServiceClient", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("health works end-to-end against the service host", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-ipc-client-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      expect(host.ipcPath).toBeTruthy();
      const client = await connectCollectorIpcService(host.ipcPath!, { dataDir });
      try {
        expect(await client.ping()).toEqual({ ok: true, pong: true });
        expect(await client.health()).toMatchObject({
          ok: true,
          healthy: true,
          status: "healthy",
        });
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("item/search/dashboard reads work over IPC (#155)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-ipc-reads-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorIpcService(host.ipcPath!, { dataDir });
      try {
        const page = await client.items.fetchDashboardIndexPage("all", "", {
          limit: 60,
          offset: 0,
        });
        expect(page.totalCount).toBeGreaterThan(0);
        expect(page.itemIds.length).toBeGreaterThan(0);

        const ids = await client.items.listDashboardItemIds("all", "");
        expect(ids.totalCount).toBe(page.totalCount);
        expect(ids.itemIds.length).toBeGreaterThan(0);

        const loaded = await client.items.loadDashboardItems(ids.itemIds, 0, 10);
        expect(loaded.length).toBeGreaterThan(0);

        const firstId = ids.itemIds[0]!;
        const byId = await client.items.getItemById(firstId);
        expect(byId.item.id).toBe(firstId);

        const source = await client.items.getItemSource(firstId);
        expect(typeof source).toBe("string");
        expect(source.length).toBeGreaterThan(0);

        const tags = await client.tags.listTags();
        expect(Array.isArray(tags)).toBe(true);
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("item create/update/delete work over IPC (#156)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-ipc-writes-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorIpcService(host.ipcPath!, { dataDir });
      try {
        const created = await client.items.createItem({
          title: "IPC Note",
          content_type: "note",
          content: "# hello",
        });
        expect(created.title).toBe("IPC Note");

        const updated = await client.items.updateItem(created.id, {
          title: "IPC Note 2",
        });
        expect(updated.title).toBe("IPC Note 2");

        const source = await client.items.updateItemSource(
          created.id,
          "---\ntitle: IPC Note 2\n---\n\n# body\n",
        );
        expect(source.id).toBe(created.id);

        await client.items.deleteItem(created.id);
        await expect(client.items.getItemById(created.id)).rejects.toBeTruthy();
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("tags list/CRUD work over IPC (#157)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-ipc-tags-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorIpcService(host.ipcPath!, { dataDir });
      try {
        const created = await client.tags.createTag({ name: "ipc-tag" });
        expect(created.name).toBe("ipc-tag");

        const listed = await client.tags.listTags();
        expect(listed.some((t) => t.id === created.id)).toBe(true);

        const updated = await client.tags.updateTagRecord(created.id, {
          name: "ipc-tag-2",
        });
        expect(updated.name).toBe("ipc-tag-2");

        await client.tags.deleteTag(created.id);
        const after = await client.tags.listTags();
        expect(after.some((t) => t.id === created.id)).toBe(false);
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("folders + move item work over IPC (#158)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-ipc-folders-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorIpcService(host.ipcPath!, { dataDir });
      try {
        const createdPath = await client.folders.createFolder("ipc-folder");
        expect(createdPath).toBe("ipc-folder");

        // Index tree may lag FS until sync; still exercise list RPC.
        expect(Array.isArray(await client.folders.listFolderTree())).toBe(true);

        const renamed = await client.folders.renameFolder(createdPath, "ipc-folder-renamed");
        expect(renamed).toBe("ipc-folder-renamed");

        const item = await client.items.createItem({
          title: "Folder move note",
          content_type: "note",
          content: "x",
        });
        const moved = await client.folders.moveItemToFolderPath(item.id, renamed);
        expect(moved.folder_path).toBe(renamed);

        await client.items.deleteItem(moved.id);
        await client.folders.deleteFolder(renamed);
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("media attach/list/delete work over IPC (#159)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-ipc-media-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorIpcService(host.ipcPath!, { dataDir });
      try {
        const item = await client.items.createItem({
          title: "Media note",
          content_type: "note",
          content: "m",
        });

        // Minimal 1x1 PNG
        const png = Uint8Array.from(
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            "base64",
          ),
        );
        const attached = await client.media.attachMediaFiles(item.id, [
          { name: "dot.png", bytes: png },
        ]);
        expect(attached.length).toBe(1);
        expect(attached[0]!.filename).toBe("dot.png");

        const listed = await client.media.listItemMedia(item.id);
        expect(listed.some((m) => m.id === attached[0]!.id)).toBe(true);

        const thumb = await client.media.resolveItemThumbnailPath(item);
        expect(thumb === null || typeof thumb === "string").toBe(true);

        const thumbs = await client.media.resolveItemThumbnailPaths([item]);
        expect(thumbs instanceof Map).toBe(true);
        expect(thumbs.has(item.id)).toBe(true);

        await client.media.deleteItemMedia(item.id, attached[0]!.id);
        const after = await client.media.listItemMedia(item.id);
        expect(after.some((m) => m.id === attached[0]!.id)).toBe(false);
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("media replace keeps stable id over IPC (#353)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-ipc-media-replace-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorIpcService(host.ipcPath!, { dataDir });
      try {
        const item = await client.items.createItem({
          title: "Replace media note",
          content_type: "note",
          content: "m",
        });

        const png = Uint8Array.from(
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            "base64",
          ),
        );
        const attached = await client.media.attachMediaFiles(item.id, [
          { name: "dot.png", bytes: png },
        ]);
        expect(attached.length).toBe(1);
        const mediaId = attached[0]!.id;

        const replaced = await client.media.replaceItemMedia(item.id, mediaId, {
          name: "dot2.png",
          bytes: png,
        });
        expect(replaced.id).toBe(mediaId);
        expect(replaced.filename).toBe("dot2.png");

        const listed = await client.media.listItemMedia(item.id);
        expect(listed).toHaveLength(1);
        expect(listed[0]!.id).toBe(mediaId);
        expect(listed[0]!.filename).toBe("dot2.png");

        const covered = await client.media.setItemCoverFromMedia(item.id, mediaId);
        expect(covered.id).toBe(item.id);
        expect(covered.thumbnail).toBeTruthy();
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("vaults list/switch/ensure work over IPC (#160)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-ipc-vaults-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorIpcService(host.ipcPath!, { dataDir });
      try {
        expect(await client.boot.getDataDirectory()).toBe(dataDir);

        const active = await client.boot.ensureActiveVault();
        expect(active.vault.id).toBeTruthy();
        expect(typeof active.path).toBe("string");

        const listed = await client.vaults.listVaults();
        expect(listed.some((v) => v.id === active.vault.id)).toBe(true);

        const meta = await client.vaults.getActiveVaultMeta();
        expect(meta.id).toBe(active.vault.id);

        await client.vaults.setDefaultVault(active.vault.id);
        const switched = await client.vaults.switchVault(active.vault.id);
        expect(switched.id).toBe(active.vault.id);
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("index boot open/ensureHealthy work over IPC (#162)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-ipc-boot-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorIpcService(host.ipcPath!, { dataDir });
      try {
        // Host already opened + healed on start; methods are idempotent.
        await client.boot.openCollectorDatabase();
        await client.boot.ensureCollectorDatabaseHealthy();
        expect(await client.health()).toMatchObject({
          ok: true,
          healthy: true,
          status: "healthy",
        });
        const active = await client.boot.ensureActiveVault();
        expect(active.vault.id).toBeTruthy();
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("ensureHealthy rebuilds an unhealthy index over IPC (#162)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-ipc-rebuild-"));
    dirs.push(dataDir);
    await writeLegacyBrokenIndexDb(join(dataDir, "collector.db"));

    // IPC-only host: do not auto-heal so the client path exercises rebuild.
    const runtime = createServiceDomainRuntime(selfContainedCollectorProfileLayout(dataDir));
    const ipc = await startServiceIpcServer({
      dataDir,
      token: "rebuild-test-ipc-token",
      handler: {
        ping: () => ({ ok: true, pong: true }),
        health: () => {
          const healthy = runtime.isHealthy();
          return {
            ok: healthy,
            status: healthy ? ("healthy" as const) : ("unhealthy" as const),
            open: true,
            healthy,
          };
        },
        request: createDomainIpcRequestHandler(runtime),
      },
    });
    const stopSyncStatusBroadcast = runtime.vaultIndexSyncStatus.subscribe(
      (status) => {
        ipc.broadcastEvent(SERVICE_IPC_EVENTS.vaultIndexSyncStatus, status);
      },
    );

    try {
      const client = await connectCollectorIpcService(ipc.path, {
        token: "rebuild-test-ipc-token",
      });
      try {
        await client.boot.openCollectorDatabase();
        expect(await client.health()).toMatchObject({
          healthy: false,
          status: "unhealthy",
        });

        await client.boot.ensureCollectorDatabaseHealthy();
        expect(await client.health()).toMatchObject({
          ok: true,
          healthy: true,
          status: "healthy",
        });

        const active = await client.boot.ensureActiveVault();
        expect(active.vault.id).toBeTruthy();
        // Kick off filesystem sync; wait via status channel (#163), not stub indexSync (#327).
        await client.items.listDashboardItemIds("all");
        expect((await waitForVaultIndexSyncDone(client)).status).toBe("done");
        const page = await client.items.queryIndex("all", undefined, {
          limit: 10,
          offset: 0,
        });
        expect(Array.isArray(page.ids)).toBe(true);
      } finally {
        await client.close();
      }
    } finally {
      stopSyncStatusBroadcast();
      await ipc.close();
      await runtime.close();
    }
  });

  it("settings + dashboard snapshot work over IPC (#161)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-ipc-settings-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorIpcService(host.ipcPath!, { dataDir });
      try {
        const snapshotPort = createCollectorIpcDashboardSnapshotPort();
        const settings = await client.settings.ensureAppSettings();
        expect(settings).toBeTruthy();

        const updated = await client.settings.updateAppSettings({
          theme: settings.theme === "dark" ? "light" : "dark",
        });
        expect(updated.theme).not.toBe(settings.theme);

        const configDir = await client.settings.getAppConfigDirectory();
        expect(configDir).toContain(dataDir);

        await snapshotPort.clearDashboardSnapshot();
        expect(await snapshotPort.ensureDashboardSnapshot()).toBeNull();

        const active = await client.boot.ensureActiveVault();
        const snapshot = {
          schema_version: 2 as const,
          vault_id: active.vault.id,
          nav_filter: "all" as const,
          search: "",
          item_ids: [] as string[],
          items: [] as [],
          total_count: 0,
          stream_end_offset: 0,
          cover_paths: {},
          saved_at: new Date().toISOString(),
        };
        await snapshotPort.persistDashboardSnapshot(snapshot);
        const loaded = await snapshotPort.ensureDashboardSnapshot();
        expect(loaded?.vault_id).toBe(active.vault.id);
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("filesystem sync status get/subscribe work over IPC (#163)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-ipc-sync-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorIpcService(host.ipcPath!, { dataDir });
      try {
        const seen: VaultIndexSyncStatus[] = [];
        const unsub = client.index.subscribeVaultIndexSyncStatus((status) => {
          seen.push(status);
        });

        // Kick off filesystem sync; status should move through running/done.
        await client.items.listDashboardItemIds("all");

        const latest = await waitForVaultIndexSyncDone(client);
        expect(latest.status).toBe("done");
        expect(latest.vaultId).toBeTruthy();
        expect(seen.some((s) => s.status === "done" || s.status === "running")).toBe(
          true,
        );
        unsub.unsubscribe();
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("watcher orchestration updates index after vault file change (#164)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-ipc-watch-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorIpcService(host.ipcPath!, { dataDir });
      try {
        const active = await client.boot.ensureActiveVault();
        await client.items.listDashboardItemIds("all");

        await client.startVaultFilesystemWatcher(active.vault.id, active.path);
        expect(await client.isVaultFilesystemWatcherActive()).toBe(true);
        await client.stopVaultFilesystemWatcher();
        expect(await client.isVaultFilesystemWatcherActive()).toBe(false);
        await client.startVaultFilesystemWatcher(active.vault.id, active.path);
        expect(await client.isVaultFilesystemWatcherActive()).toBe(true);

        const ids = await client.items.listDashboardItemIds("all");
        expect(ids.itemIds.length).toBeGreaterThan(0);
        const targetId = ids.itemIds[0]!;
        const target = (await client.items.getItemById(targetId)).item;
        const docPath = join(active.path, target.id);
        const before = await client.items.getItemById(target.id);
        const marker = `watch-${Date.now()}`;
        const raw = readFileSync(docPath, "utf8");
        const next = raw.includes("title:")
          ? raw.replace(/title:\s*.*/, `title: ${marker}`)
          : `---\ntitle: ${marker}\n---\n${raw}`;
        writeFileSync(docPath, next, "utf8");

        const deadline = Date.now() + 8_000;
        let updated = before;
        while (Date.now() < deadline) {
          updated = await client.items.getItemById(target.id);
          if (updated.item.title === marker) {
            break;
          }
          await new Promise((r) => setTimeout(r, 100));
        }
        expect(updated.item.title).toBe(marker);
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("settings subscribe + dashboard peek work over IPC (#241/#329)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-ipc-ui-surface-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorIpcService(host.ipcPath!, { dataDir });
      try {
        const settings = await client.settings.ensureAppSettings();
        expect(client.settings.getAppSettingsSync()).toEqual(settings);

        let subscribed: AppSettings | null = null;
        const unsub = client.settings.subscribeAppSettings((next) => {
          subscribed = next;
        });
        const deadline = Date.now() + 5_000;
        while (subscribed === null && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 50));
        }
        expect(subscribed).toEqual(settings);

        const peer = await connectCollectorIpcService(host.ipcPath!, { dataDir });
        try {
          const patched = await peer.settings.updateAppSettings({
            ...settings,
            theme: settings.theme === "dark" ? "light" : "dark",
          });
          const pushDeadline = Date.now() + 3_000;
          while (
            (subscribed as AppSettings | null)?.theme !== patched.theme &&
            Date.now() < pushDeadline
          ) {
            await new Promise((r) => setTimeout(r, 20));
          }
          expect(subscribed?.theme).toBe(patched.theme);
        } finally {
          await peer.close();
        }
        unsub.unsubscribe();

        const active = await client.boot.ensureActiveVault();
        let page: DashboardIndexPage | null = null;
        let complete = false;
        client.items.subscribeDashboardLoad("all", "", {
          onIndexPage: (next) => {
            page = next;
          },
          onLoadComplete: () => {
            complete = true;
          },
        });
        const loadDeadline = Date.now() + 5_000;
        while ((!page || !complete) && Date.now() < loadDeadline) {
          await new Promise((r) => setTimeout(r, 50));
        }
        expect(complete).toBe(true);
        expect(page).toBeTruthy();
        expect(page!.totalCount).toBeGreaterThanOrEqual(0);

        const snapshotPort = createCollectorIpcDashboardSnapshotPort();
        const snap = snapshotPort.buildDashboardSnapshot({
          vaultId: active.vault.id,
          filter: "all",
          search: "",
          itemIds: page!.itemIds,
          items: [],
          totalCount: page!.totalCount,
          streamEndOffset: 0,
        });
        expect(snap.vault_id).toBe(active.vault.id);
        expect(snap.nav_filter).toBe("all");
        expect(
          snapshotPort.peekMatchingDashboardSnapshot({
            vaultId: active.vault.id,
            filter: "all",
            search: "",
          }),
        ).toBeNull();
        await snapshotPort.persistDashboardSnapshot(snap);
        expect(
          snapshotPort.peekMatchingDashboardSnapshot({
            vaultId: active.vault.id,
            filter: "all",
            search: "",
          }),
        ).toEqual(snap);
        expect(
          snapshotPort.peekMatchingDashboardSnapshot({
            vaultId: active.vault.id,
            filter: "all",
            search: "other",
          }),
        ).toBeNull();
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });
});

const PORT_KEYS = [
  "boot",
  "credentials",
  "folders",
  "index",
  "items",
  "media",
  "settings",
  "syncPlugins",
  "tags",
  "telegramSync",
  "vaults",
] as const;

function mockTransport(
  requestImpl?: (method: string, params?: unknown) => Promise<unknown>,
): ServiceIpcClient {
  return {
    request: async (method, params) => {
      if (requestImpl) {
        return requestImpl(method, params);
      }
      throw new Error(`unexpected ${method}`);
    },
    ping: async () => ({ ok: true as const, pong: true as const }),
    health: async () => ({
      ok: true,
      status: "healthy" as const,
      open: true,
      healthy: true,
    }),
    onEvent: () => () => {},
    close: async () => {},
  };
}

describe("CollectorIpcService ports (#366)", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("createCollectorIpcService exposes domain ports with PORT_KEYS methods", () => {
    const service = createCollectorIpcService(mockTransport());
    expect(Object.keys(service).sort()).toEqual([...PORT_KEYS].sort());

    for (const key of BOOT_PORT_KEYS) {
      expect(typeof service.boot[key], `boot.${key}`).toBe("function");
    }
    for (const key of ITEMS_PORT_KEYS) {
      expect(typeof service.items[key], `items.${key}`).toBe("function");
    }
    for (const key of TAGS_PORT_KEYS) {
      expect(typeof service.tags[key], `tags.${key}`).toBe("function");
    }
    for (const key of FOLDERS_PORT_KEYS) {
      expect(typeof service.folders[key], `folders.${key}`).toBe("function");
    }
    for (const key of MEDIA_PORT_KEYS) {
      expect(typeof service.media[key], `media.${key}`).toBe("function");
    }
    for (const key of VAULTS_PORT_KEYS) {
      expect(typeof service.vaults[key], `vaults.${key}`).toBe("function");
    }
    for (const key of INDEX_PORT_KEYS) {
      expect(typeof service.index[key], `index.${key}`).toBe("function");
    }
    for (const key of SETTINGS_PORT_KEYS) {
      expect(typeof service.settings[key], `settings.${key}`).toBe("function");
    }
    for (const key of CREDENTIALS_PORT_KEYS) {
      expect(typeof service.credentials[key], `credentials.${key}`).toBe(
        "function",
      );
    }
    for (const key of SYNC_PLUGINS_PORT_KEYS) {
      expect(typeof service.syncPlugins[key], `syncPlugins.${key}`).toBe(
        "function",
      );
    }
    for (const key of TELEGRAM_SYNC_PORT_KEYS) {
      expect(typeof service.telegramSync[key], `telegramSync.${key}`).toBe(
        "function",
      );
    }
  });

  it("createCollectorIpcDashboardSnapshotPort exposes snapshot methods", () => {
    const snapshot = createCollectorIpcDashboardSnapshotPort(mockTransport());
    for (const key of DASHBOARD_SNAPSHOT_PORT_KEYS) {
      expect(typeof snapshot[key], key).toBe("function");
    }
  });

  it("createCollectorIpcServiceClient exposes ports + transport extras", () => {
    const client = createCollectorIpcServiceClient(mockTransport());
    expect(typeof client.items.searchItems).toBe("function");
    expect(typeof client.boot.getDataDirectory).toBe("function");
    expect(typeof client.ping).toBe("function");
    expect(typeof client.startVaultFilesystemWatcher).toBe("function");
  });

  it("one RPC method per domain port over createCollectorIpcService", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-ipc-ports-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const transport = await connectServiceIpc(host.ipcPath!, { dataDir });
      try {
        const service = createCollectorIpcService(transport);
        expect(Object.keys(service).sort()).toEqual([...PORT_KEYS].sort());

        const dataDirectory = await service.boot.getDataDirectory();
        expect(dataDirectory.length).toBeGreaterThan(0);

        const page = await service.items.queryIndex("all", undefined, {
          limit: 1,
          offset: 0,
        });
        expect(page).toMatchObject({
          ids: expect.any(Array),
          total: expect.any(Number),
          offset: 0,
        });

        await expect(service.tags.listTags()).resolves.toEqual(
          expect.any(Array),
        );
        await expect(service.folders.listFolderTree()).resolves.toEqual(
          expect.any(Array),
        );

        const item = await service.items.createItem({
          title: "port-smoke",
          content_type: "note",
          content: "# port smoke",
        });
        await expect(service.media.listItemMedia(item.id)).resolves.toEqual(
          expect.any(Array),
        );

        await expect(service.vaults.listVaults()).resolves.toEqual(
          expect.any(Array),
        );
        expect(service.index.getVaultIndexSyncStatus()).toMatchObject({
          status: expect.any(String),
        });
        await expect(
          service.settings.ensureAppSettings(),
        ).resolves.toMatchObject({
          theme: expect.any(String),
        });

        const credAvail = await service.credentials.getCredentialsAvailability();
        expect(credAvail).toMatchObject({ available: expect.any(Boolean) });
        if (credAvail.available) {
          const ref = { pluginId: "collector", key: "issue30_ipc_probe" };
          await service.credentials.setCredential({
            ...ref,
            secret: "ipc-probe-secret",
          });
          await expect(service.credentials.getCredential(ref)).resolves.toBe(
            "ipc-probe-secret",
          );
          await service.credentials.deleteCredential(ref);
          await expect(service.credentials.getCredential(ref)).resolves.toBeNull();
        }
      } finally {
        await transport.close();
      }
    } finally {
      await host.close();
    }
  });
});
