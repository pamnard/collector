import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureHealthyIndex,
  INDEX_TABLES,
  ITEMS_COLUMNS,
} from "@collector/db";
import { BetterSqliteMigrator } from "../../db/src/testing/better-sqlite.js";
import {
  createCollectorIndexBoot,
  type ClosableSqlExecutor,
} from "./index-boot.js";

function asClosable(db: BetterSqliteMigrator): ClosableSqlExecutor {
  let closed = false;
  return {
    execute: (query, bindValues) => db.execute(query, bindValues),
    select: (query, bindValues) => db.select(query, bindValues),
    close: async () => {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}

async function assertIndexSchemaPresent(sql: ClosableSqlExecutor): Promise<void> {
  for (const table of INDEX_TABLES) {
    const rows = await sql.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [table],
    );
    expect(rows, `expected table ${table}`).toHaveLength(1);
  }
  const columns = await sql.select<{ name: string }>("PRAGMA table_info(items)");
  for (const column of ITEMS_COLUMNS) {
    expect(
      columns.some((entry) => entry.name === column),
      `items missing column: ${column}`,
    ).toBe(true);
  }
}

describe("createCollectorIndexBoot", () => {
  let dataDir = "";

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("open + ensureHealthy migrate real SQLite to a healthy index on a temp vault", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-index-boot-"));
    const dbPath = join(dataDir, "collector.db");
    const prepare = vi.fn(async () => {});

    const boot = createCollectorIndexBoot({
      prepareEnvironment: prepare,
      openSql: async () => asClosable(BetterSqliteMigrator.open(dbPath)),
    });

    await boot.open();
    expect(prepare).toHaveBeenCalledOnce();
    expect(boot.isOpen()).toBe(true);

    await boot.ensureHealthy();
    expect(boot.isHealthy()).toBe(true);

    const sql = boot.requireSql();
    const health = await ensureHealthyIndex(sql);
    expect(health.ok).toBe(true);
    expect(health.errors).toEqual([]);
    await assertIndexSchemaPresent(sql);

    await boot.open();
    expect(prepare).toHaveBeenCalledOnce();

    await sql.close();
  });

  it("failed open closes sql and leaves getSql null", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-index-boot-fail-"));
    const dbPath = join(dataDir, "collector.db");

    const boot = createCollectorIndexBoot({
      prepareEnvironment: async () => {},
      openSql: async () => {
        const sql = asClosable(BetterSqliteMigrator.open(dbPath));
        const original = sql.execute.bind(sql);
        let calls = 0;
        sql.execute = async (query, bindValues) => {
          calls += 1;
          if (calls > 2) {
            throw new Error("migrate boom");
          }
          return original(query, bindValues);
        };
        return sql;
      },
    });

    await expect(boot.open()).rejects.toThrow(/migrate boom/);
    expect(boot.getSql()).toBeNull();
  });

  it("unhealthy index after open rebuilds via hooks to a healthy schema", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-index-boot-rebuild-"));
    const dbPath = join(dataDir, "collector.db");
    const rebuildStart = vi.fn(async () => {});
    const rebuildFinally = vi.fn();

    const boot = createCollectorIndexBoot({
      prepareEnvironment: async () => {},
      openSql: async () => asClosable(BetterSqliteMigrator.open(dbPath)),
      onUnhealthyRebuildStart: rebuildStart,
      onUnhealthyRebuildFinally: rebuildFinally,
    });

    await boot.open();
    // Corrupt after migrate so ensureHealthy must reset+migrate.
    await boot.requireSql().execute("DROP TABLE item_tags");
    expect((await ensureHealthyIndex(boot.requireSql())).ok).toBe(false);

    await boot.ensureHealthy();
    expect(rebuildStart).toHaveBeenCalledOnce();
    expect(rebuildFinally).toHaveBeenCalledOnce();
    expect(boot.isHealthy()).toBe(true);

    const sql = boot.requireSql();
    const health = await ensureHealthyIndex(sql);
    expect(health.ok).toBe(true);
    expect(health.errors).toEqual([]);
    await assertIndexSchemaPresent(sql);

    await sql.close();
  });
});
