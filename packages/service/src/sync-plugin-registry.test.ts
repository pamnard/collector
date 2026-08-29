/**
 * Sync plugin registry — real vault handoff + disk cursor (not createItem vi.fn theater).
 * Mock only SyncPlugin pull source / failures; assert markdown on disk and cursor state.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NormalizedSyncItem, SyncPlugin } from "@collector/api";
import {
  SqlVaultIndexStore,
  createVault,
  itemMarkdownPath,
  readItemFile,
  type VaultContext,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import { MemorySqlAdapter } from "../../core/src/testing/memory-sql.js";
import { createItemsCrud } from "./items-crud.js";
import { createMediaCoverService } from "./media-cover.js";
import { createMockSyncPlugin } from "./sync-plugin-mock.js";
import {
  createSyncPluginRegistry,
  MOCK_SYNC_PLUGIN_ID,
  SYNC_PLUGIN_STATE_DIR,
} from "./sync-plugin-registry.js";

describe("createSyncPluginRegistry (#29 / #899)", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  function note(remoteId: string, title: string): NormalizedSyncItem {
    return {
      remoteId,
      title,
      content_type: "note",
      body: title,
    };
  }

  async function openRegistry(options?: {
    catalog?: SyncPlugin[];
  }): Promise<{
    registry: ReturnType<typeof createSyncPluginRegistry>;
    vaultPath: string;
    vaultId: string;
  }> {
    dataDir = await mkdtemp(join(tmpdir(), "collector-sync-reg-"));
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx: VaultContext = { fs, index };
    const { meta: vault, path: vaultPath } = await createVault(ctx, dataDir, {
      name: "Vault",
    });
    const vaultId = vault.id;

    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({ path: vaultPath, vault }),
        getContext: () => ctx,
        getIndex: () => index,
        normalizeMarkdown: (raw: string) => ({ text: raw, changed: false }),
        enqueueItemDerivedRefresh: async () => undefined,
        enqueueItemExtractAuto: async () => undefined,
      } as never,
      () => crypto.randomUUID(),
    );

    const media = createMediaCoverService({
      resolveActiveVault: async () => ({ path: vaultPath, vault }),
      getContext: () => ctx,
      enqueueGenerateCover: async () => ({ id: "cover-job" }),
      waitForCoverJob: async () => "succeeded" as const,
      cancelPendingGenerateCoversForItem: async () => 0,
      resolveThumbnailPathsProgressive: async () => undefined,
      readCoverPixelSize: async () => ({ width: 1, height: 1 }),
    });

    const catalog = options?.catalog;
    const registry = createSyncPluginRegistry({
      fs,
      dataDir,
      resolveActiveVaultId: async () => vaultId,
      createItem: (input) => crud.createItem(input),
      attachMediaFiles: (itemId, files) => media.attachMediaFiles(itemId, files),
      deleteItem: (itemId) => crud.deleteItem(itemId),
      createCatalog: catalog !== undefined ? () => catalog : undefined,
    });

    return { registry, vaultPath, vaultId };
  }

  async function readCursor(
    vaultId: string,
    pluginId: string,
  ): Promise<string | null | undefined> {
    const statePath = join(dataDir, SYNC_PLUGIN_STATE_DIR, `${vaultId}.json`);
    if (!(await fs.exists(statePath))) {
      return undefined;
    }
    const raw = JSON.parse(await fs.readText(statePath)) as {
      cursors: Record<string, string | null>;
    };
    return raw.cursors[pluginId];
  }

  it("syncNow creates vault notes and persists cursor; second run imports nothing", async () => {
    const mock = createMockSyncPlugin({
      id: MOCK_SYNC_PLUGIN_ID,
      items: [note("a", "Alpha"), note("b", "Beta")],
    });
    const { registry, vaultPath, vaultId } = await openRegistry({
      catalog: [mock],
    });

    const result = await registry.syncNow(MOCK_SYNC_PLUGIN_ID);
    expect(result.importedCount).toBe(2);
    expect(result.itemIds).toHaveLength(2);

    for (const itemId of result.itemIds) {
      expect(await fs.exists(itemMarkdownPath(vaultPath, itemId))).toBe(true);
    }
    const first = await readItemFile(
      fs,
      vaultPath,
      result.itemIds[0]!,
      vaultId,
    );
    const second = await readItemFile(
      fs,
      vaultPath,
      result.itemIds[1]!,
      vaultId,
    );
    expect(first.title).toBe("Alpha");
    expect(second.title).toBe("Beta");
    expect(first.source_type).toBe("plugin");

    const cursor = await readCursor(vaultId, MOCK_SYNC_PLUGIN_ID);
    expect(cursor).toMatch(/^mock:1:/);

    const empty = await registry.syncNow(MOCK_SYNC_PLUGIN_ID);
    expect(empty.importedCount).toBe(0);
    expect(empty.itemIds).toEqual([]);
    expect(await readCursor(vaultId, MOCK_SYNC_PLUGIN_ID)).toMatch(/^mock:2:/);

    const inbox = join(vaultPath, "Inbox");
    const notes = (await fs.readDir(inbox)).filter((name) =>
      name.endsWith(".md"),
    );
    expect(notes).toHaveLength(2);
  });

  it("unknown pluginId throws", async () => {
    const { registry } = await openRegistry({
      catalog: [createMockSyncPlugin()],
    });

    await expect(registry.syncNow("nope")).rejects.toThrow(
      /Unknown sync plugin/,
    );
  });

  it("default catalog is empty", async () => {
    const { registry } = await openRegistry();

    await expect(registry.syncNow(MOCK_SYNC_PLUGIN_ID)).rejects.toThrow(
      /Unknown sync plugin/,
    );
  });

  it("pull failure does not persist cursor or vault notes", async () => {
    const failing: SyncPlugin = {
      id: "fail",
      async pull() {
        throw new Error("pull exploded");
      },
    };
    const { registry, vaultPath, vaultId } = await openRegistry({
      catalog: [failing],
    });

    await expect(registry.syncNow("fail")).rejects.toThrow(/pull exploded/);
    expect(
      await fs.exists(join(dataDir, SYNC_PLUGIN_STATE_DIR, `${vaultId}.json`)),
    ).toBe(false);

    const inbox = join(vaultPath, "Inbox");
    const leftovers = (await fs.exists(inbox))
      ? (await fs.readDir(inbox)).filter((name) => name.endsWith(".md"))
      : [];
    expect(leftovers).toEqual([]);
  });

  it("serializes concurrent syncNow and coalesces into one follow-up run", async () => {
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
    const { registry, vaultPath, vaultId } = await openRegistry({
      catalog: [slow],
    });

    const first = registry.syncNow("slow");
    await vi.waitFor(() => expect(pullCount).toBe(1));
    const second = registry.syncNow("slow");
    const third = registry.syncNow("slow");
    expect(pullCount).toBe(1);

    releasePull();
    const results = await Promise.all([first, second, third]);
    expect(pullCount).toBe(2);
    expect(results.every((r) => r.importedCount === 1)).toBe(true);
    expect(results[0]?.itemIds).toEqual(results[1]?.itemIds);
    expect(results[1]?.itemIds).toEqual(results[2]?.itemIds);

    const inbox = join(vaultPath, "Inbox");
    const notes = (await fs.readDir(inbox)).filter((name) =>
      name.endsWith(".md"),
    );
    expect(notes).toHaveLength(2);
    const titles = new Set<string>();
    for (const name of notes) {
      const item = await readItemFile(fs, vaultPath, `Inbox/${name}`, vaultId);
      titles.add(item.title);
    }
    expect(titles).toEqual(new Set(["T-1", "T-2"]));
    expect(await readCursor(vaultId, "slow")).toBe("c-2");
  });
});
