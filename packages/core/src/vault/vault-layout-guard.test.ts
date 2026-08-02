import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { INBOX_FOLDER_NAME } from "@collector/shared";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createId } from "../util/ids.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createVault } from "./vault-operations.js";
import { upsertItem } from "./item-operations.js";
import {
  inspectVaultLayout,
  remediateVaultLayout,
} from "./vault-layout-guard.js";
import {
  isUuidMarkdownBasename,
  itemMarkdownPath,
  joinSegments,
  noteSharedMediaRoot,
} from "./paths.js";

describe("vault-layout-guard", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function seedVault() {
    dataDir = await mkdtemp(join(tmpdir(), "collector-layout-guard-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    return { ctx, meta, path };
  }

  it("renames non-uuid markdown in a collection folder", async () => {
    const { path } = await seedVault();
    await fs.mkdir(joinSegments(path, "Work"));
    // Seed via raw FS: upsertItem requires <uuid>.md for media paths (#279).
    await fs.writeText(
      joinSegments(path, "Work", "note.md"),
      "---\ntitle: Note\n---\n\nbody\n",
    );

    const before = await inspectVaultLayout(fs, path);
    expect(before.nonUuidMarkdown).toContain("Work/note.md");
    expect(before.ok).toBe(false);

    const report = await remediateVaultLayout(fs, path);
    expect(report.renamed).toBeGreaterThanOrEqual(1);
    expect(await fs.exists(itemMarkdownPath(path, "Work/note.md"))).toBe(false);

    const workEntries = await fs.readDir(joinSegments(path, "Work"));
    const md = workEntries.filter((n) => n.endsWith(".md"));
    expect(md).toHaveLength(1);
    expect(isUuidMarkdownBasename(md[0]!)).toBe(true);

    const after = await inspectVaultLayout(fs, path);
    expect(after.ok).toBe(true);
    expect(after.nonUuidMarkdown).toEqual([]);
  });

  it("moves root markdown into Inbox with uuid name", async () => {
    const { path } = await seedVault();
    await fs.writeText(joinSegments(path, "a.md"), "---\ntitle: A\n---\n");

    const report = await remediateVaultLayout(fs, path);
    expect(report.movedRootNotes).toBe(1);
    expect(await fs.exists(joinSegments(path, "a.md"))).toBe(false);

    const inbox = await fs.readDir(joinSegments(path, INBOX_FOLDER_NAME));
    const moved = inbox.filter((n) => isUuidMarkdownBasename(n));
    expect(moved.length).toBeGreaterThanOrEqual(1);
    expect((await inspectVaultLayout(fs, path)).rootMarkdown).toEqual([]);
  });

  it("imports root and nested loose files into Inbox + media/<uuid>/", async () => {
    const { path } = await seedVault();
    await fs.writeBinary(joinSegments(path, "shot.png"), new Uint8Array([1, 2]));
    await fs.mkdir(joinSegments(path, "Work"));
    await fs.writeBinary(
      joinSegments(path, "Work", "doc.pdf"),
      new Uint8Array([3, 4]),
    );

    const report = await remediateVaultLayout(fs, path);
    expect(report.importedLoose).toBe(2);
    expect(await fs.exists(joinSegments(path, "shot.png"))).toBe(false);
    expect(await fs.exists(joinSegments(path, "Work", "doc.pdf"))).toBe(false);

    const inboxMd = (await fs.readDir(joinSegments(path, INBOX_FOLDER_NAME))).filter(
      (n) => isUuidMarkdownBasename(n),
    );
    expect(inboxMd.length).toBeGreaterThanOrEqual(2);

    let foundShot = false;
    let foundDoc = false;
    for (const name of inboxMd) {
      const uuid = name.slice(0, -3);
      const mediaRoot = noteSharedMediaRoot(path, uuid);
      if (await fs.exists(joinSegments(mediaRoot, "shot.png"))) {
        foundShot = true;
      }
      if (await fs.exists(joinSegments(mediaRoot, "doc.pdf"))) {
        foundDoc = true;
      }
    }
    expect(foundShot).toBe(true);
    expect(foundDoc).toBe(true);
    expect((await inspectVaultLayout(fs, path)).ok).toBe(true);
  });

  it("does not touch media/<uuid>/ or *.media sidecars", async () => {
    const { path } = await seedVault();
    const uuid = createId();
    const mediaFile = joinSegments(noteSharedMediaRoot(path, uuid), "keep.bin");
    await fs.mkdir(noteSharedMediaRoot(path, uuid));
    await fs.writeBinary(mediaFile, new Uint8Array([9]));
    await fs.mkdir(joinSegments(path, "note.media"));
    await fs.writeText(joinSegments(path, "note.media", "x.txt"), "x");

    const report = await remediateVaultLayout(fs, path);
    expect(report.importedLoose).toBe(0);
    expect(await fs.exists(mediaFile)).toBe(true);
    expect(await fs.exists(joinSegments(path, "note.media", "x.txt"))).toBe(
      true,
    );
  });

  it("second remediate on clean tree is a no-op", async () => {
    const { ctx, meta, path } = await seedVault();
    const id = `${INBOX_FOLDER_NAME}/${createId()}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: {
        id,
        vault_id: meta.id,
        title: "Ok",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: INBOX_FOLDER_NAME,
        content_revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: "ok",
    });

    expect((await inspectVaultLayout(fs, path)).ok).toBe(true);
    const report = await remediateVaultLayout(fs, path);
    expect(report).toEqual({
      renamed: 0,
      movedRootNotes: 0,
      importedLoose: 0,
    });
  });
});
