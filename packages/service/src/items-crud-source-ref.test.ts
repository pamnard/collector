import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SqlVaultIndexStore,
  createVault,
  itemSourcePath,
  readItemFile,
  readItemSourceRef,
} from "@collector/core";
import { NodeFileSystemAdapter } from "@collector/core/node";
import { MemorySqlAdapter } from "../../core/src/testing/memory-sql.js";
import { createItemsCrud } from "./items-crud.js";

describe("createItemsCrud sourceRef on disk (#28)", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function openCrud() {
    dataDir = await mkdtemp(join(tmpdir(), "collector-source-ref-"));
    const sql = new MemorySqlAdapter();
    const index = new SqlVaultIndexStore(sql);
    const ctx = { fs, index };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    const crud = createItemsCrud(
      {
        resolveActiveVault: async () => ({ path, vault: meta }),
        getContext: () => ctx,
        getIndex: () => index,
        normalizeMarkdown: (raw: string) => ({ text: raw, changed: false }),
        enqueueItemDerivedRefresh: async () => undefined,
        enqueueItemExtractAuto: async () => undefined,
      } as never,
      () => crypto.randomUUID(),
    );
    return { crud, meta, path };
  }

  it("createItem writes sourceRef sidecar under media/ and returns the note", async () => {
    const { crud, meta, path } = await openCrud();
    const sourceRef = {
      plugin_id: "mock",
      external_id: "ext-1",
    };

    const created = await crud.createItem({
      title: "Provenance note",
      content_type: "note",
      content: "body with source",
      source_type: "plugin",
      sourceRef,
    });

    expect(created.id).toMatch(/^Inbox\/[0-9a-f-]{36}\.md$/);
    expect(await fs.exists(itemSourcePath(path, created.id))).toBe(true);
    expect(await readItemSourceRef(fs, path, created.id)).toEqual(sourceRef);

    const onDisk = await readItemFile(fs, path, created.id, meta.id);
    expect(onDisk.title).toBe("Provenance note");
    expect(onDisk.source_type).toBe("plugin");
  });

  it("updateItem keeps sourceRef sidecar after metadata and body changes", async () => {
    const { crud, path } = await openCrud();
    const sourceRef = {
      plugin_id: "mock",
      external_id: "ext-keep",
      metadata: { channel: "tests" },
    };

    const created = await crud.createItem({
      title: "Before",
      content_type: "note",
      content: "original body",
      sourceRef,
    });

    await crud.updateItem(created.id, { title: "After" });
    expect(await readItemSourceRef(fs, path, created.id)).toEqual(sourceRef);
    expect(await fs.exists(itemSourcePath(path, created.id))).toBe(true);

    await crud.updateItem(created.id, { content: "revised body" });
    expect(await readItemSourceRef(fs, path, created.id)).toEqual(sourceRef);
    expect(await fs.exists(itemSourcePath(path, created.id))).toBe(true);

    const onDisk = await readItemFile(
      fs,
      path,
      created.id,
      created.vault_id,
    );
    expect(onDisk.title).toBe("After");
  });

  it("createItem without sourceRef leaves no source sidecar", async () => {
    const { crud, path } = await openCrud();

    const created = await crud.createItem({
      title: "Manual note",
      content_type: "note",
      content: "no provenance",
    });

    expect(await readItemSourceRef(fs, path, created.id)).toBeNull();
    expect(await fs.exists(itemSourcePath(path, created.id))).toBe(false);
  });
});
