import type { Migration, SqlMigrator, SqlExecutor, SqlReader } from "../migrate.js";
import { splitSqlMigration } from "../migrate.js";
import { JOBS_MIGRATION_001 } from "./001_initial.js";

export const JOBS_MIGRATIONS: Migration[] = [
  { version: 1, sql: JOBS_MIGRATION_001 },
];

export const CURRENT_JOBS_SCHEMA_VERSION =
  JOBS_MIGRATIONS[JOBS_MIGRATIONS.length - 1]!.version;

async function readAppliedVersions(db: SqlReader): Promise<Set<number>> {
  try {
    const rows = await db.select<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    return new Set(rows.map((row) => row.version));
  } catch {
    return new Set();
  }
}

async function recordMigration(db: SqlExecutor, version: number): Promise<void> {
  await db.execute(
    "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, datetime('now'))",
    [version],
  );
}

export async function runJobsMigrations(db: SqlMigrator): Promise<number[]> {
  const applied = await readAppliedVersions(db);
  const newlyApplied: number[] = [];

  for (const migration of JOBS_MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }

    for (const statement of splitSqlMigration(migration.sql)) {
      await db.execute(statement);
    }

    await recordMigration(db, migration.version);
    newlyApplied.push(migration.version);
  }

  return newlyApplied;
}

