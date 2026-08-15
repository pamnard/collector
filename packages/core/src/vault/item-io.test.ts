import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ItemFile, SourceRef, Tag } from "@collector/shared";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createId, nowIso } from "../util/ids.js";
import { createVault } from "./vault-operations.js";
import { readTagsFile, writeTagsFile } from "./tag-io.js";
import { itemMarkdownPath, vaultMetaPath } from "./paths.js";
import {
  ensureTagsByName,
  itemFileFromDocumentMarkdown,
  loadTagMaps,
  readItemContent,
  readItemDocument,
  readItemRawMarkdown,
  readItemSourceRef,
  readVaultMeta,
  writeItemContent,
  writeItemDocument,
  writeItemFile,
  writeItemSourceRef,
  writeVaultMeta,
  type TagMapsHolder,
} from "./item-io.js";

describe("item-io", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function seedVault() {
    dataDir = await mkdtemp(join(tmpdir(), "collector-item-io-"));
    const ctx = { fs, index: new SqlVaultIndexStore(new MemorySqlAdapter()) };
    return createVault(ctx, dataDir, { name: "Vault" });
  }

  function sampleItem(
    vaultId: string,
    itemId: string,
    overrides: Partial<ItemFile> = {},
  ): ItemFile {
    const ts = nowIso();
    return {
      id: itemId,
      vault_id: vaultId,
      title: "Hello",
      description: "desc",
      url: null,
      content_type: "note",
      source_type: "manual",
      source_id: null,
      metadata: {},
      properties: {},
      thumbnail: null,
      tag_ids: [],
      collection_ids: [],
      folder_path: "",
      content_revision: 1,
      word_count: 0,
      character_count: 0,
      created_at: ts,
      updated_at: ts,
      ...overrides,
    };
  }

  it("readVaultMeta / writeVaultMeta round-trip; invalid meta throws", async () => {
    const { meta, path } = await seedVault();
    const loaded = await readVaultMeta(fs, path);
    expect(loaded).toEqual(meta);

    await writeVaultMeta(fs, path, { ...meta, name: "Renamed" });
    expect((await readVaultMeta(fs, path)).name).toBe("Renamed");

    await fs.writeText(vaultMetaPath(path), "{not-json");
    await expect(readVaultMeta(fs, path)).rejects.toThrow();

    await fs.writeText(
      vaultMetaPath(path),
      JSON.stringify({ id: "not-a-uuid", name: "x" }),
    );
    await expect(readVaultMeta(fs, path)).rejects.toThrow();
  });

  it("ensureTagsByName: empty / blank / create / skip write / stale re-read", async () => {
    const { path } = await seedVault();

    const empty = await ensureTagsByName(fs, path, []);
    expect(empty.byName.size).toBe(0);

    await expect(ensureTagsByName(fs, path, ["  "])).rejects.toThrow(
      /non-empty/i,
    );

    const created = await ensureTagsByName(fs, path, ["Focus"]);
    expect(created.byName.has("focus")).toBe(true);
    const onDisk = await readTagsFile(fs, path);
    expect(onDisk.tags.map((t) => t.name)).toEqual(["Focus"]);

    const readSpy = vi.spyOn(fs, "readText");
    const writeSpy = vi.spyOn(fs, "writeText");
    const again = await ensureTagsByName(fs, path, ["Focus"], created);
    expect(again.byName.get("focus")?.id).toBe(created.byName.get("focus")?.id);
    expect(
      writeSpy.mock.calls.some((call) => String(call[0]).endsWith("tags.json")),
    ).toBe(false);
    readSpy.mockRestore();
    writeSpy.mockRestore();

    const concurrent: Tag = {
      id: createId(),
      name: "Research",
      color: null,
      created_at: nowIso(),
    };
    await writeTagsFile(fs, path, {
      tags: [...onDisk.tags, concurrent],
    });
    const stale = await loadTagMaps(fs, path);
    // Simulate caller holding maps without Research while disk already has it.
    stale.byName.delete("research");
    stale.byId.delete(concurrent.id);
    const resolved = await ensureTagsByName(fs, path, ["Research"], stale);
    expect(resolved.byName.get("research")?.id).toBe(concurrent.id);
    const tagsAfter = await readTagsFile(fs, path);
    expect(tagsAfter.tags.filter((t) => t.name === "Research")).toHaveLength(1);
  });

  it("itemFileFromDocumentMarkdown creates missing tags and updates holder", async () => {
    const { meta, path } = await seedVault();
    const itemId = `${createId()}.md`;
    const raw = `---
title: Note
tags:
  - NewTag
created: 2024-01-01T00:00:00.000Z
updated: 2024-01-01T00:00:00.000Z
---
body
`;
    const holder: TagMapsHolder = { maps: await loadTagMaps(fs, path) };
    const item = await itemFileFromDocumentMarkdown(
      fs,
      path,
      meta.id,
      itemId,
      raw,
      Date.now(),
      holder,
    );
    expect(item.title).toBe("Note");
    expect(item.tag_ids).toHaveLength(1);
    expect(holder.maps.byName.has("newtag")).toBe(true);
    expect((await readTagsFile(fs, path)).tags.map((t) => t.name)).toContain(
      "NewTag",
    );

    const again = await itemFileFromDocumentMarkdown(
      fs,
      path,
      meta.id,
      itemId,
      raw,
      Date.now(),
      holder,
    );
    expect(again.tag_ids).toEqual(item.tag_ids);
  });

  it("itemFileFromDocumentMarkdown serializes concurrent missing-tag creates on one holder", async () => {
    const { meta, path } = await seedVault();
    const holder: TagMapsHolder = { maps: await loadTagMaps(fs, path) };
    const tagNames = ["Alpha", "Beta", "Gamma", "Delta"];
    const diskMtimeMs = Date.now();

    await Promise.all(
      tagNames.map(async (tagName, index) => {
        const raw = `---
title: Note ${index}
tags:
  - ${tagName}
created: 2024-01-01T00:00:00.000Z
updated: 2024-01-01T00:00:00.000Z
---
body
`;
        return itemFileFromDocumentMarkdown(
          fs,
          path,
          meta.id,
          `${createId()}.md`,
          raw,
          diskMtimeMs,
          holder,
        );
      }),
    );

    for (const tagName of tagNames) {
      expect(holder.maps.byName.has(tagName.toLowerCase())).toBe(true);
    }
    const onDisk = await readTagsFile(fs, path);
    expect(onDisk.tags.map((t) => t.name).sort()).toEqual([...tagNames].sort());
    expect(onDisk.tags).toHaveLength(tagNames.length);
  });

  it("readItemDocument / readItemRawMarkdown: missing throws; happy path", async () => {
    const { meta, path } = await seedVault();
    const itemId = `${createId()}.md`;
    await expect(
      readItemDocument(fs, path, itemId, meta.id),
    ).rejects.toThrow(/Missing item document/);
    await expect(readItemRawMarkdown(fs, path, itemId)).rejects.toThrow(
      /Missing item document/,
    );

    const item = sampleItem(meta.id, itemId);
    await writeItemDocument(fs, path, item, "# Body\n");
    const doc = await readItemDocument(fs, path, itemId, meta.id);
    expect(doc.item.title).toBe("Hello");
    expect(doc.body).toBe("# Body\n");
    const raw = await readItemRawMarkdown(fs, path, itemId);
    expect(raw).toContain("title:");
    expect(raw).toContain("# Body");
  });

  it("writeItemFile preserves body and unknown frontmatter keys", async () => {
    const { meta, path } = await seedVault();
    const itemId = `${createId()}.md`;
    const md = `---
title: Original
custom_key: keep-me
created: 2024-01-01T00:00:00.000Z
updated: 2024-01-01T00:00:00.000Z
---
# Keep body
`;
    await fs.mkdir(path);
    await fs.writeText(itemMarkdownPath(path, itemId), md);

    await writeItemFile(fs, path, sampleItem(meta.id, itemId, { title: "Updated" }));
    const raw = await readItemRawMarkdown(fs, path, itemId);
    expect(raw).toContain("title: Updated");
    expect(raw).toContain("custom_key: keep-me");
    expect(raw).toContain("# Keep body");
  });

  it("readItemContent / writeItemContent: null missing; body replace keeps meta", async () => {
    const { meta, path } = await seedVault();
    const itemId = `${createId()}.md`;
    expect(await readItemContent(fs, path, itemId)).toBeNull();

    await writeItemDocument(
      fs,
      path,
      sampleItem(meta.id, itemId, { title: "T" }),
      "old body",
    );
    expect(await readItemContent(fs, path, itemId)).toBe("old body");

    await writeItemContent(fs, path, itemId, "new body", meta.id);
    expect(await readItemContent(fs, path, itemId)).toBe("new body");
    const doc = await readItemDocument(fs, path, itemId, meta.id);
    expect(doc.item.title).toBe("T");
  });

  it("readItemSourceRef / writeItemSourceRef: null and round-trip", async () => {
    const { path } = await seedVault();
    const itemId = `${createId()}.md`;
    expect(await readItemSourceRef(fs, path, itemId)).toBeNull();

    const ref: SourceRef = {
      plugin_id: "web",
      external_id: "abc-123",
      synced_at: "2024-06-01T12:00:00.000Z",
      metadata: { n: 1 },
    };
    await writeItemSourceRef(fs, path, itemId, ref);
    expect(await readItemSourceRef(fs, path, itemId)).toEqual(ref);
  });
});
