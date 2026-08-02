import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  INBOX_FOLDER_NAME,
  compareFolderNamesForDisplay,
  resolveInboxFolderName,
  navFilterSettingSchema,
} from "@collector/shared";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createId } from "../util/ids.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createVault } from "./vault-operations.js";
import { upsertItem } from "./item-operations.js";
import { ensureInboxLayout, resolveOrCreateInboxFolder } from "./inbox-layout.js";
import { remediateVaultLayout } from "./vault-layout-guard.js";
import { itemMarkdownPath, joinSegments } from "./paths.js";
import { syncVaultIndexFromFilesystem } from "./index-sync.js";

describe("resolveInboxFolderName", () => {
  it("returns null when missing", () => {
    expect(resolveInboxFolderName(["Work", "Archive"])).toBeNull();
  });

  it("prefers exact Inbox over other casings", () => {
    expect(resolveInboxFolderName(["inbox", "Inbox", "INBOX"])).toBe("Inbox");
  });

  it("returns first ignore-case match when exact missing", () => {
    expect(resolveInboxFolderName(["Work", "inbox"])).toBe("inbox");
  });
});

describe("compareFolderNamesForDisplay", () => {
  it("pins Inbox before alphabetical peers", () => {
    expect(
      ["Work", "Inbox", "Archive"].sort(compareFolderNamesForDisplay),
    ).toEqual(["Inbox", "Archive", "Work"]);
  });
});

describe("navFilterSettingSchema empty folder", () => {
  it("maps empty folder_path to all", () => {
    expect(
      navFilterSettingSchema.parse({ type: "folder", folder_path: "" }),
    ).toBe("all");
  });
});

describe("ensureInboxLayout", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function seedVault() {
    dataDir = await mkdtemp(join(tmpdir(), "collector-inbox-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    return { ctx, meta, path };
  }

  it("creates Inbox when missing", async () => {
    const { ctx, path } = await seedVault();
    const inbox = await ensureInboxLayout(ctx, path);
    expect(inbox).toBe(INBOX_FOLDER_NAME);
    expect(await fs.exists(joinSegments(path, INBOX_FOLDER_NAME))).toBe(true);
  });

  it("does not move root markdown (layout guard owns that)", async () => {
    const { ctx, meta, path } = await seedVault();
    const id = `${createId()}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: {
        id,
        vault_id: meta.id,
        title: "Root",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: "body",
    });

    await ensureInboxLayout(ctx, path);
    expect(await fs.exists(itemMarkdownPath(path, id))).toBe(true);
  });

  it("recreates Inbox after rename without touching the old folder", async () => {
    const { ctx, meta, path } = await seedVault();
    await resolveOrCreateInboxFolder(ctx, path);
    const stem = `${createId()}.md`;
    const itemId = `Inbox/${stem}`;
    await upsertItem(ctx, path, meta.id, {
      item: {
        id: itemId,
        vault_id: meta.id,
        title: "Kept",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "Inbox",
        content_revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: "kept",
    });
    await fs.rename(
      joinSegments(path, "Inbox"),
      joinSegments(path, "WasInbox"),
    );

    const inbox = await ensureInboxLayout(ctx, path);
    expect(inbox).toBe(INBOX_FOLDER_NAME);
    expect(await fs.exists(joinSegments(path, INBOX_FOLDER_NAME))).toBe(true);
    expect(await fs.exists(joinSegments(path, "WasInbox"))).toBe(true);
    const newInboxEntries = await fs.readDir(joinSegments(path, INBOX_FOLDER_NAME));
    expect(newInboxEntries.filter((n) => n.endsWith(".md"))).toHaveLength(0);
    expect(await fs.exists(itemMarkdownPath(path, `WasInbox/${stem}`))).toBe(
      true,
    );
  });

  it("sync leaves root notes; remediate then sync indexes Inbox", async () => {
    const { ctx, meta, path } = await seedVault();
    const id = `${createId()}.md`;
    await upsertItem(ctx, path, meta.id, {
      item: {
        id,
        vault_id: meta.id,
        title: "Root",
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        tag_ids: [],
        collection_ids: [],
        folder_path: "",
        content_revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: "body",
    });

    await syncVaultIndexFromFilesystem(ctx, path);
    expect(await fs.exists(itemMarkdownPath(path, id))).toBe(true);

    await remediateVaultLayout(fs, path);
    expect(await fs.exists(itemMarkdownPath(path, id))).toBe(false);
    expect(await fs.exists(itemMarkdownPath(path, `Inbox/${id}`))).toBe(true);

    await syncVaultIndexFromFilesystem(ctx, path);
    const counts = await ctx.index.listFolderItemCounts(meta.id);
    expect(counts.find((row) => row.folder_path === "Inbox")?.item_count).toBe(
      1,
    );
    expect(counts.find((row) => row.folder_path === "")).toBeUndefined();
  });
});
