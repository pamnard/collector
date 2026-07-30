import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createVault } from "./vault-operations.js";
import { resolveOrCreateInboxFolder } from "./inbox-layout.js";
import { listFolderRelativePaths, listItemRelativePaths } from "./scan.js";
import { joinSegments } from "./paths.js";

describe("vault scan (#278)", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function seedEmptyVault() {
    dataDir = await mkdtemp(join(tmpdir(), "collector-scan-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { path } = await createVault(ctx, dataDir, { name: "Vault" });
    return path;
  }

  it("skips loose non-md files and does not abort", async () => {
    const vaultPath = await seedEmptyVault();
    await mkdir(joinSegments(vaultPath, "Work"), { recursive: true });
    await writeFile(joinSegments(vaultPath, "Work", "note.md"), "# note\n");
    await writeFile(joinSegments(vaultPath, "Work", "photo.png"), "png");
    await writeFile(joinSegments(vaultPath, "loose.pdf"), "%PDF");

    await expect(listItemRelativePaths(fs, vaultPath)).resolves.toEqual([
      "Work/note.md",
    ]);
    await expect(listFolderRelativePaths(fs, vaultPath)).resolves.toEqual([
      "Work",
    ]);
  });

  it("does not treat vault-root media/ as a collection or item container", async () => {
    const vaultPath = await seedEmptyVault();
    await mkdir(joinSegments(vaultPath, "media"), { recursive: true });
    await writeFile(joinSegments(vaultPath, "media", "blob.bin"), "x");
    await writeFile(joinSegments(vaultPath, "media", "hidden.md"), "# no\n");
    await mkdir(joinSegments(vaultPath, "Work"), { recursive: true });
    await writeFile(joinSegments(vaultPath, "Work", "note.md"), "# note\n");

    const items = await listItemRelativePaths(fs, vaultPath);
    const folders = await listFolderRelativePaths(fs, vaultPath);

    expect(items).toEqual(["Work/note.md"]);
    expect(folders).toEqual(["Work"]);
    expect(folders).not.toContain("media");
    expect(items.every((id) => !id.startsWith("media/"))).toBe(true);
  });

  it("does not list *.media sidecars as collections", async () => {
    const vaultPath = await seedEmptyVault();
    await mkdir(joinSegments(vaultPath, "Work"), { recursive: true });
    await writeFile(joinSegments(vaultPath, "Work", "note.md"), "# note\n");
    await mkdir(joinSegments(vaultPath, "Work", "note.media"), {
      recursive: true,
    });
    await writeFile(
      joinSegments(vaultPath, "Work", "note.media", "manifest.json"),
      "{}",
    );

    await expect(listItemRelativePaths(fs, vaultPath)).resolves.toEqual([
      "Work/note.md",
    ]);
    await expect(listFolderRelativePaths(fs, vaultPath)).resolves.toEqual([
      "Work",
    ]);
  });

  it("ignores top-level loose files when resolving Inbox folders", async () => {
    const vaultPath = await seedEmptyVault();
    await writeFile(joinSegments(vaultPath, "noise.png"), "png");
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };

    await expect(resolveOrCreateInboxFolder(ctx, vaultPath)).resolves.toBe(
      "Inbox",
    );
    const folders = await listFolderRelativePaths(fs, vaultPath);
    expect(folders).toEqual(["Inbox"]);
  });
});
