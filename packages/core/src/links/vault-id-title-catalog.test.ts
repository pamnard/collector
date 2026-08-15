import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@collector/db";
import { BetterSqliteMigrator } from "../../../db/src/testing/better-sqlite.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import type { SqlSelector } from "../index/sql-index.js";
import { buildTextLinkResolveContext } from "./text-links-reindex.js";
import {
  hasVaultIdTitleCatalogCache,
  invalidateAllVaultIdTitleCatalogs,
  invalidateVaultIdTitleCatalog,
  loadVaultIdTitleCatalog,
} from "./vault-id-title-catalog.js";

function countingSelector(
  rows: Array<{ id: string; title: string }>,
): SqlSelector & { selectCalls: string[] } {
  const selectCalls: string[] = [];
  return {
    selectCalls,
    async select<T>(query: string, _bindValues?: unknown[]): Promise<T[]> {
      selectCalls.push(query);
      return rows as T[];
    },
  };
}

describe("vault id/title catalog cache (#661)", () => {
  it("loads once and reuses on warm path (no second full-vault SELECT)", async () => {
    const db = countingSelector([
      { id: "Inbox/a.md", title: "A" },
      { id: "Inbox/b.md", title: "B" },
    ]);

    const first = await loadVaultIdTitleCatalog(db, "vault-1");
    const second = await loadVaultIdTitleCatalog(db, "vault-1");

    expect(first).toEqual([
      { id: "Inbox/a.md", title: "A" },
      { id: "Inbox/b.md", title: "B" },
    ]);
    expect(second).toBe(first);
    expect(db.selectCalls).toEqual([
      "SELECT id, title FROM items WHERE vault_id = ?",
    ]);
    expect(hasVaultIdTitleCatalogCache(db, "vault-1")).toBe(true);
  });

  it("isolates catalogs by vault id", async () => {
    const db = countingSelector([{ id: "Inbox/a.md", title: "A" }]);
    await loadVaultIdTitleCatalog(db, "vault-1");
    await loadVaultIdTitleCatalog(db, "vault-2");
    expect(db.selectCalls).toHaveLength(2);
  });

  it("reloads after per-vault invalidation", async () => {
    const db = countingSelector([{ id: "Inbox/a.md", title: "A" }]);
    await loadVaultIdTitleCatalog(db, "vault-1");
    invalidateVaultIdTitleCatalog(db, "vault-1");
    expect(hasVaultIdTitleCatalogCache(db, "vault-1")).toBe(false);
    await loadVaultIdTitleCatalog(db, "vault-1");
    expect(db.selectCalls).toHaveLength(2);
  });

  it("clears all vaults for a session", async () => {
    const db = countingSelector([{ id: "Inbox/a.md", title: "A" }]);
    await loadVaultIdTitleCatalog(db, "vault-1");
    await loadVaultIdTitleCatalog(db, "vault-2");
    invalidateAllVaultIdTitleCatalogs(db);
    expect(hasVaultIdTitleCatalogCache(db, "vault-1")).toBe(false);
    expect(hasVaultIdTitleCatalogCache(db, "vault-2")).toBe(false);
  });

  it("does not share cache across distinct SQL sessions", async () => {
    const rows = [{ id: "Inbox/a.md", title: "A" }];
    const dbA = countingSelector(rows);
    const dbB = countingSelector(rows);
    await loadVaultIdTitleCatalog(dbA, "vault-1");
    await loadVaultIdTitleCatalog(dbB, "vault-1");
    expect(dbA.selectCalls).toHaveLength(1);
    expect(dbB.selectCalls).toHaveLength(1);
  });

  it("does not write stale SELECT when invalidate races with in-flight load", async () => {
    let selectCount = 0;
    let releaseFirstSelect!: () => void;
    const firstSelectBlocked = new Promise<void>((resolve) => {
      releaseFirstSelect = resolve;
    });
    let firstSelectStarted!: () => void;
    const firstSelectSeen = new Promise<void>((resolve) => {
      firstSelectStarted = resolve;
    });

    const db: SqlSelector = {
      async select<T>(_query: string, _bindValues?: unknown[]): Promise<T[]> {
        selectCount += 1;
        if (selectCount === 1) {
          firstSelectStarted();
          await firstSelectBlocked;
          return [{ id: "Inbox/stale.md", title: "Stale" }] as T[];
        }
        return [{ id: "Inbox/fresh.md", title: "Fresh" }] as T[];
      },
    };

    const loadPromise = loadVaultIdTitleCatalog(db, "vault-1");
    await firstSelectSeen;
    invalidateVaultIdTitleCatalog(db, "vault-1");
    releaseFirstSelect();

    const rows = await loadPromise;
    expect(rows).toEqual([{ id: "Inbox/fresh.md", title: "Fresh" }]);
    expect(hasVaultIdTitleCatalogCache(db, "vault-1")).toBe(true);

    const cached = await loadVaultIdTitleCatalog(db, "vault-1");
    expect(cached).toEqual([{ id: "Inbox/fresh.md", title: "Fresh" }]);
    expect(selectCount).toBe(2);
  });

  it("preserves ambiguous-title behavior (multiple ids for one title)", async () => {
    const db = countingSelector([
      { id: "Inbox/a.md", title: "Dup" },
      { id: "Inbox/b.md", title: "Dup" },
    ]);
    const rows = await loadVaultIdTitleCatalog(db, "vault-1");
    const context = (
      await import("./text-links-reindex.js")
    ).textLinkResolveContextFromItems("Inbox/source.md", rows);
    expect(context.idsByTitle("Dup")).toEqual(["Inbox/a.md", "Inbox/b.md"]);
  });
});

describe("buildTextLinkResolveContext warm cache (#661)", () => {
  it("does not re-select full vault catalog on second build for same session", async () => {
    let vaultSelects = 0;
    let catalogSelects = 0;
    const db: SqlSelector = {
      async select<T>(query: string, bindValues?: unknown[]): Promise<T[]> {
        if (query.includes("SELECT vault_id FROM items")) {
          vaultSelects += 1;
          return [{ vault_id: "vault-1" }] as T[];
        }
        if (query.includes("SELECT id, title FROM items WHERE vault_id")) {
          catalogSelects += 1;
          expect(bindValues).toEqual(["vault-1"]);
          return [
            { id: "Inbox/source.md", title: "Source" },
            { id: "Inbox/target.md", title: "Target" },
          ] as T[];
        }
        throw new Error(`unexpected query: ${query}`);
      },
    };

    const first = await buildTextLinkResolveContext(db, "Inbox/source.md");
    const second = await buildTextLinkResolveContext(db, "Inbox/source.md");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.idsByTitle("Target")).toEqual(["Inbox/target.md"]);
    expect(second!.idsByTitle("Target")).toEqual(["Inbox/target.md"]);
    expect(vaultSelects).toBe(2);
    expect(catalogSelects).toBe(1);
  });
});

describe("listItemIdTitles warm cache (#661)", () => {
  let dataDir = "";
  let db: BetterSqliteMigrator | null = null;

  afterEach(async () => {
    db?.close();
    db = null;
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("reuses catalog and invalidates after metadata upsert", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-catalog-cache-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO vaults (id, path, name, description, is_default, created_at, updated_at)
       VALUES (?, ?, ?, '', 1, ?, ?)`,
      ["vault-1", "/tmp/v", "V", now, now],
    );
    await db.execute(
      `INSERT INTO items (
        id, vault_id, title, description, content_type, source_type,
        metadata_json, properties_json, has_content_file, folder_path,
        created_at, updated_at, content_revision
      ) VALUES (?, ?, ?, '', 'note', 'manual', '{}', '{}', 1, 'Inbox', ?, ?, 1)`,
      ["Inbox/a.md", "vault-1", "Alpha", now, now],
    );

    const selectSpy = vi.spyOn(db, "select");
    const index = new SqlVaultIndexStore(db);

    const first = await index.listItemIdTitles("vault-1");
    const second = await index.listItemIdTitles("vault-1");
    expect(first).toEqual([{ id: "Inbox/a.md", title: "Alpha" }]);
    expect(second).toEqual(first);

    const catalogQueryCount = selectSpy.mock.calls.filter(([query]) =>
      String(query).includes("SELECT id, title FROM items WHERE vault_id"),
    ).length;
    expect(catalogQueryCount).toBe(1);

    await index.upsertItemMetadata(
      {
        item: {
          id: "Inbox/a.md",
          vault_id: "vault-1",
          title: "Alpha Renamed",
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          properties: {},
          tag_ids: [],
          collection_ids: [],
          folder_path: "Inbox",
          created_at: now,
          updated_at: now,
          content_revision: 2,
        },
        fileMtimeMs: 1,
      },
      "vault-1",
    );

    const third = await index.listItemIdTitles("vault-1");
    expect(third).toEqual([{ id: "Inbox/a.md", title: "Alpha Renamed" }]);
    const catalogQueryCountAfter = selectSpy.mock.calls.filter(([query]) =>
      String(query).includes("SELECT id, title FROM items WHERE vault_id"),
    ).length;
    expect(catalogQueryCountAfter).toBe(2);
  });

  it("invalidates both old and new vault when upsert moves vault_id", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-catalog-move-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO vaults (id, path, name, description, is_default, created_at, updated_at)
       VALUES (?, ?, ?, '', 1, ?, ?), (?, ?, ?, '', 0, ?, ?)`,
      [
        "vault-1",
        "/tmp/v1",
        "V1",
        now,
        now,
        "vault-2",
        "/tmp/v2",
        "V2",
        now,
        now,
      ],
    );
    await db.execute(
      `INSERT INTO items (
        id, vault_id, title, description, content_type, source_type,
        metadata_json, properties_json, has_content_file, folder_path,
        created_at, updated_at, content_revision
      ) VALUES (?, ?, ?, '', 'note', 'manual', '{}', '{}', 1, 'Inbox', ?, ?, 1)`,
      ["Inbox/a.md", "vault-1", "Alpha", now, now],
    );

    const index = new SqlVaultIndexStore(db);
    await index.listItemIdTitles("vault-1");
    expect(hasVaultIdTitleCatalogCache(db, "vault-1")).toBe(true);

    await index.upsertItemMetadata(
      {
        item: {
          id: "Inbox/a.md",
          vault_id: "vault-2",
          title: "Alpha",
          description: "",
          content_type: "note",
          source_type: "manual",
          metadata: {},
          properties: {},
          tag_ids: [],
          collection_ids: [],
          folder_path: "Inbox",
          created_at: now,
          updated_at: now,
          content_revision: 2,
        },
        fileMtimeMs: 1,
      },
      "vault-2",
    );

    expect(hasVaultIdTitleCatalogCache(db, "vault-1")).toBe(false);
    expect(hasVaultIdTitleCatalogCache(db, "vault-2")).toBe(false);

    const vault1 = await index.listItemIdTitles("vault-1");
    const vault2 = await index.listItemIdTitles("vault-2");
    expect(vault1).toEqual([]);
    expect(vault2).toEqual([{ id: "Inbox/a.md", title: "Alpha" }]);
  });
});

describe("catalog invalidation on index mutations (#661)", () => {
  let dataDir = "";
  let db: BetterSqliteMigrator | null = null;

  afterEach(async () => {
    db?.close();
    db = null;
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  async function seedVaultWithItem(): Promise<{
    index: SqlVaultIndexStore;
    now: string;
  }> {
    dataDir = await mkdtemp(join(tmpdir(), "collector-catalog-invalidate-"));
    db = BetterSqliteMigrator.open(join(dataDir, "collector.db"));
    await runMigrations(db);
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO vaults (id, path, name, description, is_default, created_at, updated_at)
       VALUES (?, ?, ?, '', 1, ?, ?)`,
      ["vault-1", "/tmp/v", "V", now, now],
    );
    await db.execute(
      `INSERT INTO items (
        id, vault_id, title, description, content_type, source_type,
        metadata_json, properties_json, has_content_file, folder_path,
        created_at, updated_at, content_revision
      ) VALUES (?, ?, ?, '', 'note', 'manual', '{}', '{}', 1, 'Inbox', ?, ?, 1)`,
      ["Inbox/a.md", "vault-1", "Alpha", now, now],
    );
    return { index: new SqlVaultIndexStore(db), now };
  }

  it("invalidates catalog on deleteItem", async () => {
    const { index } = await seedVaultWithItem();
    await index.listItemIdTitles("vault-1");
    expect(hasVaultIdTitleCatalogCache(db!, "vault-1")).toBe(true);

    await index.deleteItem("Inbox/a.md");
    expect(hasVaultIdTitleCatalogCache(db!, "vault-1")).toBe(false);
  });

  it("invalidates catalog on rewriteItemIds", async () => {
    const { index } = await seedVaultWithItem();
    await index.listItemIdTitles("vault-1");
    expect(hasVaultIdTitleCatalogCache(db!, "vault-1")).toBe(true);

    await index.rewriteItemIds([
      { oldId: "Inbox/a.md", newId: "Inbox/b.md", folderPath: "Inbox" },
    ]);
    expect(hasVaultIdTitleCatalogCache(db!, "vault-1")).toBe(false);
  });

  it("invalidates catalog on deleteVault", async () => {
    const { index } = await seedVaultWithItem();
    await index.listItemIdTitles("vault-1");
    expect(hasVaultIdTitleCatalogCache(db!, "vault-1")).toBe(true);

    await index.deleteVault("vault-1");
    expect(hasVaultIdTitleCatalogCache(db!, "vault-1")).toBe(false);
  });
});
