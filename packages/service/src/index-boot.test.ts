import { describe, expect, it, vi } from "vitest";
import { type SqlMigrator } from "@collector/db";
import { createCollectorIndexBoot } from "./index-boot.js";

class FakeSql implements SqlMigrator {
  closed = false;
  private schemaVersion: number | null = null;
  private tables = new Set<string>();

  async execute(query: string, bindValues: unknown[] = []): Promise<number> {
    const q = query.trim().replace(/\s+/g, " ");
    if (q.startsWith("CREATE TABLE") || q.startsWith("CREATE VIRTUAL") || q.startsWith("CREATE INDEX")) {
      const m = q.match(/CREATE (?:VIRTUAL )?TABLE(?: IF NOT EXISTS)? (\w+)/i)
        ?? q.match(/CREATE INDEX(?: IF NOT EXISTS)? \w+ ON (\w+)/i);
      if (m) this.tables.add(m[1]);
      return 0;
    }
    if (q.includes("INSERT INTO schema_migrations")) {
      this.schemaVersion = Number(bindValues[0]);
      return 1;
    }
    if (q === "DELETE FROM schema_migrations" || q.startsWith("DROP ")) {
      if (q.startsWith("DROP TABLE")) {
        const name = q.match(/DROP TABLE IF EXISTS (\w+)/i)?.[1];
        if (name) this.tables.delete(name);
      }
      if (q.includes("schema_migrations")) this.schemaVersion = null;
      return 0;
    }
    return 0;
  }

  async select<TRow>(query: string, _bindValues: unknown[] = []): Promise<TRow[]> {
    const q = query.trim().replace(/\s+/g, " ");
    if (q.includes("FROM schema_migrations")) {
      if (this.schemaVersion == null) return [] as TRow[];
      return [{ version: this.schemaVersion } as TRow];
    }
    if (q.includes("sqlite_master")) {
      return [...this.tables].map((name) => ({ name })) as TRow[];
    }
    // Startup probes — return empty rows; validate.ts may treat missing as unhealthy.
    return [] as TRow[];
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe("createCollectorIndexBoot", () => {
  it("open runs prepare + migrate and is idempotent", async () => {
    const prepare = vi.fn(async () => {});
    const fake = new FakeSql();
    const boot = createCollectorIndexBoot({
      prepareEnvironment: prepare,
      openSql: async () => fake,
    });

    await boot.open();
    expect(prepare).toHaveBeenCalledOnce();
    expect(boot.isOpen()).toBe(true);
    expect(boot.getSql()).toBe(fake);

    await boot.open();
    expect(prepare).toHaveBeenCalledOnce();
  });

  it("failed open closes sql and leaves getSql null", async () => {
    const fake = new FakeSql();
    const boot = createCollectorIndexBoot({
      prepareEnvironment: async () => {},
      openSql: async () => fake,
    });

    // Force migrate failure by making execute throw after open assigned
    const original = fake.execute.bind(fake);
    let calls = 0;
    fake.execute = async (query, bind) => {
      calls += 1;
      if (calls > 2) {
        throw new Error("migrate boom");
      }
      return original(query, bind);
    };

    await expect(boot.open()).rejects.toThrow(/migrate boom/);
    expect(fake.closed).toBe(true);
    expect(boot.getSql()).toBeNull();
  });

  it("unhealthy index triggers rebuild hooks then fails if still unhealthy", async () => {
    const rebuildStart = vi.fn(async () => {});
    const rebuildFinally = vi.fn();
    const fake = new FakeSql();

    const boot = createCollectorIndexBoot({
      prepareEnvironment: async () => {},
      openSql: async () => fake,
      onUnhealthyRebuildStart: rebuildStart,
      onUnhealthyRebuildFinally: rebuildFinally,
    });

    await boot.open();

    // FakeSql after migrations still fails UI probes → ensureHealthy rebuilds then throws.
    await expect(boot.ensureHealthy()).rejects.toThrow(/startup checks/);
    expect(rebuildStart).toHaveBeenCalledOnce();
    expect(rebuildFinally).toHaveBeenCalledOnce();
  });
});
