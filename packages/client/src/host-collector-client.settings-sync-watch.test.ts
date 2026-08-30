import type { AppSettings } from "@collector/shared";
import type { DashboardIndexPage, VaultIndexSyncStatus } from "@collector/api";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { startServiceHost } from "@collector/service/host";
import { createCollectorHostDashboardSnapshotPort } from "./host-collector-client.js";
import {
  useTempDataDirs,
  waitForVaultIndexSyncDone,
} from "./host-collector-client-test-harness.js";
import { connectCollectorHostService } from "./host-collector-client-node.js";

describe("CollectorHostServiceClient settings/sync/watch (#161 / #163 / #164 / #241 / #922)", () => {
  const { mktemp } = useTempDataDirs();

  it("settings + dashboard snapshot work over HTTP (#161)", async () => {
    const dataDir = mktemp("collector-host-settings-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, { dataDir });
      try {
        const snapshotPort = createCollectorHostDashboardSnapshotPort();
        const settings = await client.settings.ensureAppSettings();
        expect(settings).toMatchObject({
          theme: expect.stringMatching(/^(light|dark)$/),
        });

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
    const dataDir = mktemp("collector-host-sync-");
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
        expect(typeof latest.vaultId).toBe("string");
        expect(latest.vaultId!.length).toBeGreaterThan(0);
        expect(
          seen.some((s) => s.status === "done" || s.status === "running"),
        ).toBe(true);
        unsub.unsubscribe();
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("watcher orchestration updates index after vault file change (#164)", async () => {
    const dataDir = mktemp("collector-host-watch-");
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
    const dataDir = mktemp("collector-host-ui-surface-");
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
        expect(page).not.toBeNull();
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
