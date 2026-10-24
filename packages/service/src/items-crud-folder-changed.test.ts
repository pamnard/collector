import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqlVaultIndexStore, createVault } from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import { MemorySqlAdapter } from "../../core/src/testing/memory-sql.js";
import { createItemsCrud } from "./items-crud.js";
import type { VaultPresentationChangedPayload } from "./vault-presentation-changed.js";

describe("createItem folderChanged for new nested folders", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("emits folderChanged then itemCreated for a new folder; second create is itemCreated only", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-create-folder-changed-"));
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const events: VaultPresentationChangedPayload[] = [];

    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({ path, vault: meta }),
        getContext: () => ctx,
        getIndex: () => index,
        normalizeMarkdown: (raw: string) => ({ text: raw, changed: false }),
        enqueueItemDerivedRefresh: async () => undefined,
        enqueueItemExtractAuto: async () => undefined,
        onVaultPresentationChanged: (payload) => {
          events.push(payload);
        },
      } as never,
      () => crypto.randomUUID(),
    );

    await crud.createItem({
      title: "First",
      content_type: "note",
      content: "hi",
      folder_path: "Inbox/Analytics",
    });

    expect(events.map((e) => e.kind)).toEqual([
      "folderChanged",
      "itemCreated",
    ]);
    expect(events[0]).toMatchObject({
      kind: "folderChanged",
      folderPath: "Inbox/Analytics",
    });
    expect(events[1]).toMatchObject({
      kind: "itemCreated",
      folderPath: "Inbox/Analytics",
    });

    events.length = 0;
    await crud.createItem({
      title: "Second",
      content_type: "note",
      content: "hi2",
      folder_path: "Inbox/Analytics",
    });

    expect(events.map((e) => e.kind)).toEqual(["itemCreated"]);
  });
});
