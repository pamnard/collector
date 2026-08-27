import { selfContainedCollectorProfileLayout } from "@collector/shared";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import {
  NodeSqliteExecutor,
  SERVICE_HOST_EVENTS,
  createDomainWireRequestHandler,
  createHostHttpEventsHub,
  createServiceDomainRuntime,
  handleHttpRpc,
  isValidBearer,
  startServiceHost,
  writeJson,
  writeUnauthorized,
} from "@collector/service/host";
import type { HostWireClient } from "@collector/service/wire";
import { createHttpHostTransport } from "./http-host-transport.js";
import type { DashboardIndexPage, VaultIndexSyncStatus } from "@collector/api";
import {
  BOOT_PORT_KEYS,
  CREDENTIALS_PORT_KEYS,
  DASHBOARD_SNAPSHOT_PORT_KEYS,
  EXTRACT_PORT_KEYS,
  FOLDERS_PORT_KEYS,
  INDEX_PORT_KEYS,
  ITEMS_PORT_KEYS,
  JOBS_PORT_KEYS,
  MEDIA_PORT_KEYS,
  SETTINGS_PORT_KEYS,
  SYNC_PLUGINS_PORT_KEYS,
  TAGS_PORT_KEYS,
  TELEGRAM_SYNC_PORT_KEYS,
  VAULTS_PORT_KEYS,
} from "@collector/api";
import type { AppSettings } from "@collector/shared";
import {
  createCollectorHostDashboardSnapshotPort,
  createCollectorHostService,
  createCollectorHostServiceClient,
  type CollectorHostServiceClient,
} from "./host-collector-client.js";
import { connectCollectorHostService } from "./host-collector-client-node.js";

/** Legacy incomplete schema — migrate leaves it unhealthy until rebuild. */
async function writeLegacyBrokenIndexDb(dbPath: string): Promise<void> {
  const db = await NodeSqliteExecutor.open(dbPath);
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

async function waitForItemIndexed(
  client: CollectorHostServiceClient,
  itemId: string,
): Promise<void> {
  await vi.waitFor(async () => {
    const result = await client.items.queryIndex("all", undefined, {
      limit: 100,
      offset: 0,
    });
    expect(result.ids).toContain(itemId);
  });
}

async function waitForVaultIndexSyncDone(
  client: CollectorHostServiceClient,
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

describe("CollectorHostServiceClient", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("health works end-to-end against the service host", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-client-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
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

  it("item/search/dashboard reads work over HTTP (#155)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-reads-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
      try {
        let page = await client.items.fetchDashboardIndexPage("all", "", {
          limit: 60,
          offset: 0,
        });
        await vi.waitFor(async () => {
          page = await client.items.fetchDashboardIndexPage("all", "", {
            limit: 60,
            offset: 0,
          });
          expect(page.totalCount).toBeGreaterThan(0);
        });
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

  it("item create/update/delete work over HTTP (#156)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-writes-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
      try {
        const created = await client.items.createItem({
          title: "Host Note",
          content_type: "note",
          content: "# hello",
        });
        expect(created.title).toBe("Host Note");

        await waitForItemIndexed(client, created.id);
        const before = await client.items.queryIndex("all", undefined, {
          limit: 24,
          offset: 0,
        });
        expect(before.ids).toContain(created.id);
        expect(before.stamps).toHaveLength(before.ids.length);
        const beforeStamp = before.stamps[before.ids.indexOf(created.id)];

        const presentationEvents: Array<{ vaultId: string; kind: string }> = [];
        const unsubPresentation = client.index.subscribeVaultPresentationChanged(
          (payload) => {
            presentationEvents.push(payload);
          },
        );

        const updated = await client.items.updateItem(created.id, {
          title: "Host Note 2",
          description: "fresh teaser",
        });
        expect(updated.title).toBe("Host Note 2");

        // Derived refresh from create may still emit itemDerivedComplete after
        // subscribe; wait for the upsert event the update path guarantees (#817).
        await vi.waitFor(() => {
          expect(
            presentationEvents.some((event) => event.kind === "itemUpserted"),
          ).toBe(true);
        });
        unsubPresentation.unsubscribe();

        await vi.waitFor(async () => {
          const after = await client.items.queryIndex("all", undefined, {
            limit: 24,
            offset: 0,
          });
          const afterStamp = after.stamps[after.ids.indexOf(created.id)];
          expect(afterStamp).toBeTruthy();
          expect(afterStamp).not.toEqual(beforeStamp);
        });

        const source = await client.items.updateItemSource(
          created.id,
          "---\ntitle: Host Note 2\n---\n\n# body\n",
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

  it("tags list is derived from item writes; reverse catalog RPC absent (#842)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-tags-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
      try {
        expect(client.tags).not.toHaveProperty("createTag");
        expect(client.tags).not.toHaveProperty("deleteTag");
        expect(client.tags).not.toHaveProperty("updateTagRecord");

        const item = await client.items.createItem({
          title: "Tagged",
          content_type: "note",
          content: "body",
        });
        const updated = await client.items.updateItem(item.id, {
          tags: ["host-tag"],
        });
        expect(updated.tag_ids).toHaveLength(1);

        const source = await client.items.getItemSource(item.id);
        expect(source).toMatch(/host-tag/);

        await vi.waitFor(
          async () => {
            const listed = await client.tags.listTags();
            expect(listed.some((t) => t.name === "host-tag")).toBe(true);
            expect(listed.find((t) => t.name === "host-tag")?.item_count).toBe(
              1,
            );
          },
          { timeout: 10_000 },
        );
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("folders + move item work over HTTP (#158)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-folders-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
      try {
        const createdPath = await client.folders.createFolder("host-folder");
        expect(createdPath).toBe("host-folder");

        // Index tree may lag FS until sync; still exercise list RPC.
        expect(Array.isArray(await client.folders.listFolderTree())).toBe(true);

        await expect(
          client.folders.listFolderItems(createdPath),
        ).resolves.toEqual([]);

        const renamed = await client.folders.renameFolder(createdPath, "host-folder-renamed");
        expect(renamed).toBe("host-folder-renamed");

        const item = await client.items.createItem({
          title: "Folder move note",
          content_type: "note",
          content: "x",
        });
        const moved = await client.folders.moveItemToFolderPath(item.id, renamed);
        expect(moved.folder_path).toBe(renamed);

        const listed = await client.folders.listFolderItems(renamed);
        expect(listed.map((row) => row.id)).toEqual([moved.id]);
        await expect(
          client.folders.listFolderItems("missing-folder-xyz"),
        ).rejects.toThrow(/Folder not found/);

        await client.items.deleteItem(moved.id);
        await client.folders.deleteFolder(renamed);
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("media attach/list/delete work over HTTP (#159)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-media-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
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

  it("media replace keeps stable id over HTTP (#353)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-media-replace-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
      try {
        const item = await client.items.createItem({
          title: "Replace media note",
          content_type: "note",
          content: "m",
        });
        await waitForItemIndexed(client, item.id);

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
        // Cover SoT is cover.webp on disk (#276/#279); FM thumbnail stays null.
        expect(covered.thumbnail ?? null).toBeNull();
        const coverPath = await client.media.resolveItemThumbnailPath(covered);
        expect(typeof coverPath).toBe("string");
        expect(coverPath!.length).toBeGreaterThan(0);
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("vaults list/switch/ensure work over HTTP (#160)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-vaults-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
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

  it("index boot open/ensureHealthy work over HTTP (#162)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-boot-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
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

  it("ensureHealthy rebuilds an unhealthy index over HTTP (#162)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-rebuild-"));
    dirs.push(dataDir);
    await writeLegacyBrokenIndexDb(join(dataDir, "collector.db"));

    // HTTP host without auto-heal so the client path exercises rebuild.
    const runtime = createServiceDomainRuntime(selfContainedCollectorProfileLayout(dataDir));
    const token = "rebuild-test-host-token";
    const domainDispatch = createDomainWireRequestHandler(runtime);
    const eventsHub = createHostHttpEventsHub({ expectedToken: token });
    const stopSyncStatusBroadcast = runtime.vaultIndexSyncStatus.subscribe(
      (status) => {
        eventsHub.broadcastEvent(SERVICE_HOST_EVENTS.vaultIndexSyncStatus, status);
      },
    );

    const server = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (req.method === "GET" && url.pathname === "/ping") {
          writeJson(req, res, 200, { ok: true, pong: true });
          return;
        }
        if (req.method === "GET" && url.pathname === "/health") {
          if (!isValidBearer(req, token)) {
            writeUnauthorized(req, res);
            return;
          }
          const healthy = runtime.isHealthy();
          writeJson(req, res, healthy ? 200 : 503, {
            ok: healthy,
            status: healthy ? "healthy" : "unhealthy",
            open: true,
            healthy,
          });
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/rpc") {
          if (!isValidBearer(req, token)) {
            writeUnauthorized(req, res);
            return;
          }
          await handleHttpRpc(req, res, domainDispatch);
          return;
        }
        writeJson(req, res, 404, { ok: false, error: "not_found" });
      })();
    });
    eventsHub.attach(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const client = await connectCollectorHostService(baseUrl, { token });
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
      await eventsHub.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await runtime.close();
    }
  });

  it("settings + dashboard snapshot work over HTTP (#161)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-settings-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
      try {
        const snapshotPort = createCollectorHostDashboardSnapshotPort();
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

  it("filesystem sync status get/subscribe work over HTTP (#163)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-sync-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
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
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-watch-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
      try {
        const active = await client.boot.ensureActiveVault();
        await client.items.listDashboardItemIds("all");

        await client.startVaultFilesystemWatcher(active.vault.id, active.path);
        expect(await client.isVaultFilesystemWatcherActive()).toBe(true);
        await client.stopVaultFilesystemWatcher();
        expect(await client.isVaultFilesystemWatcherActive()).toBe(false);
        await client.startVaultFilesystemWatcher(active.vault.id, active.path);
        expect(await client.isVaultFilesystemWatcherActive()).toBe(true);

        // Vault index sync / derived refresh are async (#631/#766); wait for the
        // welcome (or any) item before exercising the watcher mutation path (#817).
        let ids = await client.items.listDashboardItemIds("all");
        await vi.waitFor(async () => {
          ids = await client.items.listDashboardItemIds("all");
          expect(ids.itemIds.length).toBeGreaterThan(0);
        });
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

  it("settings subscribe + dashboard peek work over HTTP (#241/#329)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-ui-surface-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
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

        const peer = await connectCollectorHostService(host.baseUrl, { dataDir });
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

        const snapshotPort = createCollectorHostDashboardSnapshotPort();
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
  "extract",
  "folders",
  "index",
  "items",
  "jobs",
  "media",
  "settings",
  "syncPlugins",
  "tags",
  "telegramSync",
  "vaults",
] as const;

function mockTransport(
  requestImpl?: (method: string, params?: unknown) => Promise<unknown>,
): HostWireClient {
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

describe("CollectorHostService ports (#366)", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("createCollectorHostService exposes domain ports with PORT_KEYS methods", () => {
    const service = createCollectorHostService(mockTransport());
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
    for (const key of JOBS_PORT_KEYS) {
      expect(typeof service.jobs[key], `jobs.${key}`).toBe("function");
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
    for (const key of EXTRACT_PORT_KEYS) {
      expect(typeof service.extract[key], `extract.${key}`).toBe("function");
    }
    for (const key of TELEGRAM_SYNC_PORT_KEYS) {
      expect(typeof service.telegramSync[key], `telegramSync.${key}`).toBe(
        "function",
      );
    }
  });

  it("createCollectorHostDashboardSnapshotPort exposes snapshot methods", () => {
    const snapshot = createCollectorHostDashboardSnapshotPort(mockTransport());
    for (const key of DASHBOARD_SNAPSHOT_PORT_KEYS) {
      expect(typeof snapshot[key], key).toBe("function");
    }
  });

  it("createCollectorHostServiceClient exposes ports + transport extras", () => {
    const client = createCollectorHostServiceClient(mockTransport());
    expect(typeof client.items.searchItems).toBe("function");
    expect(typeof client.boot.getDataDirectory).toBe("function");
    expect(typeof client.ping).toBe("function");
    expect(typeof client.startVaultFilesystemWatcher).toBe("function");
  });

  it("one RPC method per domain port over createCollectorHostService", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-ports-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const transport = await createHttpHostTransport({
        baseUrl: host.baseUrl,
        token: readFileSync(
          join(dataDir, "collector-service.host-token"),
          "utf8",
        ).trim(),
      });
      try {
        const service = createCollectorHostService(transport);
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
