import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BetterSqliteMigrator } from "../testing/better-sqlite.js";
import {
  CURRENT_JOBS_SCHEMA_VERSION,
  runJobsMigrations,
} from "./migrate.js";

describe("runJobsMigrations (#628)", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("applies jobs schema on a fresh database", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "collector-jobs-db-"));
    const db = BetterSqliteMigrator.open(join(tempDir, "jobs.db"));

    const applied = await runJobsMigrations(db);
    expect(applied).toEqual([1]);
    expect(CURRENT_JOBS_SCHEMA_VERSION).toBe(1);

    const columns = await db.select<{ name: string }>("PRAGMA table_info(jobs)");
    for (const column of [
      "id",
      "type",
      "payload_json",
      "status",
      "priority",
      "idempotency_key",
      "attempts",
      "max_attempts",
      "available_at",
      "created_at",
      "updated_at",
    ]) {
      expect(columns.some((entry) => entry.name === column)).toBe(true);
    }

    db.close();
  });

  it("is a no-op on second run", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "collector-jobs-db-"));
    const db = BetterSqliteMigrator.open(join(tempDir, "jobs.db"));

    await runJobsMigrations(db);
    expect(await runJobsMigrations(db)).toEqual([]);

    db.close();
  });
});
