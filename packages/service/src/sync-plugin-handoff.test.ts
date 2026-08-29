import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AttachMediaFileInput, NormalizedSyncItem } from "@collector/api";
import type { VaultMeta } from "@collector/shared";
import {
  SqlVaultIndexStore,
  createVault,
  itemMarkdownPath,
  listItemMediaWithPaths,
  readItemFile,
  readItemRawMarkdown,
  readItemSourceRef,
  type VaultContext,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import { MemorySqlAdapter } from "../../core/src/testing/memory-sql.js";
import { createItemsCrud } from "./items-crud.js";
import { createMediaCoverService } from "./media-cover.js";
import { createSyncPluginHandoff } from "./sync-plugin-handoff.js";

describe("createSyncPluginHandoff vault handoff", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function openHandoff(options?: {
    failAttachWith?: Error;
    nextItemId?: string;
  }): Promise<{
    handoff: ReturnType<typeof createSyncPluginHandoff>;
    ctx: VaultContext;
    vault: VaultMeta;
    vaultPath: string;
    index: SqlVaultIndexStore;
  }> {
    dataDir = await mkdtemp(join(tmpdir(), "collector-sync-handoff-"));
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx: VaultContext = { fs, index };
    const { meta: vault, path: vaultPath } = await createVault(ctx, dataDir, {
      name: "Vault",
    });

    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({ path: vaultPath, vault }),
        getContext: () => ctx,
        getIndex: () => index,
        normalizeMarkdown: (raw: string) => ({ text: raw, changed: false }),
        enqueueItemDerivedRefresh: async () => undefined,
        enqueueItemExtractAuto: async () => undefined,
      } as never,
      () => options?.nextItemId ?? crypto.randomUUID(),
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

    const attachMediaFiles = options?.failAttachWith
      ? async (_itemId: string, _files: AttachMediaFileInput[]) => {
          throw options.failAttachWith;
        }
      : (itemId: string, files: AttachMediaFileInput[]) =>
          media.attachMediaFiles(itemId, files);

    return {
      handoff: createSyncPluginHandoff({
        createItem: (input) => crud.createItem(input),
        attachMediaFiles,
        deleteItem: (itemId) => crud.deleteItem(itemId),
      }),
      ctx,
      vault,
      vaultPath,
      index,
    };
  }

  const baseItem: NormalizedSyncItem = {
    remoteId: "r1",
    title: "Hello",
    content_type: "note",
    body: "body text",
  };

  it("importItem writes note to vault Inbox without media", async () => {
    const { handoff, ctx, vault, vaultPath } = await openHandoff();

    const result = await handoff.importItem(baseItem);

    expect(result.remoteId).toBe("r1");
    expect(result.itemId).toMatch(/^Inbox\/[0-9a-f-]{36}\.md$/);
    expect(await fs.exists(itemMarkdownPath(vaultPath, result.itemId))).toBe(
      true,
    );

    const onDisk = await readItemFile(fs, vaultPath, result.itemId, vault.id);
    expect(onDisk.title).toBe("Hello");
    expect(onDisk.content_type).toBe("note");
    expect(onDisk.source_type).toBe("plugin");
    expect(onDisk.folder_path).toBe("Inbox");
    expect(await readItemRawMarkdown(fs, vaultPath, result.itemId)).toContain(
      "body text",
    );
    expect(await listItemMediaWithPaths(ctx, vaultPath, result.itemId)).toHaveLength(
      0,
    );
  });

  it("importItem persists sourceRef and folder_path on disk", async () => {
    const { handoff, vault, vaultPath } = await openHandoff();

    const result = await handoff.importItem({
      ...baseItem,
      folder_path: "Projects",
      sourceRef: {
        plugin_id: "mock",
        external_id: "ext-1",
      },
    });

    expect(result.itemId).toMatch(/^Projects\/[0-9a-f-]{36}\.md$/);
    const onDisk = await readItemFile(fs, vaultPath, result.itemId, vault.id);
    expect(onDisk.folder_path).toBe("Projects");
    expect(onDisk.source_type).toBe("plugin");
    expect(await readItemSourceRef(fs, vaultPath, result.itemId)).toEqual({
      plugin_id: "mock",
      external_id: "ext-1",
    });
  });

  it("importItem attaches media bytes on disk and indexes the item", async () => {
    const { handoff, ctx, vault, vaultPath, index } = await openHandoff();
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    const result = await handoff.importItem({
      ...baseItem,
      content_type: "image",
      media: [{ name: "a.png", bytes }],
    });

    const media = await listItemMediaWithPaths(ctx, vaultPath, result.itemId);
    expect(media).toHaveLength(1);
    expect(media[0]?.filename).toBe("a.png");
    expect(await fs.exists(media[0]!.absolute_path)).toBe(true);
    expect(await fs.readBinary(media[0]!.absolute_path)).toEqual(bytes);

    const indexed = await index.listItemFilesByIds(vault.id, [result.itemId]);
    expect(indexed).toHaveLength(1);
    expect(indexed[0]?.id).toBe(result.itemId);
    expect(indexed[0]?.content_type).toBe("image");
  });

  it("on attach failure deletes the created item from the vault", async () => {
    const noteId = "11111111-1111-4111-8111-111111111111";
    const itemId = `Inbox/${noteId}.md`;
    const { handoff, vaultPath } = await openHandoff({
      nextItemId: noteId,
      failAttachWith: new Error("FOREIGN KEY constraint failed"),
    });

    await expect(
      handoff.importItem({
        ...baseItem,
        media: [{ name: "a.png", bytes: new Uint8Array([1]) }],
      }),
    ).rejects.toThrow(/FOREIGN KEY/);

    expect(await fs.exists(itemMarkdownPath(vaultPath, itemId))).toBe(false);
  });

  it("createFromNormalized does not attach media", async () => {
    const { handoff, ctx, vault, vaultPath } = await openHandoff();

    const result = await handoff.createFromNormalized({
      ...baseItem,
      media: [{ name: "a.png", bytes: new Uint8Array([1]) }],
    });

    expect(result.remoteId).toBe("r1");
    expect(result.itemId).toMatch(/^Inbox\/[0-9a-f-]{36}\.md$/);
    const onDisk = await readItemFile(fs, vaultPath, result.itemId, vault.id);
    expect(onDisk.title).toBe("Hello");
    expect(await listItemMediaWithPaths(ctx, vaultPath, result.itemId)).toHaveLength(
      0,
    );
  });

  it("rejects empty remoteId", async () => {
    const { handoff } = await openHandoff();
    await expect(
      handoff.importItem({ ...baseItem, remoteId: "  " }),
    ).rejects.toThrow(/remoteId/);
  });
});
