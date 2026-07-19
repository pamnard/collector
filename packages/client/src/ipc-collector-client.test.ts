import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ServiceIpcError,
  startServiceHost,
  type ServiceIpcClient,
} from "@collector/service";
import {
  connectCollectorIpcClient,
  createCollectorIpcClient,
} from "./ipc-collector-client.js";

describe("CollectorIpcClient", () => {
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
      const client = await connectCollectorIpcClient(host.ipcPath!);
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
      const client = await connectCollectorIpcClient(host.ipcPath!);
      try {
        const items = await client.listItems();
        expect(items.length).toBeGreaterThan(0);

        const page = await client.fetchDashboardIndexPage("all", "", {
          limit: 60,
          offset: 0,
        });
        expect(page.totalCount).toBeGreaterThan(0);
        expect(page.itemIds.length).toBeGreaterThan(0);

        const ids = await client.listDashboardItemIds("all", "");
        expect(ids.totalCount).toBe(page.totalCount);
        expect(ids.itemIds.length).toBeGreaterThan(0);

        const loaded = await client.loadDashboardItems(ids.itemIds, 0, 10);
        expect(loaded.length).toBeGreaterThan(0);

        const byId = await client.getItemById(items[0]!.id);
        expect(byId.item.id).toBe(items[0]!.id);

        const source = await client.getItemSource(items[0]!.id);
        expect(typeof source).toBe("string");
        expect(source.length).toBeGreaterThan(0);

        await expect(client.listTags()).rejects.toMatchObject({
          code: "unimplemented",
        });
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
      const client = await connectCollectorIpcClient(host.ipcPath!);
      try {
        const created = await client.createItem({
          title: "IPC Note",
          content_type: "note",
          content: "# hello",
        });
        expect(created.title).toBe("IPC Note");

        const updated = await client.updateItem(created.id, {
          title: "IPC Note 2",
        });
        expect(updated.title).toBe("IPC Note 2");

        const source = await client.updateItemSource(
          created.id,
          "---\ntitle: IPC Note 2\n---\n\n# body\n",
        );
        expect(source.id).toBe(created.id);

        await client.deleteItem(created.id);
        await expect(client.getItemById(created.id)).rejects.toBeTruthy();
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("unimplemented domain methods fail fast without inventing defaults", async () => {
    const transport = {
      ping: async () => ({ ok: true as const, pong: true as const }),
      health: async () => ({
        ok: true,
        status: "healthy" as const,
        open: true,
        healthy: true,
      }),
      request: async () => {
        throw new Error("should not be called for unimplemented stubs");
      },
      close: async () => {},
    } satisfies ServiceIpcClient;

    const client = createCollectorIpcClient(transport);

    await expect(client.listTags()).rejects.toMatchObject({
      name: "ServiceIpcError",
      layer: "validation",
      code: "unimplemented",
    });

    expect(() => client.getAppSettingsSync()).toThrow(ServiceIpcError);
    expect(() => client.getAppSettingsSync()).toThrow(/getAppSettingsSync/);

    expect(() => client.getVaultIndexSyncStatus()).toThrow(/not implemented/);

    await expect(client.ensureActiveVault()).rejects.toMatchObject({
      code: "unimplemented",
    });

    // Must not return null / [] / empty snapshot as a stand-in.
    expect(() =>
      client.peekMatchingDashboardSnapshot({
        vaultId: "v",
        filter: "all",
        search: "",
      }),
    ).toThrow(ServiceIpcError);
  });
});
