import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeFileSystemAdapter } from "@collector/core/node";
import type { NormalizedSyncItem, SyncPlugin } from "@collector/api";
import {
  createSyncPluginRegistry,
  MOCK_SYNC_PLUGIN_ID,
  SYNC_PLUGIN_STATE_DIR,
} from "./sync-plugin-registry.js";
import { createMockSyncPlugin } from "./sync-plugin-mock.js";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "collector-sync-reg-"));
  dirs.push(dir);
  return dir;
}

function note(remoteId: string, title: string): NormalizedSyncItem {
  return {
    remoteId,
    title,
    content_type: "note",
    body: title,
  };
}

describe("createSyncPluginRegistry (#29)", () => {
  it("syncNow with mock catalog creates items and persists cursor", async () => {
    const dataDir = await tempDataDir();
    const fs = new NodeFileSystemAdapter();
    const createItem = vi.fn(async (input: { title: string }) => ({
      id: `Inbox/${input.title}.md`,
      title: input.title,
    }));
    const mock = createMockSyncPlugin({
      id: MOCK_SYNC_PLUGIN_ID,
      items: [note("a", "A"), note("b", "B")],
    });

    const registry = createSyncPluginRegistry({
      fs,
      dataDir,
      resolveActiveVaultId: async () => "vault-1",
      createItem,
      attachMediaFiles: vi.fn(async () => []),
      createCatalog: () => [mock],
    });

    const result = await registry.syncNow(MOCK_SYNC_PLUGIN_ID);
    expect(result.importedCount).toBe(2);
    expect(result.itemIds).toEqual(["Inbox/A.md", "Inbox/B.md"]);
    expect(createItem).toHaveBeenCalledTimes(2);
    expect(mock.pending()).toEqual([]);

    const statePath = join(dataDir, SYNC_PLUGIN_STATE_DIR, "vault-1.json");
    const raw = JSON.parse(await fs.readText(statePath)) as {
      cursors: Record<string, string | null>;
    };
    expect(raw.cursors[MOCK_SYNC_PLUGIN_ID]).toMatch(/^mock:1:/);

    const second = await registry.syncNow(MOCK_SYNC_PLUGIN_ID);
    expect(second.importedCount).toBe(0);
    expect(createItem).toHaveBeenCalledTimes(2);
  });

  it("unknown pluginId throws", async () => {
    const dataDir = await tempDataDir();
    const registry = createSyncPluginRegistry({
      fs: new NodeFileSystemAdapter(),
      dataDir,
      resolveActiveVaultId: async () => "vault-1",
      createItem: vi.fn(),
      attachMediaFiles: vi.fn(),
    });

    await expect(registry.syncNow("nope")).rejects.toThrow(
      /Unknown sync plugin/,
    );
  });

  it("default catalog is empty", async () => {
    const dataDir = await tempDataDir();
    const registry = createSyncPluginRegistry({
      fs: new NodeFileSystemAdapter(),
      dataDir,
      resolveActiveVaultId: async () => "vault-1",
      createItem: vi.fn(),
      attachMediaFiles: vi.fn(),
    });

    await expect(registry.syncNow(MOCK_SYNC_PLUGIN_ID)).rejects.toThrow(
      /Unknown sync plugin/,
    );
  });

  it("pull failure does not persist cursor", async () => {
    const dataDir = await tempDataDir();
    const fs = new NodeFileSystemAdapter();
    const failing: SyncPlugin = {
      id: "fail",
      async pull() {
        throw new Error("pull exploded");
      },
    };

    const registry = createSyncPluginRegistry({
      fs,
      dataDir,
      resolveActiveVaultId: async () => "vault-1",
      createItem: vi.fn(),
      attachMediaFiles: vi.fn(),
      createCatalog: () => [failing],
    });

    await expect(registry.syncNow("fail")).rejects.toThrow(/pull exploded/);
    expect(await fs.exists(join(dataDir, SYNC_PLUGIN_STATE_DIR, "vault-1.json"))).toBe(
      false,
    );
  });

  it("serializes concurrent syncNow and coalesces into one follow-up run", async () => {
    const dataDir = await tempDataDir();
    let releasePull!: () => void;
    const pullGate = new Promise<void>((resolve) => {
      releasePull = resolve;
    });
    let pullCount = 0;
    const slow: SyncPlugin = {
      id: "slow",
      async pull() {
        pullCount += 1;
        if (pullCount === 1) {
          await pullGate;
        }
        return {
          items: [note(`r-${pullCount}`, `T-${pullCount}`)],
          nextCursor: `c-${pullCount}`,
        };
      },
    };
    const createItem = vi.fn(async (input: { title: string }) => ({
      id: `Inbox/${input.title}.md`,
      title: input.title,
    }));
    const registry = createSyncPluginRegistry({
      fs: new NodeFileSystemAdapter(),
      dataDir,
      resolveActiveVaultId: async () => "vault-1",
      createItem,
      attachMediaFiles: vi.fn(async () => []),
      createCatalog: () => [slow],
    });

    const first = registry.syncNow("slow");
    await vi.waitFor(() => expect(pullCount).toBe(1));
    const second = registry.syncNow("slow");
    const third = registry.syncNow("slow");
    expect(pullCount).toBe(1);

    releasePull();
    const results = await Promise.all([first, second, third]);
    expect(pullCount).toBe(2);
    expect(createItem).toHaveBeenCalledTimes(2);
    expect(results.every((r) => r.importedCount === 1)).toBe(true);
    expect(results[0]?.itemIds).toEqual(results[1]?.itemIds);
    expect(results[1]?.itemIds).toEqual(results[2]?.itemIds);
  });
});
